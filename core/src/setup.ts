// One-time name setup. The owner signs every step.
import { encodeFunctionData, keccak256, parseEventLogs, toHex, type Address, type Hex } from "viem";
import { BUILD_RECORD, RESOLVER_ROLES as R, REGISTRY_ROLES as G, SEPOLIA, deployRegistryAbi, dnsEncode, factoryAbi, helperAbi, labelId, registrarAbi, registryAbi, resolverAbi, testUsdcAbi, withAdmin } from "./ens";

export type Signer = {
  account: Address;
  /** Sends a transaction and resolves to the mined receipt. Throws on revert. */
  send: (tx: { address: Address; abi: any; functionName: string; args: any[] }) => Promise<{ logs: any[] }>;
  read: (tx: { address: Address; abi: any; functionName: string; args: any[] }) => Promise<any>;
};

const ZERO: Address = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32: Hex = `0x${"0".repeat(64)}`;
const COMMITMENT_WAIT_MS = 90_000; // the registrar wants 60 seconds, by block time, which lags the clock
const FAR_FUTURE = () => BigInt(Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600);

async function deployProxy(s: Signer, implementation: Address, tag: string, data: Hex): Promise<Address> {
  const salt = BigInt(keccak256(toHex(`ensure:${tag}:${s.account}`)));
  const receipt = await s.send({
    address: SEPOLIA.verifiableFactory, abi: factoryAbi, functionName: "deployProxy", args: [implementation, salt, data],
  });
  const [event] = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "ProxyDeployed" });
  if (!event) throw new Error("ProxyDeployed event missing");
  return event.args.proxyAddress;
}

const deployResolver = (s: Signer, tag: string) =>
  deployProxy(s, SEPOLIA.resolverImpl, `resolver:${tag}`, encodeFunctionData({
    abi: resolverAbi, functionName: "initialize",
    args: [[{ account: s.account, roleBitmap: withAdmin(R.SET_CONTENTHASH, R.SET_TEXT, R.LINK, R.UPGRADE) }], []],
  }));

/** Registers name.eth to the signer through the public registrar, unless the signer already owns it. Takes about two minutes: the registrar requires a wait after the commitment. */
export async function registerName(s: Signer, name: string, log: (l: string) => void = () => {}) {
  const [label, ...rest] = name.split(".");
  if (rest.join(".") !== "eth" || !label) throw new Error("name must be a second-level .eth name");
  const registrar = { address: SEPOLIA.ethRegistrar, abi: registrarAbi };
  if (!(await s.read({ ...registrar, functionName: "isAvailable", args: [label] }))) {
    const owner: Address = await s.read({ address: SEPOLIA.universalHelper, abi: helperAbi, functionName: "findExactOwner", args: [dnsEncode(name)] });
    if (owner.toLowerCase() !== s.account.toLowerCase()) throw new Error(`${name} belongs to ${owner}. Pick another name, or sign with that wallet`);
    return;
  }
  log(`Registering ${name} (about two minutes)`);
  const usdc = { address: SEPOLIA.testUsdc, abi: testUsdcAbi };
  const duration = 365 * 86400;
  const [base, premium]: [bigint, bigint] = await s.read({ ...registrar, functionName: "getRegisterPrice", args: [label, duration, SEPOLIA.testUsdc] });
  await s.send({ ...usdc, functionName: "mint", args: [s.account, base + premium] });
  await s.send({ ...usdc, functionName: "approve", args: [SEPOLIA.ethRegistrar, base + premium] });
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const commitment = await s.read({ ...registrar, functionName: "makeCommitment", args: [label, s.account, secret, ZERO, ZERO, duration, ZERO_BYTES32] });
  await s.send({ ...registrar, functionName: "commit", args: [commitment] });
  await new Promise((r) => setTimeout(r, COMMITMENT_WAIT_MS));
  await s.send({ ...registrar, functionName: "register", args: [label, s.account, secret, ZERO, ZERO, duration, SEPOLIA.testUsdc, ZERO_BYTES32] });
}

/** Gives name.eth its own registry. Refuses a name that has one: replacing it would orphan every name below. */
async function deployChildRegistry(s: Signer, parentName: string): Promise<Address> {
  const [label, ...rest] = parentName.split(".");
  if (rest.join(".") !== "eth" || !label) throw new Error("parent must be a second-level .eth name");
  const existing: Address = await s.read({ address: SEPOLIA.ethRegistry, abi: registryAbi, functionName: "getSubregistry", args: [label] });
  if (existing !== ZERO) throw new Error(`${parentName} already has a registry. Setting up again would replace it and orphan its names`);
  const registry = await deployProxy(s, SEPOLIA.registryImpl, `registry:${parentName}`, encodeFunctionData({
    abi: registryAbi, functionName: "initialize",
    args: [[{ account: s.account, roleBitmap: withAdmin(G.REGISTRAR, G.SET_PARENT, G.UPGRADE) }]],
  }));
  await s.send({ address: SEPOLIA.ethRegistry, abi: registryAbi, functionName: "setSubregistry", args: [labelId(label), registry] });
  await s.send({ address: registry, abi: registryAbi, functionName: "setParent", args: [SEPOLIA.ethRegistry, label] });
  return registry;
}

/** Quick names: one registry and one shared resolver. The publisher can write them all. */
export async function setupPlatform(s: Signer, parentName: string, publisher: Address) {
  const registry = await deployChildRegistry(s, parentName);
  const resolver = await deployResolver(s, `platform:${parentName}`);
  await s.send({ address: registry, abi: registryAbi, functionName: "grantRootRoles", args: [G.REGISTRAR, publisher] });
  await s.send({ address: resolver, abi: resolverAbi, functionName: "grantRootRoles", args: [R.SET_CONTENTHASH | R.SET_TEXT, publisher] });
  return { name: parentName, registry, resolver };
}

/** Protected project: preview and prod tokens with separate resolvers. The publisher gets preview only. */
export async function setupProject(s: Signer, parentName: string, publisher: Address) {
  const registry = await deployChildRegistry(s, parentName);
  const previewResolver = await deployResolver(s, `preview:${parentName}`);
  const prodResolver = await deployResolver(s, `prod:${parentName}`);
  const expiry = FAR_FUTURE();
  // No transfer admin: these tokens can't be moved.
  const bitmap = withAdmin(G.SET_RESOLVER, G.RENEW);
  for (const [label, resolver] of [["preview", previewResolver], ["prod", prodResolver]] as const) {
    await s.send({
      address: registry, abi: registryAbi, functionName: "register",
      args: [label, s.account, ZERO, resolver, bitmap, expiry],
    });
  }
  const previewName = `preview.${parentName}`;
  await s.send({ address: previewResolver, abi: resolverAbi, functionName: "grantRootRoles", args: [R.SET_CONTENTHASH, publisher] });
  await s.send({
    address: previewResolver, abi: resolverAbi, functionName: "grantSetterRoles",
    args: [encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode(previewName), BUILD_RECORD, ""] }), publisher],
  });
  return { name: parentName, registry, previewResolver, prodResolver, previewName, prodName: `prod.${parentName}` };
}

/** Lets a publisher write the on-chain deploy log for a name. The caller must own the name. */
export const allowLogging = (s: Signer, deployRegistry: Address, name: string, publisher: Address) =>
  s.send({ address: deployRegistry, abi: deployRegistryAbi, functionName: "setPublisher", args: [dnsEncode(name), publisher, true] });

type Clients = { public: { waitForTransactionReceipt: (a: any) => Promise<any>; simulateContract: (a: any) => Promise<any>; readContract: (a: any) => Promise<any> }; wallet: { writeContract: (a: any) => Promise<Hex> }; account: Address };

export const signerFrom = (c: Clients): Signer => ({
  account: c.account,
  read: (tx) => c.public.readContract(tx),
  send: async (tx) => {
    await c.public.simulateContract({ ...tx, account: c.account }); // surfaces the revert reason
    const hash = await c.wallet.writeContract(tx); // the wallet client holds the signing account
    const receipt = await c.public.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${tx.functionName} reverted: ${hash}`);
    return receipt;
  },
});
