import { parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { decodeContenthash } from "@ensure/core/ens";
import type { Envelope } from "../../../tools/ensure-sepolia/scripts/release-approval";
import { bytesCid } from "../../../tools/ensure-sepolia/scripts/owner-promote-shared";
import { controllerAbi } from "../../../tools/ensure-sepolia/scripts/controller-v2";
import { deployment, publicClient } from "./config";

export type ReleaseRow = {
  id: string;
  /** "unapproved": production changed with no owner approval in the same transaction. */
  kind: "promoted" | "rollback" | "recovered" | "unapproved";
  release?: string;
  /** Controller artifact ID; only set for controller-approved releases, which are the only controller rollback targets. */
  releaseId?: Hex;
  cid?: string;
  manifestCid?: string;
  buildManifestCid?: string;
  commit?: string;
  approver?: string;
  timestamp?: number;
  block?: bigint;
  txHash?: Hex;
  envelope?: Envelope;
};

export type ReleaseHistory = { rows: ReleaseRow[]; source: string; note?: string };

const eventAbi = parseAbi([
  "event TextUpdated(uint256 indexed recordId,string indexed keyHash,string key,string value)",
  "event ContenthashUpdated(uint256 indexed recordId,bytes contenthash)",
]);

function envelopeFromText(value: string): Envelope | undefined {
  try {
    const parsed = JSON.parse(value) as Envelope;
    if (!parsed?.core || typeof parsed.core !== "object" || typeof parsed.signature !== "string") return undefined;
    return parsed;
  } catch { return undefined; }
}

function pointerCid(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const cid = trimmed.startsWith("ipfs://") ? trimmed.slice(7).split("/")[0] : trimmed;
  return cid || undefined;
}

function historyFromBlock(): bigint {
  const configured = import.meta.env.VITE_HISTORY_FROM_BLOCK?.trim();
  return BigInt(configured || String(deployment.historyFromBlock));
}

async function scanLogs(address: Address, from: bigint, latest: bigint) {
  const output = [];
  let start = from;
  let range = 500_000n;
  while (start <= latest) {
    const end = start + range - 1n < latest ? start + range - 1n : latest;
    try {
      output.push(...await publicClient.getLogs({ address, fromBlock: start, toBlock: end }));
      start = end + 1n;
    } catch (error) {
      if (range <= 5_000n) throw error;
      range /= 2n;
    }
  }
  return output;
}

async function resolverEvents(): Promise<ReleaseRow[]> {
  const latest = await publicClient.getBlockNumber();
  // Use the configured owner-promotion block as the MVP checkpoint instead of scanning Sepolia from genesis.
  const start = historyFromBlock();
  const logs = await scanLogs(deployment.prodResolver as Address, start, latest);
  const parsed = parseEventLogs({ abi: eventAbi, logs, strict: false });
  const textEvents = parsed.filter((event) => "eventName" in event && event.eventName === "TextUpdated" && "args" in event);
  const buildByTx = new Map<string, string>();
  for (const item of textEvents) {
    if (!item.transactionHash || !("args" in item) || item.args.key !== "ensure.build" || typeof item.args.value !== "string") continue;
    buildByTx.set(item.transactionHash.toLowerCase(), item.args.value);
  }
  const approvalEvents = textEvents.filter((item) => "args" in item && item.args.key === "ensure.approval");
  const rows: ReleaseRow[] = [];
  const times = new Map<bigint, number>();
  const approvedTxs = new Set(approvalEvents.map((item) => item.transactionHash?.toLowerCase()));
  for (const item of parsed) {
    if (!("eventName" in item) || item.eventName !== "ContenthashUpdated" || !("args" in item) || !item.blockNumber) continue;
    if (approvedTxs.has(item.transactionHash?.toLowerCase())) continue;
    let cid: string | undefined;
    try { cid = decodeContenthash(item.args.contenthash as Hex); } catch { /* Still show the write when its contenthash cannot be decoded. */ }
    const block = await publicClient.getBlock({ blockNumber: item.blockNumber });
    rows.push({ id: `${item.transactionHash}-${item.logIndex}`, kind: "unapproved", cid, timestamp: Number(block.timestamp) * 1000, block: item.blockNumber, txHash: item.transactionHash });
  }
  for (const item of approvalEvents) {
    if (!("args" in item) || !item.args.value || !item.blockNumber) continue;
    const envelope = envelopeFromText(item.args.value);
    if (!envelope) continue;
    let timestamp = times.get(item.blockNumber);
    if (timestamp === undefined) {
      timestamp = Number((await publicClient.getBlock({ blockNumber: item.blockNumber })).timestamp) * 1000;
      times.set(item.blockNumber, timestamp);
    }
    const approvalBytes = new TextEncoder().encode(item.args.value);
    const manifestCid = await bytesCid(approvalBytes);
    const buildRecord = item.transactionHash ? buildByTx.get(item.transactionHash.toLowerCase()) : undefined;
    rows.push({
      id: `${item.transactionHash ?? "resolver"}-${item.logIndex ?? "0"}`,
      kind: "promoted",
      release: envelope.core.release,
      cid: envelope.core.cid,
      manifestCid,
      buildManifestCid: pointerCid(buildRecord) ?? pointerCid(deployment.legacyBuildManifests[envelope.core.cid]),
      commit: envelope.core.commit,
      approver: envelope.core.approver,
      timestamp,
      block: item.blockNumber,
      txHash: item.transactionHash,
      envelope,
    });
  }
  // A fresh approval for a CID that was already released is a rollback. The chain has no separate event for it.
  const seen = new Set<string>();
  for (const row of [...rows].sort((a, b) => ((a.block ?? 0n) < (b.block ?? 0n) ? -1 : 1))) {
    if (row.kind !== "promoted" || !row.cid) continue;
    if (seen.has(row.cid)) row.kind = "rollback";
    seen.add(row.cid);
  }
  return rows;
}

async function controllerEvents(): Promise<ReleaseRow[]> {
  if (!deployment.releaseController) return [];
  const latest = await publicClient.getBlockNumber();
  const start = historyFromBlock();
  const logs = await scanLogs(deployment.releaseController as Address, start, latest);
  const parsed = parseEventLogs({ abi: controllerAbi, logs, eventName: ["ReleasePromoted", "ReleaseRolledBack"] });
  const rows: ReleaseRow[] = [];
  for (const item of parsed) {
    const id = item.args.releaseId;
    const [block, release] = await Promise.all([
      publicClient.getBlock({ blockNumber: item.blockNumber }),
      publicClient.readContract({ address: deployment.releaseController as Address, abi: controllerAbi, functionName: "getRelease", args: [id] }),
    ]);
    let cid: string | undefined;
    try { cid = decodeContenthash(release.contenthash); } catch { /* Keep the release visible when its contenthash cannot be decoded. */ }
    rows.push({
      id: `${item.transactionHash}-${item.logIndex}`,
      kind: item.eventName === "ReleaseRolledBack" ? "rollback" : "promoted",
      release: item.args.sequence.toString(),
      releaseId: id,
      cid,
      buildManifestCid: pointerCid(release.buildPointer),
      commit: release.commitDigest,
      approver: item.args.approver,
      timestamp: Number(block.timestamp) * 1000,
      block: item.blockNumber,
      txHash: item.transactionHash,
    });
  }
  return rows;
}

export async function readReleaseHistory(): Promise<ReleaseHistory> {
  const [resolverRows, controllerRows] = await Promise.all([resolverEvents(), controllerEvents()]);
  const rows = [...resolverRows, ...controllerRows].sort((a, b) => (b.block ?? 0n) > (a.block ?? 0n) ? 1 : (b.block ?? 0n) < (a.block ?? 0n) ? -1 : 0);
  const startBlock = historyFromBlock();
  return {
    rows,
    source: `${deployment.releaseController ? "production resolver and controller events" : "production resolver TextUpdated events"} · from block ${startBlock}`,
    note: rows.length ? undefined : "No owner approval events were found from the configured history start block.",
  };
}
