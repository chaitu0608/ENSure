// Writes deployments/<network>.json from the chain, after the Setup page has run. Read-only: no keys, no transactions.
//   pnpm sync-deployment mainnet <name.eth> <publisher address>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { NETWORKS, findOwner, labelId, registryAbi, helperAbi, dnsEncode, type Network } from "@ensure/core/ens";

const [network, name, publisher] = process.argv.slice(2) as [Network, string, string];
if (!(network in NETWORKS) || !/^[a-z0-9-]+\.eth$/.test(name ?? "") || !isAddress(publisher ?? "")) {
  console.error("Usage: pnpm sync-deployment <mainnet|sepolia> <name.eth> <publisher address>");
  process.exit(1);
}
const a = NETWORKS[network];
const rpc = network === "mainnet" ? process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com" : process.env.SEPOLIA_RPC_URL;
const client = createPublicClient({ chain: network === "mainnet" ? mainnet : sepolia, transport: http(rpc, { timeout: 30_000 }) });
const label = name.split(".")[0];
const ZERO = "0x0000000000000000000000000000000000000000";

const owner = await findOwner(client, name);
const registry: Address = await client.readContract({ address: a.universalHelper, abi: helperAbi, functionName: "findExactRegistry", args: [dnsEncode(name)] });
const [parent, prod, prodResolver, previewResolver, head] = await Promise.all([
  client.readContract({ address: a.ethRegistry, abi: registryAbi, functionName: "getState", args: [labelId(label)] }),
  client.readContract({ address: registry, abi: registryAbi, functionName: "getState", args: [labelId("prod")] }),
  client.readContract({ address: registry, abi: registryAbi, functionName: "getResolver", args: ["prod"] }),
  client.readContract({ address: registry, abi: registryAbi, functionName: "getResolver", args: ["preview"] }),
  client.getBlockNumber(),
]);
if (prodResolver === ZERO || previewResolver === ZERO) throw new Error(`${name} isn't set up yet: run the Setup page first`);
if (prodResolver.toLowerCase() === previewResolver.toLowerCase()) throw new Error(`${name} shares one resolver for prod and preview, which isn't safe`);

const file = new URL(`../deployments/${network}.json`, import.meta.url);
const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
writeFileSync(file, JSON.stringify({
  ...saved,
  chainId: a.chainId,
  mode: network,
  label,
  projectName: name,
  prodName: `prod.${name}`,
  previewName: `preview.${name}`,
  registry,
  prodResolver,
  previewResolver,
  owner: getAddress(owner),
  ci: getAddress(publisher),
  projectResource: parent.resource.toString(),
  prodResource: prod.resource.toString(),
  minRelease: "1",
  releaseController: null,
  historyFromBlock: Number(head) - 300,
}, null, 2) + "\n");
console.log(`Wrote deployments/${network}.json for ${name}. prod ${prodResolver}, preview ${previewResolver}, owner ${owner}.`);
