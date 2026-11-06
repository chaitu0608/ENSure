import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, CheckCircle2, CircleDashed, Clock3, FileCode2, Fingerprint, LoaderCircle, LockKeyhole, RotateCcw, ShieldCheck, Wallet2 } from "lucide-react";
import { useAccount, useConnect, useWalletClient } from "wagmi";
import { encodeFunctionData, getAddress, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import type { Core, Envelope } from "../../../tools/ensure-sepolia/scripts/release-approval";
import { typedApproval } from "../../../tools/ensure-sepolia/scripts/release-approval";
import { buildPromotion, resolverAbi } from "../../../tools/ensure-sepolia/scripts/owner-promote-shared";
import { RESOLVER_ROLES } from "@ensure/core/ens";
import type { Manifest } from "@ensure/core/manifest";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SectionHeading } from "@/components/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { deployment, publicClient } from "@/lib/config";
import { dnsEncode, readNameSnapshot } from "@/lib/ens";
import { readReleaseHistory, type ReleaseRow } from "@/lib/history";
import { cidFromPointer } from "@/lib/ipfs";
import { readCurrentProjectOwner, verifyBuildManifestFiles, verifyProject } from "@/lib/verify";
import { shortCid } from "@/lib/utils";

type Candidate = {
  snapshotBlock: bigint;
  cid: string;
  buildManifestCid: string;
  manifest: Manifest;
  manifestGateway: string;
  buildHash: Hex;
  currentProduction: Awaited<ReturnType<typeof readNameSnapshot>>;
  releaseNumber: string;
};
type ActionReceipt = { title: string; hash: Hex; state: "pending" | "confirmed" };

const steps = ["Review preview", "Sign owner approval", "Confirm transaction"] as const;
const ROLE_TEXT = RESOLVER_ROLES.SET_TEXT;
const ROLE_CONTENTHASH = RESOLVER_ROLES.SET_CONTENTHASH;
const eacAbi = parseAbi([
  "function multicall(bytes[] calls) returns (bytes[])",
  "function grantRootRoles(uint256 roleBitmap,address account) returns (bool)",
  "function revokeRootRoles(uint256 roleBitmap,address account) returns (bool)",
  "function grantSetterRoles(bytes setter,address account) returns (bool)",
  "function revokeRoles(uint256 resource,uint256 roleBitmap,address account) returns (bool)",
  "function hasRootRoles(uint256 roleBitmap,address account) view returns (bool)",
  "function hasRoles(uint256 resource,uint256 roleBitmap,address account) view returns (bool)",
]);
const controllerAbi = parseAbi(["function rollback(bytes32 releaseId)"]);

async function loadCandidate(): Promise<Candidate> {
  const [block, preview, production] = await Promise.all([
    publicClient.getBlock(),
    readNameSnapshot(deployment.previewName),
    readNameSnapshot(deployment.prodName),
  ]);
  const buildManifestCid = cidFromPointer(preview.records["ensure.build"] || preview.records["ensure.manifest"]);
  if (!buildManifestCid) throw new Error("Preview has no ensure.build pointer. Publish a preview build before promotion.");
  const checked = await verifyBuildManifestFiles(preview.cid, buildManifestCid);
  if (!/^[0-9a-f]{40}$/.test(checked.manifest.commitSha)) throw new Error("Preview build manifest does not contain a full Git commit SHA.");
  const index = checked.manifest.files.find((file) => file.path === "index.html");
  if (!index) throw new Error("Preview build manifest has no index.html entry.");
  let releaseNumber = BigInt(deployment.minRelease);
  try {
    const prior = JSON.parse(production.records["ensure.approval"] ?? "") as Envelope;
    const previous = BigInt(prior.core.release);
    if (previous >= releaseNumber) releaseNumber = previous + 1n;
  } catch {
    // The configured release checkpoint remains the minimum when no signed envelope is present.
  }
  return {
    snapshotBlock: block.number,
    cid: preview.cid,
    buildManifestCid,
    manifest: checked.manifest,
    manifestGateway: checked.gateway,
    buildHash: `0x${index.sha256}`,
    currentProduction: production,
    releaseNumber: releaseNumber.toString(),
  };
}

function buildPointerCall(name: string, buildManifestCid: string): Hex {
  return encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode(name), "ensure.build", `ipfs://${buildManifestCid}`] });
}

async function promotionCalldata(envelope: Envelope, buildManifestCid: string) {
  const promotion = await buildPromotion(envelope);
  const calls = [...promotion.calls, buildPointerCall(deployment.prodName, buildManifestCid)];
  return { ...promotion, calls, data: encodeFunctionData({ abi: resolverAbi, functionName: "multicall", args: [calls] }) };
}

function textSetter(name: string, key: string): Hex {
  return encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode(name), key, ""] });
}

async function readPreviewCiAccess() {
  const resolver = deployment.previewResolver as Address;
  const ci = deployment.ci as Address;
  const scopedKeys = ["ensure.build", "ensure.manifest"];
  const [contenthash, setters] = await Promise.all([
    publicClient.readContract({ address: resolver, abi: eacAbi, functionName: "hasRootRoles", args: [ROLE_CONTENTHASH, ci] }),
    Promise.all(scopedKeys.map(async (key) => publicClient.readContract({ address: resolver, abi: eacAbi, functionName: "hasRoles", args: [BigInt(keccak256(toBytes(key))), ROLE_TEXT, ci] }))),
  ]);
  return { contenthash, setters: setters.some(Boolean), canPublish: Boolean(contenthash) && setters.some(Boolean) };
}

export function PromotePage() {
  const reduceMotion = useReducedMotion();
  const account = useAccount();
  const { data: walletClient } = useWalletClient();
  const { connectors, connect, isPending: connecting } = useConnect();
  const queryClient = useQueryClient();
  const owner = useQuery({ queryKey: ["project-owner"], queryFn: () => readCurrentProjectOwner(), refetchInterval: 30_000 });
  const ciAccess = useQuery({ queryKey: ["preview-ci-access"], queryFn: readPreviewCiAccess, refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ["releases"], queryFn: readReleaseHistory, staleTime: 30_000 });
  const candidate = useQuery({ queryKey: ["promotion-candidate"], queryFn: loadCandidate, staleTime: 15_000 });
  const [step, setStep] = useState(0);
  const [envelope, setEnvelope] = useState<Envelope>();
  const [calldata, setCalldata] = useState<Hex>();
  const [busy, setBusy] = useState(false);
  const [ciBusy, setCiBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [finalState, setFinalState] = useState<string>();
  const [actionReceipt, setActionReceipt] = useState<ActionReceipt>();
  const [rollbackTarget, setRollbackTarget] = useState<ReleaseRow>();
  const [selectedReleaseId, setSelectedReleaseId] = useState("");

  const isOwner = Boolean(account.address && owner.data && account.address.toLowerCase() === owner.data.toLowerCase());
  const isSepolia = account.chainId === sepolia.id;
  const canAct = Boolean(walletClient && isOwner && isSepolia && candidate.data && !deployment.releaseController);
  const rollbackChoices = (history.data?.rows ?? []).filter((row) => row.kind === "promoted" && row.cid && row.txHash && (row.envelope || (deployment.releaseController && row.release?.startsWith("0x"))));
  const selectedRollback = rollbackChoices.find((row) => row.id === selectedReleaseId);

  const core = useMemo<Core | undefined>(() => {
    if (!candidate.data || !account.address) return undefined;
    const c = candidate.data;
    return {
      schemaVersion: 1,
      chainId: String(deployment.chainId),
      name: deployment.prodName,
      projectName: deployment.projectName,
      parentRegistry: deployment.protocol.ethRegistry,
      registry: deployment.registry as Address,
      parentResource: deployment.projectResource,
      resource: deployment.prodResource,
      resolver: deployment.prodResolver as Address,
      cid: c.cid,
      commit: c.manifest.commitSha,
      buildHash: c.buildHash,
      release: c.releaseNumber,
      approver: getAddress(account.address),
      issuedAt: "0",
      validUntil: "0",
      previousManifest: cidFromPointer(c.currentProduction.records["ensure.manifest"]) ?? "",
    };
  }, [account.address, candidate.data]);

  async function checkOwnerStillCurrent() {
    if (!account.address) throw new Error("Connect the current ENS parent-name owner wallet first.");
    const currentOwner = await readCurrentProjectOwner();
    if (currentOwner.toLowerCase() !== account.address.toLowerCase()) throw new Error(`The current ${deployment.projectName} owner is ${currentOwner}; this wallet is no longer authorized.`);
    return currentOwner;
  }

  async function signApproval() {
    if (!canAct || !walletClient || !core || !candidate.data || !account.address) return;
    setActionError(undefined);
    setBusy(true);
    try {
      const currentOwner = await checkOwnerStillCurrent();
      const [latestPreview, latestProd] = await Promise.all([readNameSnapshot(deployment.previewName), readNameSnapshot(deployment.prodName)]);
      const latestBuildRecord = latestPreview.records["ensure.build"] || latestPreview.records["ensure.manifest"];
      if (latestPreview.cid !== candidate.data.cid || latestBuildRecord !== `ipfs://${candidate.data.buildManifestCid}` && latestBuildRecord !== candidate.data.buildManifestCid) {
        throw new Error("Preview content or build manifest changed after review. Refresh and inspect the new candidate.");
      }
      if (latestProd.records["ensure.manifest"] !== candidate.data.currentProduction.records["ensure.manifest"] || latestProd.records["ensure.build"] !== candidate.data.currentProduction.records["ensure.build"] || latestProd.cid !== candidate.data.currentProduction.cid) {
        throw new Error("Production changed after the candidate was loaded. Refresh before signing.");
      }
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const approvalCore: Core = { ...core, approver: getAddress(currentOwner), issuedAt: timestamp.toString(), validUntil: (timestamp + 172800n).toString() };
      const typed = typedApproval(approvalCore);
      const signature = await walletClient.signTypedData({ ...typed, account: account.address, primaryType: "ReleaseApproval" }) as Hex;
      const signed: Envelope = { core: approvalCore, signature };
      const payload = await promotionCalldata(signed, candidate.data.buildManifestCid);
      await publicClient.call({ account: currentOwner, to: deployment.prodResolver as Address, data: payload.data });
      setEnvelope(signed);
      setCalldata(payload.data);
      setStep(2);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendPromotion() {
    if (!walletClient || !canAct || !calldata || !envelope || !account.address) return;
    setActionError(undefined);
    setBusy(true);
    try {
      await checkOwnerStillCurrent();
      const latest = await readNameSnapshot(deployment.previewName);
      if (latest.cid !== envelope.core.cid) throw new Error("Preview changed after you signed. Refresh and sign the new preview before submitting.");
      const hash = await walletClient.sendTransaction({ account: account.address, chain: sepolia, to: deployment.prodResolver as Address, data: calldata, value: 0n });
      setActionReceipt({ title: "Promotion", hash, state: "pending" });
      setStep(3);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 240_000 });
      if (receipt.status !== "success") throw new Error("Promotion transaction reverted. Inspect its explorer page; no retry was sent.");
      setActionReceipt({ title: "Promotion", hash, state: "confirmed" });
      await invalidateLiveData();
      const verified = await verifyProject(deployment.projectName);
      setFinalState(`${verified.status}: ${verified.explanation ?? "Verification complete"}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateCiAccess(grant: boolean) {
    if (!walletClient || !isOwner || !isSepolia || !account.address) return;
    setActionError(undefined);
    setCiBusy(true);
    try {
      const currentOwner = await checkOwnerStillCurrent();
      const ci = deployment.ci as Address;
      const calls = grant
        ? [
            encodeFunctionData({ abi: eacAbi, functionName: "grantRootRoles", args: [ROLE_CONTENTHASH, ci] }),
            ...["ensure.build", "ensure.manifest"].map((key) => encodeFunctionData({ abi: eacAbi, functionName: "grantSetterRoles", args: [textSetter(deployment.previewName, key), ci] })),
          ]
        : [
            encodeFunctionData({ abi: eacAbi, functionName: "revokeRootRoles", args: [ROLE_CONTENTHASH, ci] }),
            ...["ensure.build", "ensure.manifest"].map((key) => encodeFunctionData({ abi: eacAbi, functionName: "revokeRoles", args: [BigInt(keccak256(toBytes(key))), ROLE_TEXT, ci] })),
          ];
      const data = encodeFunctionData({ abi: eacAbi, functionName: "multicall", args: [calls] });
      await publicClient.call({ account: currentOwner, to: deployment.previewResolver as Address, data });
      const hash = await walletClient.sendTransaction({ account: account.address, chain: sepolia, to: deployment.previewResolver as Address, data, value: 0n });
      setActionReceipt({ title: grant ? "Grant preview CI access" : "Revoke preview CI access", hash, state: "pending" });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 240_000 });
      if (receipt.status !== "success") throw new Error("Preview permission transaction reverted");
      setActionReceipt({ title: grant ? "Grant preview CI access" : "Revoke preview CI access", hash, state: "confirmed" });
      await Promise.all([ciAccess.refetch(), queryClient.invalidateQueries({ queryKey: ["dashboard-preview"] }), queryClient.invalidateQueries({ queryKey: ["dashboard-verify"] })]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setCiBusy(false);
    }
  }

  async function rollback() {
    const row = rollbackTarget;
    if (!row || !walletClient || !isOwner || !isSepolia || !account.address) return;
    setActionError(undefined);
    setBusy(true);
    try {
      const currentOwner = await checkOwnerStillCurrent();
      let hash: Hex;
      if (deployment.releaseController) {
        if (!row.release?.startsWith("0x")) throw new Error("This controller release has no on-chain release ID.");
        hash = await walletClient.writeContract({ address: deployment.releaseController as Address, abi: controllerAbi, functionName: "rollback", args: [row.release as Hex], account: account.address, chain: sepolia });
      } else {
        if (!row.envelope || !row.cid || !row.buildManifestCid) throw new Error("This historical release does not have an event-linked build manifest, so it cannot be safely restored by the direct-owner path.");
        const checked = await verifyBuildManifestFiles(row.cid, row.buildManifestCid);
        const index = checked.manifest.files.find((file) => file.path === "index.html");
        if (!index || `0x${index.sha256}`.toLowerCase() !== row.envelope.core.buildHash.toLowerCase()) throw new Error("The previous build no longer matches its signed entry-file hash.");
        const production = await readNameSnapshot(deployment.prodName);
        const old = JSON.parse(production.records["ensure.approval"] ?? "") as Envelope | undefined;
        let nextRelease = BigInt(deployment.minRelease) + 1n;
        if (old?.core?.release && BigInt(old.core.release) >= nextRelease) nextRelease = BigInt(old.core.release) + 1n;
        const now = BigInt(Math.floor(Date.now() / 1000));
        const rollbackCore: Core = {
          ...row.envelope.core,
          approver: getAddress(currentOwner),
          release: nextRelease.toString(),
          issuedAt: now.toString(),
          validUntil: (now + 172800n).toString(),
          previousManifest: cidFromPointer(production.records["ensure.manifest"]) ?? "",
        };
        const typed = typedApproval(rollbackCore);
        const signature = await walletClient.signTypedData({ ...typed, account: account.address, primaryType: "ReleaseApproval" }) as Hex;
        const payload = await promotionCalldata({ core: rollbackCore, signature }, row.buildManifestCid);
        await publicClient.call({ account: currentOwner, to: deployment.prodResolver as Address, data: payload.data });
        hash = await walletClient.sendTransaction({ account: account.address, chain: sepolia, to: deployment.prodResolver as Address, data: payload.data, value: 0n });
      }
      setActionReceipt({ title: `Rollback to release ${row.release ?? "selected"}`, hash, state: "pending" });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 240_000 });
      if (receipt.status !== "success") throw new Error("Rollback transaction reverted");
      setActionReceipt({ title: `Rollback to release ${row.release ?? "selected"}`, hash, state: "confirmed" });
      setRollbackTarget(undefined);
      await invalidateLiveData();
      const verified = await verifyProject(deployment.projectName);
      setFinalState(`${verified.status}: ${verified.explanation ?? "Verification complete"}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function invalidateLiveData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dashboard-prod"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-verify"] }),
      queryClient.invalidateQueries({ queryKey: ["releases"] }),
      queryClient.invalidateQueries({ queryKey: ["promotion-candidate"] }),
      queryClient.invalidateQueries({ queryKey: ["preview-ci-access"] }),
    ]);
  }

  return <div className="mx-auto max-w-[1000px]">
    <Reveal><SectionHeading eyebrow="Owner page · MetaMask on Sepolia" title="Review, approve and control publishing." description="Only the current ENS parent-name owner can promote a release or change the preview publisher's permissions. Production stays outside CI's reach." /></Reveal>

    <Reveal delay={0.03}><Card className="mb-5 border-blue-400/[0.12] bg-gradient-to-r from-blue-500/[0.055] to-transparent">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl border border-blue-400/15 bg-blue-400/[0.08] text-blue-300"><LockKeyhole className="size-[18px]" /></div><div><p className="text-sm font-semibold text-zinc-100">Production is owner-controlled</p><p className="mt-1 text-xs leading-5 text-zinc-400">Current ENSv2 parent owner: <span className="font-mono text-zinc-300">{owner.data ?? "Reading live owner…"}</span></p></div></div>
        <Badge variant={deployment.releaseController ? "success" : "warning"}>{deployment.releaseController ? "Controller configured" : "Direct owner resolver path"}</Badge>
      </CardContent>
    </Card></Reveal>

    <Reveal delay={0.06}><Card className="mb-5">
      <CardHeader className="border-b border-white/[0.055]"><CardTitle>Preview publisher permissions</CardTitle><p className="text-xs leading-5 text-zinc-400">Grant or revoke only the configured CI wallet's ability to update preview contenthash and build pointers. The production resolver is not touched.</p></CardHeader>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div><p className="font-mono text-xs text-zinc-300">{deployment.ci}</p><p className="mt-1 text-[11px] text-zinc-400">Preview resolver: <span className="font-mono">{deployment.previewResolver}</span></p><p className="mt-2 text-[11px] text-zinc-400">Current status: {ciAccess.isLoading ? "reading roles…" : ciAccess.data?.canPublish ? "CI can publish preview" : "CI cannot publish preview"}</p></div>
        <div className="flex flex-wrap gap-2">
          {!account.isConnected ? <Button variant="secondary" onClick={() => connect({ connector: connectors[0] })} disabled={connecting}><Wallet2 className="size-4" /> Connect owner wallet</Button> : !isSepolia ? <Badge variant="warning">Switch wallet to Sepolia</Badge> : !isOwner ? <Badge variant="danger">Connected wallet is not the current owner</Badge> : <>
            <Button variant="secondary" onClick={() => void updateCiAccess(true)} disabled={ciBusy || Boolean(ciAccess.data?.canPublish)}><CheckCircle2 className="size-4" /> {ciBusy ? "Updating…" : "Grant CI preview access"}</Button>
            <Button variant="danger" onClick={() => void updateCiAccess(false)} disabled={ciBusy || !ciAccess.data?.canPublish}><LockKeyhole className="size-4" /> Revoke CI access</Button>
          </>}
          {ciAccess.isError && <Button size="sm" variant="ghost" onClick={() => void ciAccess.refetch()}>Retry role read</Button>}
        </div>
      </CardContent>
    </Card></Reveal>

    <Reveal delay={0.09}><div className="mb-5 grid gap-2 sm:grid-cols-3">
      {steps.map((label, index) => <div key={label} className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 ${step === index + 1 ? "border-blue-400/25 bg-blue-400/[0.07]" : step > index + 1 ? "border-emerald-400/15 bg-emerald-400/[0.035]" : "border-white/[0.06] bg-white/[0.015]"}`}>
        <div className={`grid size-7 place-items-center rounded-full ${step > index + 1 ? "bg-emerald-400/10 text-emerald-300" : step === index + 1 ? "bg-blue-400/10 text-blue-300" : "bg-white/[0.05] text-zinc-400"}`}>{step > index + 1 ? <Check className="size-3.5" /> : <span className="font-mono text-[10px]">0{index + 1}</span>}</div>
        <span className={`text-xs font-medium ${step === index + 1 ? "text-zinc-100" : "text-zinc-400"}`}>{label}</span>
      </div>)}
    </div></Reveal>

    <Reveal delay={0.12}><Card>
      <CardHeader className="border-b border-white/[0.055]"><CardTitle>Preview release candidate</CardTitle><p className="text-xs text-zinc-400">ENSure reads the live preview and checks every file against its manifest before enabling owner approval.</p></CardHeader>
      <CardContent className="p-5 sm:p-6">
        {candidate.isLoading ? <div className="flex items-center gap-3 py-7 text-xs text-zinc-400"><LoaderCircle className="size-4 animate-spin text-blue-300" /> Reading preview records and verifying its IPFS files…</div> : candidate.error ? <div className="rounded-xl border border-rose-400/15 bg-rose-400/[0.04] p-4 text-xs leading-6 text-rose-200/80">{candidate.error instanceof Error ? candidate.error.message : "Could not load preview candidate"}<Button variant="ghost" size="sm" className="ml-2" onClick={() => void candidate.refetch()}>Try again</Button></div> : candidate.data && <>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <CandidateField icon={<CircleDashed className="size-4" />} label="Production name" value={deployment.prodName} />
            <CandidateField icon={<FileCode2 className="size-4" />} label="Source commit" value={candidate.data.manifest.commitSha} mono />
            <CandidateField icon={<Fingerprint className="size-4" />} label="Preview CID" value={candidate.data.cid} mono />
            <CandidateField icon={<FileCode2 className="size-4" />} label="Build manifest CID" value={candidate.data.buildManifestCid} mono />
            <CandidateField icon={<Clock3 className="size-4" />} label="Candidate snapshot" value={`Sepolia block ${candidate.data.snapshotBlock}`} />
            <CandidateField icon={<ShieldCheck className="size-4" />} label="Next release number" value={`#${candidate.data.releaseNumber}`} />
          </div>
          <div className="mt-5 rounded-xl border border-emerald-400/[0.12] bg-emerald-400/[0.035] p-3.5 text-[11px] leading-5 text-emerald-100/70"><CheckCircle2 className="mr-1.5 inline size-3.5" /> {candidate.data.manifest.files.length} files fetched and checked against the canonical manifest. The signed release also binds the site CID, commit and index.html hash.</div>
        </>}
      </CardContent>
    </Card></Reveal>

    <Reveal delay={0.15}><div className="mt-5 grid gap-4 md:grid-cols-[1fr_.8fr]">
      <Card><CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><Fingerprint className="size-4 text-blue-300" /> Owner signature</div>
        <p className="mt-2 text-xs leading-5 text-zinc-400">EIP-712 · ENSure v1 · Sepolia. Signing is free; the resolver write below costs testnet gas.</p>
        <div className="mt-4 rounded-xl border border-white/[0.055] bg-black/20 px-3.5 py-3 font-mono text-[10px] leading-5 text-zinc-400">ReleaseApproval(bytes32 coreHash)<br />Current owner: {owner.data ?? "Loading…"}</div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!account.isConnected ? <Button variant="secondary" onClick={() => connect({ connector: connectors[0] })} disabled={connecting}><Wallet2 className="size-4" /> {connecting ? "Connecting…" : "Connect wallet"}</Button> : !isSepolia ? <Badge variant="warning">Switch wallet to Sepolia</Badge> : !isOwner ? <Badge variant="danger">Connected wallet is not the current owner</Badge> : <Button onClick={() => void signApproval()} disabled={!canAct || busy || candidate.isLoading}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Fingerprint className="size-4" />} Sign release approval</Button>}
          {step >= 2 && <Badge variant="success"><CheckCircle2 className="size-3.5" /> Signature checked and call simulated</Badge>}
        </div>
      </CardContent></Card>
      <Card><CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><ArrowRight className="size-4 text-blue-300" /> Production transaction</div>
        <p className="mt-2 text-xs leading-5 text-zinc-400">One owner-signed resolver multicall updates the site CID, approval records and ensure.build pointer together.</p>
        <Button className="mt-4 w-full" variant={step >= 2 ? "default" : "secondary"} onClick={() => void sendPromotion()} disabled={!canAct || step < 2 || busy || Boolean(actionReceipt?.title === "Promotion")}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{actionReceipt?.title === "Promotion" ? "Promotion transaction sent" : "Send promotion transaction"}</Button>
        {candidate.data && <p className="mt-3 text-[10px] leading-5 text-zinc-400">Build manifest fetched from {new URL(candidate.data.manifestGateway).host}; all listed file hashes were checked before signing.</p>}
      </CardContent></Card>
    </div></Reveal>

    <Reveal delay={0.18}><Card className="mt-5">
      <CardHeader className="border-b border-white/[0.055]"><CardTitle>Restore a previous approved build</CardTitle><p className="text-xs leading-5 text-zinc-400">A direct-owner rollback creates a new, fresh owner approval for the selected historical CID. It never reuses an expired signature.</p></CardHeader>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0 flex-1"><label htmlFor="rollback-release" className="mb-2 block text-[11px] text-zinc-400">Previous release from production resolver events</label><select id="rollback-release" value={selectedReleaseId} onChange={(event) => setSelectedReleaseId(event.target.value)} className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#0a0c11] px-3 font-mono text-xs text-zinc-300 outline-none focus:border-blue-400/40" disabled={!rollbackChoices.length}><option value="">{rollbackChoices.length ? "Choose a previous approved release" : "No rollback-ready releases found yet"}</option>{rollbackChoices.map((row) => <option key={row.id} value={row.id}>#{row.release ?? row.id.slice(0, 12)} · {row.commit?.slice(0, 10) ?? "unknown commit"} · {row.cid ? shortCid(row.cid) : "no CID"}</option>)}</select>
          {selectedRollback && <p className="mt-2 truncate font-mono text-[10px] text-zinc-400">CID {selectedRollback.cid} · build manifest {selectedRollback.buildManifestCid ?? "not indexed"}</p>}
        </div>
        <Button variant="secondary" onClick={() => selectedRollback && setRollbackTarget(selectedRollback)} disabled={!selectedRollback || !isOwner || !isSepolia || busy || !walletClient}><RotateCcw className="size-4" /> Roll back</Button>
      </CardContent>
    </Card></Reveal>

    {actionError && <div role="alert" className="mt-4 rounded-xl border border-rose-400/15 bg-rose-400/[0.04] p-3.5 text-xs leading-5 text-rose-200/80">{actionError}</div>}
    {actionReceipt && <motion.div role="status" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .25 }} className="mt-4 rounded-xl border border-blue-400/15 bg-blue-400/[0.04] p-4 text-xs leading-6 text-blue-100/80"><span className="inline-flex items-center gap-2"><LoaderCircle aria-hidden="true" className={`size-3.5 ${actionReceipt.state === "pending" ? "animate-spin" : "text-emerald-300"}`} /> {actionReceipt.title} · {actionReceipt.state}</span><br /><a className="font-mono text-blue-300 hover:text-blue-200" href={`https://sepolia.etherscan.io/tx/${actionReceipt.hash}`} target="_blank" rel="noreferrer">{actionReceipt.hash}</a></motion.div>}
    {finalState && <motion.div role="status" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .25 }} className="mt-4 rounded-xl border border-blue-400/15 bg-blue-400/[0.04] p-4 text-xs leading-5 text-blue-100/80"><CheckCircle2 aria-hidden="true" className="mr-1.5 inline size-4 text-blue-300" /> Transaction confirmed. Live re-check: {finalState}</motion.div>}
    {envelope && <details className="mt-4 rounded-xl border border-white/[0.055] bg-white/[0.015] p-4 text-[10px] text-zinc-400"><summary className="cursor-pointer font-medium text-zinc-400">Review signed EIP-712 release data</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-all font-mono leading-5">{JSON.stringify(envelope, null, 2)}</pre></details>}
    {!deployment.releaseController && <p className="mt-5 text-center text-[10px] leading-5 text-zinc-400">No release controller is configured. The current owner sends a direct production-resolver multicall through MetaMask; no server key is involved.</p>}

    {rollbackTarget && <Dialog open onOpenChange={(open) => { if (!open && !busy) setRollbackTarget(undefined); }}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold text-white">Restore this approved build?</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-zinc-400">This will write a new production release that points to the selected immutable IPFS content and issue a fresh owner signature.</DialogDescription>
        <div className="my-4 break-all rounded-xl border border-white/[0.06] bg-black/20 p-3 font-mono text-xs leading-5 text-zinc-400">Release #{rollbackTarget.release}<br />{rollbackTarget.cid}<br />Build manifest: {rollbackTarget.buildManifestCid}</div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setRollbackTarget(undefined)} disabled={busy}>Cancel</Button><Button variant="danger" onClick={() => void rollback()} disabled={!isOwner || !isSepolia || busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Confirm rollback</Button></div>
      </DialogContent>
    </Dialog>}
  </div>;
}

function CandidateField({ icon, label, value, mono }: { icon: ReactNode; label: string; value: string; mono?: boolean }) {
  return <div className="flex min-w-0 gap-3"><span className="mt-0.5 text-zinc-400">{icon}</span><div className="min-w-0"><div className="text-[10px] text-zinc-400">{label}</div><div className={`mt-1 truncate text-xs text-zinc-300 ${mono ? "font-mono" : ""}`} title={value}>{mono && value.length > 32 ? shortCid(value) : value}</div></div></div>;
}
