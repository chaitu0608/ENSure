// Reads who can do what on ENSv2, from the chain. Simulates writes with eth_call, so nothing here sends a transaction.
import { encodeFunctionData, getAddress, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { RESOLVER_ROLES, dnsEncode, labelId, registryAbi, resolverAbi } from "@ensure/core/ens";
import { deployment, publicClient } from "./config";
import { readCurrentProjectOwner } from "./verify";

export type Verdict = "allowed" | "blocked" | "unknown";
export type Role = "owner" | "publisher" | "controller" | "platform";
/** One column per distinct address. A wallet holding two roles is one actor with both, never two columns. */
export type Actor = { id: string; label: string; address: Address; roles: Role[]; isYou: boolean };
export type PermissionRow = { id: string; environment: "Production" | "Preview"; action: string; to: Address; data: Hex; results: Record<string, Verdict> };
export type RoleEntry = { actor: string; resolver: "Production" | "Preview"; scope: string; roles: string[] };
export type NameToken = { name: string; tokenId: bigint; owner: Address };
export type Authority = {
  actors: Actor[];
  rows: PermissionRow[];
  roles: RoleEntry[];
  tokens: NameToken[];
  /** Holds only if every production write reverted for the publisher. An unreadable result never counts as holding. */
  boundary: "holds" | "broken" | "unknown";
  /** The owner and publisher are one wallet, so the separation the demo shows doesn't exist. */
  sharedOwnerPublisher: boolean;
  block: bigint;
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", publisher: "Publisher", controller: "Release controller", platform: "Quick-name parent owner" };

/** Groups role holders by address. The connected wallet joins an existing actor if it holds a role, else becomes its own. */
export function groupWallets(holders: { role: Role; address: Address }[], connected?: Address): Actor[] {
  const byAddress = new Map<string, Actor>();
  for (const { role, address } of holders) {
    const key = address.toLowerCase();
    const actor = byAddress.get(key) ?? { id: key, label: "", address: getAddress(address), roles: [], isYou: false };
    if (!actor.roles.includes(role)) actor.roles.push(role);
    byAddress.set(key, actor);
  }
  if (connected) {
    const key = connected.toLowerCase();
    const actor = byAddress.get(key) ?? { id: key, label: "", address: getAddress(connected), roles: [], isYou: false };
    actor.isYou = true;
    byAddress.set(key, actor);
  }
  return [...byAddress.values()].map((actor) => ({ ...actor, label: actor.roles.length ? actor.roles.map((r) => ROLE_LABEL[r]).join(" + ") : "Connected wallet" }));
}

const eacAbi = parseAbi(["function roles(uint256 resource, address account) view returns (uint256)"]);
const ROOT_RESOURCE = 0n;
const ROLE_NAMES: [string, bigint][] = [
  ["SET_TEXT", RESOLVER_ROLES.SET_TEXT],
  ["SET_CONTENTHASH", RESOLVER_ROLES.SET_CONTENTHASH],
  ["LINK", RESOLVER_ROLES.LINK],
  ["UPGRADE", RESOLVER_ROLES.UPGRADE],
];
// A valid-shaped contenthash. These calls are simulated, so it is never written.
const PROBE_CONTENTHASH: Hex = `0xe30101701220${"00".repeat(32)}`;

export function decodeRoles(bitmap: bigint): string[] {
  const names: string[] = [];
  for (const [name, role] of ROLE_NAMES) {
    if (bitmap & role) names.push(name);
    if (bitmap & (role << 128n)) names.push(`${name} admin`);
  }
  return names;
}

/** A revert is a real answer. Any other failure means we could not find out, and must not read as blocked. */
async function simulate(account: Address, to: Address, data: Hex): Promise<Verdict> {
  try {
    await publicClient.call({ account, to, data });
    return "allowed";
  } catch (error) {
    return /revert/i.test(error instanceof Error ? error.message : String(error)) ? "blocked" : "unknown";
  }
}

export async function readAuthority(connected?: Address): Promise<Authority> {
  const prodName = deployment.prodName, previewName = deployment.previewName;
  const prod = deployment.prodResolver as Address, preview = deployment.previewResolver as Address, registry = deployment.registry as Address;
  const publisher = deployment.ci as Address;
  const [owner, block] = await Promise.all([readCurrentProjectOwner(), publicClient.getBlockNumber()]);
  const holders: { role: Role; address: Address }[] = [{ role: "owner", address: owner }, { role: "publisher", address: publisher }];
  if (deployment.releaseController) holders.push({ role: "controller", address: deployment.releaseController });
  const actors = groupWallets(holders, connected);

  const setHash = (name: string) => encodeFunctionData({ abi: resolverAbi, functionName: "setContenthash", args: [dnsEncode(name), PROBE_CONTENTHASH] });
  const setText = (name: string, key: string) => encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode(name), key, "probe"] });
  const planned: Omit<PermissionRow, "results">[] = [
    { id: "prod-hash", environment: "Production", action: "Change the site contenthash", to: prod, data: setHash(prodName) },
    { id: "prod-approval", environment: "Production", action: "Write ensure.approval", to: prod, data: setText(prodName, "ensure.approval") },
    { id: "prod-grant", environment: "Production", action: "Grant a role on the resolver", to: prod, data: encodeFunctionData({ abi: resolverAbi, functionName: "grantRootRoles", args: [RESOLVER_ROLES.SET_CONTENTHASH, publisher] }) },
    { id: "prod-repoint", environment: "Production", action: "Point the name at another resolver", to: registry, data: encodeFunctionData({ abi: registryAbi, functionName: "setResolver", args: [labelId("prod"), publisher] }) },
    { id: "preview-hash", environment: "Preview", action: "Change the site contenthash", to: preview, data: setHash(previewName) },
    { id: "preview-build", environment: "Preview", action: "Write ensure.build", to: preview, data: setText(previewName, "ensure.build") },
    { id: "preview-approval", environment: "Preview", action: "Write any other text record", to: preview, data: setText(previewName, "ensure.approval") },
  ];
  const rows = await Promise.all(planned.map(async (row) => {
    const results = await Promise.all(actors.map(async (actor) => [actor.id, await simulate(actor.address, row.to, row.data)] as const));
    return { ...row, results: Object.fromEntries(results) };
  }));

  const buildResource = BigInt(keccak256(toBytes("ensure.build")));
  const rolesFor = async (actor: Actor, resolver: Address, label: RoleEntry["resolver"], resource: bigint, scope: string): Promise<RoleEntry> => {
    const bitmap = await publicClient.readContract({ address: resolver, abi: eacAbi, functionName: "roles", args: [resource, actor.address] });
    return { actor: actor.id, resolver: label, scope, roles: decodeRoles(bitmap) };
  };
  const roles = await Promise.all(actors.flatMap((actor) => [
    rolesFor(actor, prod, "Production", ROOT_RESOURCE, "All records"),
    rolesFor(actor, preview, "Preview", ROOT_RESOURCE, "All records"),
    rolesFor(actor, preview, "Preview", buildResource, "ensure.build only"),
  ]));

  const tokens = await Promise.all(([["prod", prodName], ["preview", previewName]] as const).map(async ([label, name]) => {
    const tokenId = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getTokenId", args: [labelId(label)] });
    const tokenOwner = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "ownerOf", args: [tokenId] });
    return { name, tokenId, owner: tokenOwner };
  }));

  const publisherId = publisher.toLowerCase();
  const onProd = rows.filter((row) => row.environment === "Production").map((row) => row.results[publisherId]);
  const boundary = onProd.includes("allowed") ? "broken" : onProd.includes("unknown") ? "unknown" : "holds";
  return { actors, rows, roles, tokens, boundary, sharedOwnerPublisher: owner.toLowerCase() === publisherId, block };
}

export type QuickAuthority = { name: string; parent: string; actors: Actor[]; rows: PermissionRow[]; projectOwner: Address; block: bigint };

/** A quick name has no owner approval: the server's publishing key writes it directly. This shows who holds what over it. */
export async function readQuickNameAuthority(name: string, connected?: Address): Promise<QuickAuthority> {
  const platform = deployment.platform;
  if (!platform) throw new Error("Quick names aren't configured on this network");
  const resolver = platform.resolver as Address;
  const helper = parseAbi(["function findExactOwner(bytes name) view returns (address)"]);
  const [parentOwner, projectOwner, block] = await Promise.all([
    publicClient.readContract({ address: deployment.protocol.universalHelper, abi: helper, functionName: "findExactOwner", args: [dnsEncode(platform.name)] }),
    readCurrentProjectOwner(),
    publicClient.getBlockNumber(),
  ]);
  const actors = groupWallets([{ role: "platform", address: parentOwner }, { role: "publisher", address: deployment.ci as Address }], connected);
  const planned: Omit<PermissionRow, "results">[] = [
    { id: "quick-hash", environment: "Production", action: "Change this site's contenthash", to: resolver, data: encodeFunctionData({ abi: resolverAbi, functionName: "setContenthash", args: [dnsEncode(name), PROBE_CONTENTHASH] }) },
    { id: "quick-text", environment: "Production", action: "Change its text records", to: resolver, data: encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode(name), "ensure.build", "probe"] }) },
  ];
  const rows = await Promise.all(planned.map(async (row) => ({ ...row, results: Object.fromEntries(await Promise.all(actors.map(async (a) => [a.id, await simulate(a.address, row.to, row.data)] as const))) })));
  return { name, parent: platform.name, actors, rows, projectOwner, block };
}
