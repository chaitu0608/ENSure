import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { auth, type Env } from "./auth";
import { startBot } from "./bot";
import { migrate } from "./db";
import { chain, deploys, mainnetReady, startPushWatcher, startWorker } from "./deploys";
import { github } from "./github";
import { names } from "./names";
import { projects } from "./projects";

const REQUIRED = ["DATABASE_URL", "SESSION_SECRET", "SEPOLIA_RPC_URL", "PUBLISHER_PRIVATE_KEY", "PINATA_JWT", "PLATFORM_NAME", "PLATFORM_REGISTRY", "PLATFORM_RESOLVER"];

export function createApp() {
  const app = new Hono<Env>();
  app.use(cors({ origin: (process.env.WEB_URL ?? "http://localhost:5183").split(","), credentials: true }));
  app.get("/health", (c) => c.json({ ok: true }));
  // Public addresses only. The setup page needs to know which account to give preview rights to.
  app.get("/networks", (c) => c.json({
    sepolia: { ready: true, publisher: chain("sepolia").account, quickNames: true },
    mainnet: { ready: mainnetReady(), publisher: mainnetReady() ? chain("mainnet").account : null, quickNames: false },
    // "local" runs builds as a plain process on this machine: no keys in its environment, but not isolated.
    buildSandbox: process.env.BUILD_SANDBOX === "local" ? "local" : "docker",
  }));
  app.route("/auth", auth);
  app.route("/github", github);
  app.route("/names", names);
  app.route("/projects", projects);
  app.route("/deploys", deploys);
  app.onError((e: any, c) => {
    if (e instanceof ZodError) return c.json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    if (e.status) return c.json({ error: e.message }, e.status);
    console.error(e);
    return c.json({ error: "Internal error" }, 500);
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}`);
    process.exit(1);
  }
  await migrate();
  await startWorker();
  if (Number(process.env.PUSH_POLL_SECONDS)) startPushWatcher(Number(process.env.PUSH_POLL_SECONDS) * 1000);
  startBot();
  const port = Number(process.env.PORT ?? 3001);
  serve({ fetch: createApp().fetch, port });
  console.log(`ENSure API on http://localhost:${port}`);
}
