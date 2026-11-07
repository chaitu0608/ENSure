// Runs the whole stack on this machine with no keys, for trying the Deploy page.
//   Real: ENSv2 contracts on a local Sepolia fork, Postgres, git, builds, API.
//   Fake: Pinata, IPFS gateways, GitHub login and API. Builds run without Docker.
// Needs Foundry (`anvil`, `forge`) and Postgres on PATH, or ANVIL_BIN and FORGE_BIN.
import { execFile, spawn } from "node:child_process";
import { createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createPublicClient, createTestClient, createWalletClient, http, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { REGISTRY_ROLES as G, SEPOLIA, registryAbi, withAdmin } from "@ensure/core/ens";
import { allowLogging, setupPlatform, setupProject, signerFrom } from "@ensure/core/setup";
import { startStubs } from "./stubs";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../..");
const FORK = process.env.SANDBOX_FORK_URL ?? "https://ethereum-sepolia.publicnode.com";
const freePort = () => new Promise<number>((ok, fail) => {
  const srv = netServer();
  srv.once("error", fail);
  srv.listen(0, "127.0.0.1", () => { const { port } = srv.address() as { port: number }; srv.close(() => ok(port)); });
});
const busy = (port: number) => Promise.all(["127.0.0.1", "::"].map((host) => new Promise<boolean>((ok) => {
  const srv = netServer();
  srv.once("error", (e: NodeJS.ErrnoException) => ok(e.code === "EADDRINUSE"));
  srv.listen(port, host, () => srv.close(() => ok(false)));
}))).then((r) => r.some(Boolean));

// Postgres and anvil take any free port. The API port is fixed because the web app expects it.
const P = { anvil: await freePort(), pg: await freePort(), stub: 58101, api: Number(process.env.PORT ?? 3001) };
for (const [port, what] of [[P.api, "the API"], [P.stub, "the sandbox helper"]] as const) {
  if (await busy(port)) throw new Error(`Port ${port} (${what}) is already in use, maybe by an old sandbox or server. See what: lsof -nP -iTCP:${port} -sTCP:LISTEN`);
}
const RPC = `http://localhost:${P.anvil}`, STUB = `http://localhost:${P.stub}`, API = `http://localhost:${P.api}`;
const foundry = (bin: string) => (existsSync(join(homedir(), ".foundry/bin", bin)) ? join(homedir(), ".foundry/bin", bin) : bin);
const anvilBin = process.env.ANVIL_BIN ?? foundry("anvil"), forgeBin = process.env.FORGE_BIN ?? foundry("forge");
const tmp = mkdtempSync(join(tmpdir(), "ensure-sandbox-"));
const say = (s: string) => console.log(`• ${s}`);

// Everything below runs as a child of this process, so cleanup is one synchronous step that also runs on failure.
const procs: ReturnType<typeof spawn>[] = [];
function cleanup() {
  for (const p of procs) p.kill("SIGKILL");
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => process.exit(0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tail = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").slice(-8).join("\n") : "(no log)");

const ownerKey = generatePrivateKey(), publisherKey = generatePrivateKey();
const owner = privateKeyToAccount(ownerKey), publisher = privateKeyToAccount(publisherKey);
const JWT = randomBytes(16).toString("hex"), WEBHOOK = randomBytes(16).toString("hex");

const anvil = spawn(anvilBin, ["--version"]);
await new Promise<void>((ok, fail) => { anvil.on("error", () => fail(new Error("Foundry not found. Install it with: curl -L https://foundry.paradigm.xyz | bash && foundryup"))); anvil.on("close", () => ok()); });

say("Starting a temporary Postgres");
await run("initdb", ["-D", join(tmp, "pg"), "-U", "ensure", "--auth=trust", "-E", "UTF8"]);
const pgLog = join(tmp, "pg.log");
const logFd = openSync(pgLog, "a");
const pg = spawn("postgres", ["-D", join(tmp, "pg"), "-p", String(P.pg), "-k", tmp, "-c", "listen_addresses=127.0.0.1"], { stdio: ["ignore", logFd, logFd] });
procs.push(pg);
let pgDied = false;
pg.on("exit", () => { pgDied = true; });
for (let i = 0; ; i++) {
  if (pgDied) throw new Error(`Postgres exited at startup:\n${tail(pgLog)}`);
  if (await run("pg_isready", ["-h", "127.0.0.1", "-p", String(P.pg)]).then(() => true, () => false)) break;
  if (i > 100) throw new Error(`Postgres didn't become ready:\n${tail(pgLog)}`);
  await sleep(300);
}
await run("createdb", ["-h", "127.0.0.1", "-p", String(P.pg), "-U", "ensure", "ensure"]);

say("Forking Sepolia");
const head = await createPublicClient({ chain: sepolia, transport: http(FORK) }).getBlockNumber();
procs.push(spawn(anvilBin, ["--fork-url", FORK, "--fork-block-number", String(head - 20n), "--port", String(P.anvil), "--silent"], { stdio: "ignore" }));
const client = createPublicClient({ chain: sepolia, transport: http(RPC, { timeout: 60_000 }) });
const test = createTestClient({ chain: sepolia, mode: "anvil", transport: http(RPC, { timeout: 60_000 }) });
for (let i = 0; ; i++) {
  const ok = await client.getChainId().then((id) => id === 11155111, () => false);
  if (ok) break;
  if (i > 300) throw new Error("Fork didn't start");
  await new Promise((r) => setTimeout(r, 300));
}
for (const a of [owner, publisher]) await test.setBalance({ address: a.address, value: 10n ** 19n });

const wallet = createWalletClient({ chain: sepolia, transport: http(RPC, { timeout: 60_000 }), account: owner });
const signer = signerFrom({ public: client, wallet: wallet as any, account: owner.address });

async function registerParent(label: string) {
  // Only possible on a fork: act as the registrar. Live, register the parent in the ENS app.
  await test.impersonateAccount({ address: SEPOLIA.ethRegistrar });
  await test.setBalance({ address: SEPOLIA.ethRegistrar, value: 10n ** 18n });
  const zero = "0x0000000000000000000000000000000000000000";
  const hash = await createWalletClient({ chain: sepolia, transport: http(RPC) }).writeContract({
    address: SEPOLIA.ethRegistry, abi: registryAbi, functionName: "register", account: SEPOLIA.ethRegistrar,
    args: [label, owner.address, zero, zero, withAdmin(G.SET_SUBREGISTRY, G.SET_RESOLVER) | ((1n << 28n) << 128n), BigInt(Math.floor(Date.now() / 1000) + 365 * 86400)],
  });
  await client.waitForTransactionReceipt({ hash });
  await test.stopImpersonatingAccount({ address: SEPOLIA.ethRegistrar });
}

say("Setting up ENSv2 names on the real contracts");
const id = Date.now().toString(36);
const platformName = `ensplat${id}.eth`, projectName = `ensproj${id}.eth`;
await run(forgeBin, ["build", "--root", join(ROOT, "contracts")]);
const artifact = JSON.parse(readFileSync(join(ROOT, "contracts/out/DeployRegistry.sol/DeployRegistry.json"), "utf8"));
const deployed = await client.waitForTransactionReceipt({ hash: await (wallet as any).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [SEPOLIA.universalHelper] }) });
const deployRegistry = deployed.contractAddress as Address;
await registerParent(platformName.split(".")[0]);
await registerParent(projectName.split(".")[0]);
const platform = await setupPlatform(signer, platformName, publisher.address);
const project = await setupProject(signer, projectName, publisher.address);
await allowLogging(signer, deployRegistry, project.previewName, publisher.address);

const gitEnv = { PATH: process.env.PATH, HOME: tmp, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => run("git", args, { cwd, env: gitEnv });
const repoDir = (name: string) => join(tmp, "gh", "acme", `${name}.git`);
const repoIds = new Map<string, number>();
const write = (dir: string, files: Record<string, string>) => {
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), c); }
};

const stubs = await startStubs(P.stub, {
  privatePinJwt: JWT, apiUrl: API,
  extra: async (req, res, url, body) => {
    const json = (o: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); return true; };
    if (url.pathname === "/sandbox/push") {
      const { repo } = JSON.parse(body.toString());
      if (!repoIds.has(repo)) return json({ error: `Pushes only work on sandbox repos, not ${repo}` }, 400);
      write(repoDir(repo), { "pushed.txt": `pushed at ${Date.now()}\n` });
      await git(repoDir(repo), "add", "-A");
      await git(repoDir(repo), "commit", "-q", "-m", "push");
      const sha = (await git(repoDir(repo), "rev-parse", "HEAD")).stdout.trim();
      const payload = JSON.stringify({ ref: "refs/heads/main", after: sha, repository: { id: repoIds.get(repo) } });
      const hook = await fetch(`${API}/github/webhook`, {
        method: "POST", body: payload,
        headers: { "x-github-event": "push", "x-github-delivery": randomBytes(8).toString("hex"), "x-hub-signature-256": `sha256=${createHmac("sha256", WEBHOOK).update(payload).digest("hex")}` },
      });
      return json({ sha, ...((await hook.json()) as object) }, hook.status);
    }
    return false;
  },
});

async function repo(name: string, files: Record<string, string>, note: string, isPrivate = false) {
  const dir = repoDir(name);
  mkdirSync(dir, { recursive: true });
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
  write(dir, files);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "init");
  const num = 1000 + repoIds.size;
  repoIds.set(name, num);
  stubs.repos.set(`acme/${name}`, { id: num, private: isPrivate, default_branch: "main" });
  REPO_LIST.push({ url: `https://github.com/acme/${name}`, note });
}
const REPO_LIST: { url: string; note: string }[] = [];
const HTML = "<!doctype html><title>Sandbox site</title><h1>Deployed by ENSure</h1>";
const script = (build: string) => JSON.stringify({ scripts: { build } });

say("Creating demo repos");
await repo("plain-site", { "index.html": HTML, "assets/app.js": "console.log('hi')" }, "Plain HTML, no build");
await repo("vite-app", {
  "package.json": JSON.stringify({ name: "v", private: true, scripts: { build: "vite build" }, devDependencies: { vite: "^7" } }),
  "index.html": '<!doctype html><title>Vite</title><h1>Vite app</h1><script type="module" src="/main.js"></script>',
  "main.js": "console.log('vite')",
  "vite.config.js": 'export default { base: "./" }',
}, "Real Vite build, downloads from npm");
await repo("monorepo", { "apps/web/package.json": script("mkdir -p site && cp index.html site/"), "apps/web/index.html": HTML }, "Set subfolder apps/web and output site");
await repo("private-site", { "index.html": HTML }, "Private repo, uses an App token", true);
await repo("build-fails", { "package.json": script("echo this build breaks && exit 3") }, "must fail: build error stops the deploy");
await repo("leaves-secret", { "package.json": script("mkdir -p dist && cp index.html dist/ && echo KEY=1 > dist/.env"), "index.html": HTML }, "must fail: output holding a .env is refused");
await repo("leaves-symlink", { "package.json": script("mkdir -p dist && cp index.html dist/ && ln -s /etc/hosts dist/leak"), "index.html": HTML }, "must fail: output holding a symlink is refused");
await repo("no-index", { "package.json": script("mkdir -p dist && echo hi > dist/a.txt") }, "must fail: output with no index.html is refused");

say("Starting the API");
Object.assign(process.env, {
  DATABASE_URL: `postgres://ensure@127.0.0.1:${P.pg}/ensure`, SESSION_SECRET: randomBytes(16).toString("hex"), SEPOLIA_RPC_URL: RPC,
  PUBLISHER_PRIVATE_KEY: publisherKey, PINATA_JWT: JWT, PLATFORM_NAME: platformName, PLATFORM_REGISTRY: platform.registry, PLATFORM_RESOLVER: platform.resolver,
  PINATA_API_URL: STUB, PINATA_UPLOADS_URL: STUB, IPFS_GATEWAYS: STUB, IPFS_RETRY_MS: "20", GITHUB_API_URL: STUB, GITHUB_WEB_URL: STUB,
  GITHUB_APP_ID: "1", GITHUB_APP_CLIENT_ID: "sandbox", GITHUB_APP_CLIENT_SECRET: "sandbox", GITHUB_WEBHOOK_SECRET: WEBHOOK,
  GITHUB_APP_PRIVATE_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  GIT_BASE_URL: `file://${join(tmp, "gh")}`, BUILD_SANDBOX: "local", DEPLOY_REGISTRY: deployRegistry, API_URL: API, WEB_URL: "http://localhost:5183", PUSH_POLL_SECONDS: "",
});
const { migrate } = await import("../src/db");
await migrate();
const { createApp } = await import("../src/index");
const { startWorker } = await import("../src/deploys");
const { serve } = await import("@hono/node-server");
serve({ fetch: createApp().fetch, port: P.api });
await startWorker(2, 300);

console.log(`\nSandbox ready. Log in with GitHub on the page (fake, no account needed), then deploy one of:
${REPO_LIST.map((r) => `  ${r.url}  ${r.note}`).join("\n")}

In a second terminal:  VITE_SEPOLIA_RPC_URL=${RPC} corepack pnpm web
Then open:             http://localhost:5183/deploy
Simulate a git push:   curl -X POST ${STUB}/sandbox/push -d '{"repo":"plain-site"}'
The fake IPFS gateway means "Open site" links won't load here.

Ctrl-C stops everything and deletes the temporary data.`);
