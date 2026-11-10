// One-time name setup. The owner signs every step.
import { encodeFunctionData, keccak256, parseEventLogs, toBytes, toHex, type Address, type Hex } from "viem";
import { BUILD_RECORD, MAINNET, NETWORKS, RESOLVER_ROLES as R, REGISTRY_ROLES as G, SEPOLIA, deployRegistryAbi, dnsEncode, factoryAbi, helperAbi, labelId, registrarAbi, registryAbi, resolverAbi, testUsdcAbi, withAdmin } from "./ens";

export type Signer = {
  account: Address;
  /** Which ENSv2 deployment to use. Sepolia unless the signer's client is on mainnet. */
  chainId?: number;
  /** Sends a transaction and resolves to the mined receipt. Throws on revert. */
  send: (tx: { address: Address; abi: any; functionName: string; args: any[] }) => Promise<{ logs: any[] }>;
  read: (tx: { address: Address; abi: any; functionName: string; args: any[] }) => Promise<any>;
};

const net = (s: Signer) => (s.chainId === MAINNET.chainId ? NETWORKS.mainnet : NETWORKS.sepolia);
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32: Hex = `0x${"0".repeat(64)}`;
const COMMITMENT_WAIT_MS = 90_000; // the registrar wants 60 seconds, by block time, which lags the clock
const FAR_FUTURE = () => BigInt(Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600);

async function deployProxy(s: Signer, implementation: Address, tag: string, data: Hex): Promise<Address> {
  const salt = BigInt(keccak256(toHex(`ensure:${tag}:${s.account}`)));
  const receipt = await s.send({
    address: net(s).verifiableFactory, abi: factoryAbi, functionName: "deployProxy", args: [implementation, salt, data],
  });
  const [event] = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "ProxyDeployed" });
  if (!event) throw new Error("ProxyDeployed event missing");
  return event.args.proxyAddress;
}

const deployResolver = (s: Signer, tag: string) =>
  deployProxy(s, net(s).resolverImpl, `resolver:${tag}`, encodeFunctionData({
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
async function deployChildRegistry(s: Signer, parentName: string, reuse = false): Promise<Address> {
  const [label, ...rest] = parentName.split(".");
  if (rest.join(".") !== "eth" || !label) throw new Error("parent must be a second-level .eth name");
  const existing: Address = await s.read({ address: net(s).ethRegistry, abi: registryAbi, functionName: "getSubregistry", args: [label] });
  if (existing !== ZERO) {
    if (!reuse) throw new Error(`${parentName} already has a registry. Setting up again would replace it and orphan its names`);
    // Never replace a registry: that would orphan its names. Use it, if this wallet can register in it.
    if (!(await s.read({ address: existing, abi: registryAbi, functionName: "hasRootRoles", args: [G.REGISTRAR, s.account] }))) {
      throw new Error(`${parentName} already has a registry at ${existing}, and this wallet can't register names in it`);
    }
    return existing;
  }
  const registry = await deployProxy(s, net(s).registryImpl, `registry:${parentName}`, encodeFunctionData({
    abi: registryAbi, functionName: "initialize",
    args: [[{ account: s.account, roleBitmap: withAdmin(G.REGISTRAR, G.SET_PARENT, G.UPGRADE) }]],
  }));
  await s.send({ address: net(s).ethRegistry, abi: registryAbi, functionName: "setSubregistry", args: [labelId(label), registry] });
  await s.send({ address: registry, abi: registryAbi, functionName: "setParent", args: [net(s).ethRegistry, label] });
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

/**
 * Protected project: preview and prod tokens with separate resolvers. The publisher gets preview only.
 * With resume, steps already on-chain are skipped, so a wallet flow that stopped halfway can simply run again.
 */
export async function setupProject(s: Signer, parentName: string, publisher: Address, opts: { resume?: boolean; log?: (line: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  log("Name registry");
  const registry = await deployChildRegistry(s, parentName, opts.resume);
  const expiry = await projectExpiry(s, parentName);
  // No transfer admin: these tokens can't be moved.
  const bitmap = withAdmin(G.SET_RESOLVER, G.RENEW);
  const resolverFor = async (label: "preview" | "prod") => {
    if (opts.resume) {
      const existing: Address = await s.read({ address: registry, abi: registryAbi, functionName: "getResolver", args: [label] });
      if (existing !== ZERO) { log(`${label}.${parentName} is already set up`); return existing; }
    }
    log(`${label} resolver`);
    // A retry can't reuse a salt from a resolver that deployed before a failure.
    const resolver = await deployResolver(s, `${label}:${parentName}${opts.resume ? `:${Date.now()}` : ""}`);
    log(`Register ${label}.${parentName}`);
    await s.send({ address: registry, abi: registryAbi, functionName: "register", args: [label, s.account, ZERO, resolver, bitmap, expiry] });
    return resolver;
  };
  const previewResolver = await resolverFor("preview");
  const prodResolver = await resolverFor("prod");
  const previewName = `preview.${parentName}`;
  const hasRoot = await s.read({ address: previewResolver, abi: resolverAbi, functionName: "hasRootRoles", args: [R.SET_CONTENTHASH, publisher] });
  if (!hasRoot) {
    log("Let the publisher write the preview contenthash");
    await s.send({ address: previewResolver, abi: resolverAbi, functionName: "grantRootRoles", args: [R.SET_CONTENTHASH, publisher] });
  }
  const hasBuild = await s.read({ address: previewResolver, abi: resolverAbi, functionName: "hasRoles", args: [BigInt(keccak256(toBytes(BUILD_RECORD))), R.SET_TEXT, publisher] });
  if (!hasBuild) {
    log(`Let the publisher write ${BUILD_RECORD} on preview`);
    await s.send({
      address: previewResolver, abi: resolverAbi, functionName: "grantSetterRoles",
      args: [encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode(previewName), BUILD_RECORD, ""] }), publisher],
    });
  }
  return { name: parentName, registry, previewResolver, prodResolver, previewName, prodName: `prod.${parentName}` };
}

/** Subnames can't outlive the parent. Ten years, or the parent's expiry if that comes first. */
async function projectExpiry(s: Signer, parentName: string): Promise<bigint> {
  const state = await s.read({ address: net(s).ethRegistry, abi: registryAbi, functionName: "getState", args: [labelId(parentName.split(".")[0])] });
  const parent = BigInt(state.expiry);
  return parent > 0n && parent < FAR_FUTURE() ? parent : FAR_FUTURE();
}

export type NameStatus = { status: "available" | "reserved" | "registered"; owner: Address; expiry: bigint; subregistry: Address };

/** Where a .eth name stands in ENSv2. "reserved" means it's still a v1 name, waiting to be migrated by its owner. */
export async function readNameStatus(read: Signer["read"], chainId: number, name: string): Promise<NameStatus> {
  const addresses = chainId === MAINNET.chainId ? NETWORKS.mainnet : NETWORKS.sepolia;
  const label = name.split(".")[0];
  const [state, subregistry] = await Promise.all([
    read({ address: addresses.ethRegistry, abi: registryAbi, functionName: "getState", args: [labelId(label)] }),
    read({ address: addresses.ethRegistry, abi: registryAbi, functionName: "getSubregistry", args: [label] }),
  ]);
  return { status: state.status === 2 ? "registered" : state.status === 1 ? "reserved" : "available", owner: state.latestOwner, expiry: BigInt(state.expiry), subregistry };
}

/** Lets a publisher write the on-chain deploy log for a name. The caller must own the name. */
export const allowLogging = (s: Signer, deployRegistry: Address, name: string, publisher: Address) =>
  s.send({ address: deployRegistry, abi: deployRegistryAbi, functionName: "setPublisher", args: [dnsEncode(name), publisher, true] });

type Clients = { public: { chain?: { id: number }; waitForTransactionReceipt: (a: any) => Promise<any>; simulateContract: (a: any) => Promise<any>; readContract: (a: any) => Promise<any> }; wallet: { writeContract: (a: any) => Promise<Hex> }; account: Address };

export const signerFrom = (c: Clients): Signer => ({
  account: c.account,
  chainId: c.public.chain?.id,
  read: (tx) => c.public.readContract(tx),
  send: async (tx) => {
    await c.public.simulateContract({ ...tx, account: c.account }); // surfaces the revert reason
    const hash = await c.wallet.writeContract(tx); // the wallet client holds the signing account
    const receipt = await c.public.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${tx.functionName} reverted: ${hash}`);
    return receipt;
  },
});
