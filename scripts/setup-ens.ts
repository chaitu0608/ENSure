// One-time setup. Registers the name first if nobody has it yet, paying in free test USDC.
//   SEPOLIA_RPC_URL must be set. The signer is SETUP_PRIVATE_KEY, else OWNER_PRIVATE_KEY.
//   The publisher is PUBLISHER_ADDRESS, else the PUBLISHER_PRIVATE_KEY account.
//   pnpm setup-ens platform <name.eth>     quick names
//   pnpm setup-ens project  <name.eth>     a protected project
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { allowLogging, registerName, setupPlatform, setupProject, signerFrom } from "@ensure/core/setup";

const [kind, name] = process.argv.slice(2);
const { SEPOLIA_RPC_URL: rpc, DEPLOY_REGISTRY: log } = process.env;
const key = process.env.SETUP_PRIVATE_KEY || process.env.OWNER_PRIVATE_KEY;
const publisher = process.env.PUBLISHER_ADDRESS || (process.env.PUBLISHER_PRIVATE_KEY && privateKeyToAccount(process.env.PUBLISHER_PRIVATE_KEY as Hex).address);
if (!["platform", "project"].includes(kind) || !name || !key || !rpc || !publisher) {
  console.error("Usage: pnpm setup-ens <platform|project> <name.eth>, with SEPOLIA_RPC_URL, a signer key and a publisher set. See the top of scripts/setup-ens.ts");
  process.exit(1);
}

// MetaMask exports keys without the 0x prefix.
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const transport = http(rpc, { timeout: 60_000 });
const signer = signerFrom({
  public: createPublicClient({ chain: sepolia, transport }),
  wallet: createWalletClient({ chain: sepolia, transport, account }) as any,
  account: account.address,
});

const file = new URL("../deployments/sepolia.json", import.meta.url);
const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { chainId: 11155111 };

await registerName(signer, name, console.log);

if (kind === "platform") {
  const p = await setupPlatform(signer, name, publisher as Address);
  saved.platform = p;
  console.log(`PLATFORM_NAME=${p.name}\nPLATFORM_REGISTRY=${p.registry}\nPLATFORM_RESOLVER=${p.resolver}`);
} else {
  const p = await setupProject(signer, name, publisher as Address);
  if (log) await allowLogging(signer, log as Address, p.previewName, publisher as Address);
  (saved.projects ??= {})[name] = p;
  console.log(`${p.previewName} is ready. The publisher can write preview, and can't write ${p.prodName}.`);
}
writeFileSync(file, JSON.stringify(saved, null, 2) + "\n");
