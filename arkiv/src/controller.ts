import { createPublicClient, http, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { commitDigest, manifestDigest as digestManifest, parseManifest } from "@ensure/core/manifest";
import { decodeContenthash, readText, sameCid } from "@ensure/core/ens";
import { controllerEventId } from "./validate";
import { recordReleaseEvent } from "./write";

const controllerAbi = parseAbi([
  "event ReleasePromoted(bytes32 indexed releaseId, bytes32 indexed previousReleaseId, address indexed approver, string manifestCid, bytes32 manifestDigest, bytes32 commitDigest)",
  "event ReleaseRolledBack(bytes32 indexed releaseId, bytes32 indexed fromReleaseId, address indexed caller)",
  "event ReleaseRecovered(bytes32 indexed releaseId, bytes32 indexed fromReleaseId, address indexed caller, string reason)",
  "function projectNode() view returns (bytes32)",
  "function ownerSafe() view returns (address)",
  "function recoveryAuthority() view returns (address)",
  "function getRelease(bytes32 releaseId) view returns ((bytes contenthash, string manifestCid, bytes32 manifestDigest, bytes32 commitDigest, bytes32 previousReleaseId, address approver, uint64 approvedAt))",
]);

async function fetchManifest(cid: string) {
  const gateways = (process.env.IPFS_GATEWAYS ?? "https://ipfs.io,https://dweb.link").split(",").map((s) => s.trim()).filter(Boolean);
  let lastError = "no IPFS gateway configured";
  for (const gateway of gateways) {
    try {
      const response = await fetch(`${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { lastError = `${gateway} returned ${response.status}`; continue; }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { manifest: parseManifest(bytes), bytes };
    } catch (error) {
      lastError = `${gateway}: ${(error as Error).message}`;
    }
  }
  throw new Error(`Unable to fetch canonical manifest: ${lastError}`);
}

/**
 * Validates an executed Sepolia controller transaction before mirroring it to Rabdi.
 * The supplied controller must also match the ENS production pointer.
 */
export async function recordControllerEventFromTransaction(input: {
  projectName: string;
  projectNode: Hex;
  controllerAddress: Address;
  transactionHash: Hex;
}) {
  const source = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL, { timeout: 10_000 }) });
  if (await source.getChainId() !== 11155111) throw new Error("Source RPC is not Sepolia");
  const receipt = await source.getTransactionReceipt({ hash: input.transactionHash });
  if (receipt.status !== "success") throw new Error("Controller transaction failed");
  const latestBlock = await source.getBlockNumber();
  const confirmations = Number(process.env.ARKIV_SOURCE_CONFIRMATIONS ?? 1);
  if (!Number.isInteger(confirmations) || confirmations < 1) throw new Error("ARKIV_SOURCE_CONFIRMATIONS must be a positive integer");
  if (latestBlock - receipt.blockNumber + 1n < BigInt(confirmations)) throw new Error("Controller transaction is not sufficiently confirmed");

  const pointer = await readText(source, `prod.${input.projectName}`, "ensure.controller");
  if (!pointer || pointer.toLowerCase() !== input.controllerAddress.toLowerCase()) {
    throw new Error("Controller address does not match prod ENS ensure.controller");
  }
  const code = await source.getCode({ address: input.controllerAddress });
  if (!code || code === "0x") throw new Error("No contract code at controller address");

  const [chainProjectNode, ownerSafe, recoveryAuthority] = await Promise.all([
    source.readContract({ address: input.controllerAddress, abi: controllerAbi, functionName: "projectNode" }),
    source.readContract({ address: input.controllerAddress, abi: controllerAbi, functionName: "ownerSafe" }),
    source.readContract({ address: input.controllerAddress, abi: controllerAbi, functionName: "recoveryAuthority" }),
  ]);
  if (chainProjectNode.toLowerCase() !== input.projectNode.toLowerCase()) throw new Error("Controller projectNode mismatch");

  const logs = receipt.logs.filter((log) => log.address.toLowerCase() === input.controllerAddress.toLowerCase());
  const parsed = parseEventLogs({ abi: controllerAbi, logs, strict: true });
  const action = parsed.find((event) => ["ReleasePromoted", "ReleaseRolledBack", "ReleaseRecovered"].includes(event.eventName));
  if (!action) throw new Error("Transaction has no supported controller release event");
  const event = action as (typeof action) & { eventName: "ReleasePromoted" | "ReleaseRolledBack" | "ReleaseRecovered"; args: any; logIndex: number };
  const args = event.args;
  const releaseId = args.releaseId as Hex;
  const stored = await source.readContract({
    address: input.controllerAddress,
    abi: controllerAbi,
    functionName: "getRelease",
    args: [releaseId],
  }) as any;

  if (event.eventName === "ReleasePromoted") {
    if (String(args.approver).toLowerCase() !== ownerSafe.toLowerCase()) throw new Error("Promotion was not approved by controller ownerSafe");
    if (args.manifestCid !== stored.manifestCid || args.manifestDigest.toLowerCase() !== stored.manifestDigest.toLowerCase() || args.commitDigest.toLowerCase() !== stored.commitDigest.toLowerCase()) {
      throw new Error("Promotion log does not match the controller's stored release");
    }
    if (args.previousReleaseId.toLowerCase() !== stored.previousReleaseId.toLowerCase()) throw new Error("Promotion previousReleaseId mismatch");
  } else if (event.eventName === "ReleaseRolledBack") {
    if (String(args.caller).toLowerCase() !== ownerSafe.toLowerCase()) throw new Error("Rollback caller is not controller ownerSafe");
  } else if (String(args.caller).toLowerCase() !== recoveryAuthority.toLowerCase()) {
    throw new Error("Recovery caller is not controller recoveryAuthority");
  }

  const { manifest, bytes } = await fetchManifest(stored.manifestCid);
  if (digestManifest(bytes).toLowerCase() !== stored.manifestDigest.toLowerCase()) throw new Error("Manifest digest does not match controller release");
  if (commitDigest(manifest.commitSha).toLowerCase() !== stored.commitDigest.toLowerCase()) throw new Error("Manifest commit does not match controller release");
  if (!sameCid(decodeContenthash(stored.contenthash), manifest.siteCid)) throw new Error("Manifest site CID does not match controller contenthash");

  const fromReleaseId = event.eventName === "ReleasePromoted" ? (args.previousReleaseId as Hex) : (args.fromReleaseId as Hex);
  return recordReleaseEvent({
    projectNode: input.projectNode,
    eventId: controllerEventId(11155111, input.controllerAddress, input.transactionHash, event.logIndex),
    eventType: event.eventName === "ReleasePromoted" ? "PROMOTED" : event.eventName === "ReleaseRolledBack" ? "ROLLBACK" : "RECOVERED",
    releaseId,
    ...(fromReleaseId !== `0x${"0".repeat(64)}` ? { fromReleaseId } : {}),
    commitSha: manifest.commitSha,
    manifestCid: stored.manifestCid,
    manifestDigest: stored.manifestDigest,
    siteCid: manifest.siteCid,
    commitDigest: stored.commitDigest,
    sourceTx: input.transactionHash,
    sourceContract: input.controllerAddress,
    sourceChain: 11155111,
    sourceBlock: receipt.blockNumber,
    sourceLogIndex: event.logIndex,
  });
}
