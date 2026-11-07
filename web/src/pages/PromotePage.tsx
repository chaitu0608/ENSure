import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, CheckCircle2, CircleDashed, Clock3, FileCode2, Fingerprint, LoaderCircle, LockKeyhole, RotateCcw, ShieldCheck, Wallet2 } from "lucide-react";
import { useAccount, useConnect, useWalletClient } from "wagmi";
import { encodeFunctionData, getAddress, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { commitDigest } from "@ensure/core/manifest";
import { controllerAbi, promoteTypedData, readControllerState, rollbackTypedData, type PromoteAction, type RollbackAction } from "../../../tools/ensure-sepolia/scripts/controller-v2";
import { sepolia } from "viem/chains";
import type { Core, Envelope } from "../../../tools/ensure-sepolia/scripts/release-approval";
import { typedApproval } from "../../../tools/ensure-sepolia/scripts/release-approval";
import { buildPromotion, resolverAbi, signedBuildHash } from "../../../tools/ensure-sepolia/scripts/owner-promote-shared";
import { RESOLVER_ROLES } from "@ensure/core/ens";
import type { Manifest } from "@ensure/core/manifest";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AuthorityPanel } from "@/components/AuthorityPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deployment, publicClient } from "@/lib/config";
import { dnsEncode, readNameSnapshot } from "@/lib/ens";
import { readReleaseHistory, type ReleaseRow } from "@/lib/history";
import { cidFromPointer } from "@/lib/ipfs";
import { readCurrentProjectOwner, verifyBuildManifestFiles, verifyProject } from "@/lib/verify";
import { shortAddress, shortCid } from "@/lib/utils";

type Candidate = {
  snapshotBlock: bigint;
  cid: string;
  buildManifestCid: string;
  manifest: Manifest;
  manifestGateway: string;
  buildHash: Hex;
  contenthash: Hex;
  manifestDigest: Hex;
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
const controller = deployment.releaseController;
const APPROVAL_WINDOW_SECONDS = 900n; // docs/ENSURE.md section 6: short deadlines for controller approvals.
const readable = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);
type SignedPromote = { contenthash: Hex; action: PromoteAction; signature: Hex };

/** viem puts whole calldata in error.message. Show its one-line summary and the revert reason. */
function actionMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { shortMessage, details } = error as Error & { shortMessage?: string; details?: string };
  return [shortMessage ?? error.message, details].filter(Boolean).join(" ").slice(0, 600);
}

async function loadCandidate(): Promise<Candidate> {
  const [block, preview, production] = await Promise.all([
    publicClient.getBlock(),
    readNameSnapshot(deployment.previewName),
    readNameSnapshot(deployment.prodName),
  ]);
  const buildManifestCid = cidFromPointer(preview.records["ensure.build"]);
  if (!preview.cid || !buildManifestCid) throw new Error("Preview has no ensure.build pointer. Publish a preview build before promotion.");
  const checked = await verifyBuildManifestFiles(preview.cid, buildManifestCid);
  if (!/^[0-9a-f]{40}$/.test(checked.manifest.commitSha)) throw new Error("Preview build manifest does not contain a full Git commit SHA.");
  const index = checked.manifest.files.find((file) => file.path === "index.html");
  if (!index) throw new Error("Preview build manifest has no index.html entry.");
  let releaseNumber = BigInt(deployment.minRelease);
  if (controller) releaseNumber = await publicClient.readContract({ address: controller, abi: controllerAbi, functionName: "lastSequence" }) + 1n;
  else try {
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
    buildHash: signedBuildHash(preview.cid, index.sha256),
    contenthash: preview.contenthash,
    manifestDigest: checked.manifestDigest,
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
  const scopedKeys = ["ensure.build"];
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
  const controllerState = useQuery({ queryKey: ["controller-state"], enabled: Boolean(controller), queryFn: () => readControllerState(publicClient, controller!), refetchInterval: 30_000 });
  const [step, setStep] = useState(0);
  const [envelope, setEnvelope] = useState<Envelope>();
  const [signedPromote, setSignedPromote] = useState<SignedPromote>();
  const [calldata, setCalldata] = useState<Hex>();
  const [reviewData, setReviewData] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ciBusy, setCiBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [finalState, setFinalState] = useState<string>();
  const [actionReceipt, setActionReceipt] = useState<ActionReceipt>();
  const [rollbackTarget, setRollbackTarget] = useState<ReleaseRow>();
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const [tamperOpen, setTamperOpen] = useState(false);

  const isOwner = Boolean(account.address && owner.data && account.address.toLowerCase() === owner.data.toLowerCase());
  const isSepolia = account.chainId === sepolia.id;
  const canAct = Boolean(walletClient && isOwner && isSepolia && candidate.data && !controllerState.data?.paused);
  // With a controller, only controller-approved artifacts are rollback targets; old direct releases are never offered.
  const rollbackChoices = (history.data?.rows ?? []).filter((row) => row.kind === "promoted" && row.cid && row.txHash && (controller ? row.releaseId : row.envelope));
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
      if (latestPreview.cid !== candidate.data.cid || latestPreview.records["ensure.build"] !== `ipfs://${candidate.data.buildManifestCid}`) {
        throw new Error("Preview content or build manifest changed after review. Refresh and inspect the new candidate.");
      }
      if (latestProd.records["ensure.manifest"] !== candidate.data.currentProduction.records["ensure.manifest"] || latestProd.records["ensure.build"] !== candidate.data.currentProduction.records["ensure.build"] || latestProd.cid !== candidate.data.currentProduction.cid) {
        throw new Error("Production changed after the candidate was loaded. Refresh before signing.");
      }
      const timestamp = (await publicClient.getBlock()).timestamp; // chain time, so a fast local clock can't make an approval "not yet valid"
      if (controller) {
        const c = candidate.data;
        const [state, nonce] = await Promise.all([
          readControllerState(publicClient, controller),
          publicClient.readContract({ address: controller, abi: controllerAbi, functionName: "nonces", args: [currentOwner] }),
        ]);
        if (state.paused) throw new Error("Promotions are paused on the release controller. Unpause first, or use a signed rollback.");
        const action: PromoteAction = {
          contenthashHash: keccak256(c.contenthash),
          buildPointer: `ipfs://${c.buildManifestCid}`,
          manifestDigest: c.manifestDigest,
          commitDigest: commitDigest(c.manifest.commitSha),
          sequence: state.lastSequence + 1n,
          expectedCurrentReleaseId: state.currentReleaseId,
          nonce,
          deadline: timestamp + APPROVAL_WINDOW_SECONDS,
        };
        const signature = await walletClient.signTypedData({ ...promoteTypedData(deployment.chainId, controller, action), account: account.address });
        await publicClient.simulateContract({ address: controller, abi: controllerAbi, functionName: "promote", args: [c.contenthash, action, signature], account: currentOwner });
        setSignedPromote({ contenthash: c.contenthash, action, signature });
        setReviewData(readable({ action, signature }));
        setStep(2);
        return;
      }
      const approvalCore: Core = { ...core, approver: getAddress(currentOwner), issuedAt: timestamp.toString(), validUntil: (timestamp + 172800n).toString() };
      const typed = typedApproval(approvalCore);
      const signature = await walletClient.signTypedData({ ...typed, account: account.address, primaryType: "ReleaseApproval" }) as Hex;
      const signed: Envelope = { core: approvalCore, signature };
      const payload = await promotionCalldata(signed, candidate.data.buildManifestCid);
      await publicClient.call({ account: currentOwner, to: deployment.prodResolver as Address, data: payload.data });
      setEnvelope(signed);
      setReviewData(readable(signed));
      setCalldata(payload.data);
      setStep(2);
    } catch (error) {
      setActionError(actionMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendPromotion() {
    if (!walletClient || !canAct || !account.address || (controller ? !signedPromote : !calldata || !envelope)) return;
    setActionError(undefined);
    setBusy(true);
    try {
      await checkOwnerStillCurrent();
      const latest = await readNameSnapshot(deployment.previewName);
      if (latest.cid !== candidate.data?.cid) throw new Error("Preview changed after you signed. Refresh and sign the new preview before submitting.");
      const hash = controller
        ? await walletClient.writeContract({ address: controller, abi: controllerAbi, functionName: "promote", args: [signedPromote!.contenthash, signedPromote!.action, signedPromote!.signature], account: account.address, chain: sepolia })
        : await walletClient.sendTransaction({ account: account.address, chain: sepolia, to: deployment.prodResolver as Address, data: calldata!, value: 0n });
      setActionReceipt({ title: "Promotion", hash, state: "pending" });
      setStep(3);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 240_000 });
      if (receipt.status !== "success") throw new Error("Promotion transaction reverted. Inspect its explorer page; no retry was sent.");
      setActionReceipt({ title: "Promotion", hash, state: "confirmed" });
      await invalidateLiveData();
      const verified = await verifyProject(deployment.projectName);
      setFinalState(`${verified.status}: ${verified.explanation ?? "Verification complete"}`);
    } catch (error) {
      setActionError(actionMessage(error));
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
            encodeFunctionData({ abi: eacAbi, functionName: "grantSetterRoles", args: [textSetter(deployment.previewName, "ensure.build"), ci] }),
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
      await Promise.all([ciAccess.refetch(), queryClient.invalidateQueries({ queryKey: ["authority"] }), queryClient.invalidateQueries({ queryKey: ["dashboard-preview"] }), queryClient.invalidateQueries({ queryKey: ["dashboard-verify"] })]);
    } catch (error) {
      setActionError(actionMessage(error));
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
      if (controller) {
        if (!row.releaseId) throw new Error("Only controller-approved releases can be rollback targets.");
        const [state, nonce] = await Promise.all([
          readControllerState(publicClient, controller),
          publicClient.readContract({ address: controller, abi: controllerAbi, functionName: "nonces", args: [currentOwner] }),
        ]);
        const action: RollbackAction = {
          targetReleaseId: row.releaseId,
          sequence: state.lastSequence + 1n,
          expectedCurrentReleaseId: state.currentReleaseId,
          nonce,
          deadline: (await publicClient.getBlock()).timestamp + APPROVAL_WINDOW_SECONDS,
        };
        const signature = await walletClient.signTypedData({ ...rollbackTypedData(deployment.chainId, controller, action), account: account.address });
        setReviewData(readable({ action, signature }));
        await publicClient.simulateContract({ address: controller, abi: controllerAbi, functionName: "rollback", args: [action, signature], account: currentOwner });
        hash = await walletClient.writeContract({ address: controller, abi: controllerAbi, functionName: "rollback", args: [action, signature], account: account.address, chain: sepolia });
      } else {
        if (!row.envelope || !row.cid || !row.buildManifestCid) throw new Error("This historical release does not have an event-linked build manifest, so it cannot be safely restored by the direct-owner path.");
        const checked = await verifyBuildManifestFiles(row.cid, row.buildManifestCid);
        const index = checked.manifest.files.find((file) => file.path === "index.html");
        if (!index || signedBuildHash(row.cid, index.sha256) !== row.envelope.core.buildHash.toLowerCase()) throw new Error("The previous build no longer matches its signed build hash.");
        const production = await readNameSnapshot(deployment.prodName);
        const old = JSON.parse(production.records["ensure.approval"] ?? "") as Envelope | undefined;
        let nextRelease = BigInt(deployment.minRelease) + 1n;
        if (old?.core?.release && BigInt(old.core.release) >= nextRelease) nextRelease = BigInt(old.core.release) + 1n;
        const now = (await publicClient.getBlock()).timestamp;
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
      setActionError(actionMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function setPaused(pause: boolean) {
    if (!controller || !walletClient || !isOwner || !isSepolia || !account.address) return;
    const title = pause ? "Pause promotions" : "Unpause promotions";
    setActionError(undefined);
    setBusy(true);
    try {
      const currentOwner = await checkOwnerStillCurrent();
      const functionName = pause ? "pause" : "unpause";
      await publicClient.simulateContract({ address: controller, abi: controllerAbi, functionName, account: currentOwner });
      const hash = await walletClient.writeContract({ address: controller, abi: controllerAbi, functionName, account: account.address, chain: sepolia });
      setActionReceipt({ title, hash, state: "pending" });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 240_000 });
      if (receipt.status !== "success") throw new Error(`${title} transaction reverted`);
      setActionReceipt({ title, hash, state: "confirmed" });
      await controllerState.refetch();
    } catch (error) {
      setActionError(actionMessage(error));
    } finally {
      setBusy(false);
    }
  }

  /** Controlled demo only: the owner writes a CID nobody approved, so Verify can show MISMATCH. Rollback repairs it. */
  async function writeUnapproved() {
    const target = candidate.data;
    if (!target || !walletClient || !isOwner || !isSepolia || !account.address) return;
    setActionError(undefined);
    setBusy(true);
    const title = "Unapproved production write";
    try {
      await checkOwnerStillCurrent();
      const data = encodeFunctionData({ abi: resolverAbi, functionName: "setContenthash", args: [dnsEncode(deployment.prodName), target.contenthash] });
      await publicClient.call({ account: account.address, to: deployment.prodResolver as Address, data });
      const hash = await walletClient.sendTransaction({ account: account.address, chain: sepolia, to: deployment.prodResolver as Address, data, value: 0n });
      setActionReceipt({ title, hash, state: "pending" });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 240_000 });
      if (receipt.status !== "success") throw new Error(`${title} reverted`);
      setActionReceipt({ title, hash, state: "confirmed" });
      setTamperOpen(false);
      await invalidateLiveData();
      const verified = await verifyProject(deployment.projectName);
      setFinalState(`${verified.status}: ${verified.explanation ?? "Verification complete"}`);
    } catch (error) {
      setActionError(actionMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function startNextRelease() {
    setStep(0);
    setEnvelope(undefined);
    setSignedPromote(undefined);
    setCalldata(undefined);
    setReviewData(undefined);
    setActionReceipt(undefined);
    setFinalState(undefined);
    setActionError(undefined);
    void candidate.refetch();
  }

  async function invalidateLiveData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["authority"] }),
      queryClient.invalidateQueries({ queryKey: ["controller-state"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-prod"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-verify"] }),
      queryClient.invalidateQueries({ queryKey: ["releases"] }),
      queryClient.invalidateQueries({ queryKey: ["promotion-candidate"] }),
      queryClient.invalidateQueries({ queryKey: ["preview-ci-access"] }),
    ]);
  }

  const canUseOwnerActions = account.isConnected && isSepolia && isOwner;
  const ownerGate = !account.isConnected
    ? <Button variant="secondary" onClick={() => connect({ connector: connectors[0] })} disabled={connecting}><Wallet2 className="size-4" /> {connecting ? "Connecting…" : "Connect owner wallet"}</Button>
    : !isSepolia ? <Badge variant="warning">Switch wallet to Sepolia</Badge>
    : <Badge variant="danger">Connected wallet is not the current owner</Badge>;

  return <div className="owner-page">
    <header className="page-intro-split">
      <div><p className="eyebrow">Owner controls / Sepolia</p><h1 className="editorial-title">You decide<br /><em>what goes <span className="word-cycle word-cycle-offset">live.</span></em></h1><p className="editorial-description">Review the candidate. Sign the exact release. Publish it under your ENS name. Production stays outside CI's reach.</p></div>
      <div className="owner-identity"><span className="owner-stamp"><LockKeyhole className="size-9" strokeWidth={1.3} aria-hidden="true" /></span><div><p className="eyebrow">Current name owner</p><p className="mt-3 font-mono text-sm" title={owner.data}>{owner.data ? shortAddress(owner.data) : "Reading owner…"}</p><p className="mt-2 text-xs text-muted-foreground">{deployment.prodName}</p></div></div>
    </header>

    <div className="approval-workspace">
      <aside className="approval-rail"><p className="eyebrow">Release process</p><ol className="approval-steps">{steps.map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step >= index + 1 ? "step-reached" : ""}><span className="approval-step-number">{step > index + 1 ? <Check className="size-4" aria-hidden="true" /> : `0${index + 1}`}</span><span>{label}</span></li>)}</ol><div className="approval-authority"><LockKeyhole className="size-4" aria-hidden="true" /><p>Only the current ENS owner can approve production.</p><Badge variant={controller ? "success" : "warning"}>{controller ? "Controller configured" : "Direct owner resolver"}</Badge></div></aside>
      <div className="approval-main">
        <Card className="surface-flat approval-candidate">
          <CardHeader className="border-b border-border"><CardTitle>Preview release candidate</CardTitle><p className="text-xs text-muted-foreground">ENSure reads the live preview and checks every file against its manifest before enabling owner approval.</p></CardHeader>
          <CardContent className="p-5 sm:p-6">
            {candidate.isLoading ? <div className="flex items-center gap-3 py-7 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading preview records and verifying its IPFS files…</div> : candidate.error ? <div role="alert" className="rounded-xl border border-rose-300/25 bg-rose-300/[0.05] p-4 text-xs leading-6 text-rose-100">{candidate.error instanceof Error ? candidate.error.message : "Could not load preview candidate"}<Button variant="ghost" size="sm" className="ml-2" onClick={() => void candidate.refetch()}>Try again</Button></div> : candidate.data && <>
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <CandidateField icon={<CircleDashed className="size-4" />} label="Production name" value={deployment.prodName} />
                <CandidateField icon={<FileCode2 className="size-4" />} label="Source commit" value={candidate.data.manifest.commitSha} mono />
                <CandidateField icon={<Fingerprint className="size-4" />} label="Preview CID" value={candidate.data.cid} mono />
                <CandidateField icon={<FileCode2 className="size-4" />} label="Build manifest CID" value={candidate.data.buildManifestCid} mono />
                <CandidateField icon={<Clock3 className="size-4" />} label="Candidate snapshot" value={`Sepolia block ${candidate.data.snapshotBlock}`} />
                <CandidateField icon={<ShieldCheck className="size-4" />} label="Next release number" value={`#${candidate.data.releaseNumber}`} />
              </div>
              <div className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.05] p-3.5 text-[11px] leading-5 text-emerald-100"><CheckCircle2 className="mr-1.5 inline size-3.5" /> {candidate.data.manifest.files.length} files fetched and checked against the canonical manifest. The signed release also binds the site CID, commit and {controller ? "manifest digest" : "build hash"}.</div>
            </>}
          </CardContent>
        </Card>
        <div className="approval-action-grid">
          <Card className="surface-flat"><CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Fingerprint className="size-4 text-primary" /> Owner signature</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{controller ? "EIP-712 · ENSureReleaseController v2 · Sepolia. Approvals expire after 15 minutes." : "EIP-712 · ENSure v1 · Sepolia."} Signing is free; the transaction below costs testnet gas.</p>
            <div className="mt-4 break-all rounded-xl border border-border bg-background px-3.5 py-3 font-mono text-[10px] leading-5 text-muted-foreground">{controller ? "Promote(contenthashHash, buildPointer, manifestDigest, commitDigest, sequence, expectedCurrentReleaseId, nonce, deadline)" : "ReleaseApproval(bytes32 coreHash)"}<br />Current owner: {owner.data ?? "Loading…"}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {canUseOwnerActions ? <Button onClick={() => void signApproval()} disabled={!canAct || busy || candidate.isLoading}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Fingerprint className="size-4" />} Sign release approval</Button> : ownerGate}
              {step >= 2 && <Badge variant="success"><CheckCircle2 className="size-3.5" /> Signature checked and call simulated</Badge>}
            </div>
          </CardContent></Card>
          <Card className="surface-flat"><CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><ArrowRight className="size-4 text-primary" /> Production transaction</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{controller ? "The owner submits the signed approval to the controller, which writes all five production records atomically." : "One owner-signed resolver multicall updates the site CID, approval records and ensure.build pointer together."}</p>
            <p className="mt-2 break-all font-mono text-[10px] leading-5 text-muted-foreground">Sepolia · target {controller ?? deployment.prodResolver}</p>
            <Button className="mt-4 w-full" variant={step >= 2 ? "default" : "secondary"} onClick={() => void sendPromotion()} disabled={!canAct || step < 2 || busy || Boolean(actionReceipt?.title === "Promotion")}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{actionReceipt?.title === "Promotion" ? "Promotion transaction sent" : "Send promotion transaction"}</Button>
            {candidate.data && <p className="mt-3 text-[10px] leading-5 text-muted-foreground">Build manifest fetched from {new URL(candidate.data.manifestGateway).host}; all listed file hashes were checked before signing.</p>}
          </CardContent></Card>
        </div>
      </div>
    </div>

    {actionError && <div role="alert" className="mt-4 rounded-xl border border-rose-300/25 bg-rose-300/[0.05] p-3.5 text-xs leading-5 text-rose-100">{actionError}</div>}
    {actionReceipt && <motion.div role="status" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .25 }} className="mt-4 rounded-xl border border-border bg-card p-4 text-xs leading-6 text-foreground"><span className="inline-flex items-center gap-2"><LoaderCircle aria-hidden="true" className={`size-3.5 ${actionReceipt.state === "pending" ? "animate-spin" : "text-emerald-200"}`} /> {actionReceipt.title} · {actionReceipt.state}</span><br /><a className="break-all font-mono text-primary hover:text-foreground" href={`https://sepolia.etherscan.io/tx/${actionReceipt.hash}`} target="_blank" rel="noreferrer">{actionReceipt.hash}</a></motion.div>}
    {finalState && <Button className="mt-4" variant="secondary" size="sm" onClick={startNextRelease} data-testid="next-release"><ArrowRight className="size-3.5" /> Start the next release</Button>}
    {finalState && <motion.div role="status" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .25 }} className="mt-4 rounded-xl border border-border bg-card p-4 text-xs leading-5 text-foreground"><CheckCircle2 aria-hidden="true" className="mr-1.5 inline size-4 text-primary" /> Transaction confirmed. Live re-check: {finalState}</motion.div>}
    {reviewData && <details className="mt-4 rounded-xl border border-border bg-card p-4 text-[10px] text-muted-foreground"><summary className="cursor-pointer font-medium">Review signed EIP-712 release data</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-all font-mono leading-5">{reviewData}</pre></details>}

    <section className="approval-settings" aria-label="Publishing settings">
      <div className="mb-6"><p className="eyebrow">Publishing settings</p><h2 className="mt-2 text-2xl font-medium tracking-tight">Access and recovery.</h2></div>
      <Tabs defaultValue="access">
        <TabsList aria-label="Publishing settings"><TabsTrigger value="access">Preview access</TabsTrigger><TabsTrigger value="restore">Restore</TabsTrigger><TabsTrigger value="drill">Demo drill</TabsTrigger>{controller && <TabsTrigger value="controller">Controller</TabsTrigger>}</TabsList>
        <TabsContent value="access">
          <Card className="surface-flat">
            <CardHeader className="border-b border-border px-0 sm:px-0"><CardTitle>Preview publisher permissions</CardTitle><p className="text-xs leading-5 text-muted-foreground">Grant or revoke only the configured CI wallet's ability to update preview contenthash and build pointers. The production resolver is not touched.</p></CardHeader>
            <CardContent className="flex flex-col gap-4 px-0 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-0">
              <div className="min-w-0"><p className="break-all font-mono text-xs text-foreground">{deployment.ci}</p><p className="mt-1 break-all text-[11px] text-muted-foreground">Preview resolver: <span className="font-mono">{deployment.previewResolver}</span></p><p className="mt-2 text-[11px] text-muted-foreground">Current status: {ciAccess.isLoading ? "reading roles…" : ciAccess.data?.canPublish ? "CI can publish preview" : "CI cannot publish preview"}</p></div>
              <div className="flex flex-wrap gap-2">
                {canUseOwnerActions ? <>
                  <Button variant="secondary" onClick={() => void updateCiAccess(true)} disabled={ciBusy || Boolean(ciAccess.data?.canPublish)}><CheckCircle2 className="size-4" /> {ciBusy ? "Updating…" : "Grant CI preview access"}</Button>
                  <Button variant="danger" onClick={() => void updateCiAccess(false)} disabled={ciBusy || !ciAccess.data?.canPublish}><LockKeyhole className="size-4" /> Revoke CI access</Button>
                </> : ownerGate}
                {ciAccess.isError && <Button size="sm" variant="ghost" onClick={() => void ciAccess.refetch()}>Retry role read</Button>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="restore">
          <Card className="surface-flat">
            <CardHeader className="border-b border-border px-0 sm:px-0"><CardTitle>Restore a previous approved build</CardTitle><p className="text-xs leading-5 text-muted-foreground">{controller ? "A rollback signs a fresh approval to a previously controller-approved release and moves the sequence forward." : "A direct-owner rollback creates a new, fresh owner approval for the selected historical CID. It never reuses an expired signature."}</p></CardHeader>
            <CardContent className="flex flex-col gap-3 px-0 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-0">
              <div className="min-w-0 flex-1"><label htmlFor="rollback-release" className="mb-2 block text-[11px] text-muted-foreground">{controller ? "Controller-approved release" : "Previous release from production resolver events"}</label>
                <Select value={selectedReleaseId} onValueChange={setSelectedReleaseId} disabled={!rollbackChoices.length}><SelectTrigger id="rollback-release" className="font-mono text-xs"><SelectValue placeholder={rollbackChoices.length ? "Choose a previous approved release" : "No rollback-ready releases found yet"} /></SelectTrigger><SelectContent>{rollbackChoices.map((row) => <SelectItem key={row.id} value={row.id} className="font-mono text-xs">#{row.release ?? row.id.slice(0, 12)} · {row.commit?.slice(0, 10) ?? "unknown commit"} · {row.cid ? shortCid(row.cid) : "no CID"}</SelectItem>)}</SelectContent></Select>
                {selectedRollback && <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">CID {selectedRollback.cid} · build manifest {selectedRollback.buildManifestCid ?? "not indexed"}</p>}
              </div>
              <Button variant="secondary" onClick={() => selectedRollback && setRollbackTarget(selectedRollback)} disabled={!selectedRollback || !isOwner || !isSepolia || busy || !walletClient}><RotateCcw className="size-4" /> Roll back</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="drill">
          <Card className="surface-flat">
            <CardHeader className="border-b border-border px-0 sm:px-0"><CardTitle>Write a release nobody approved</CardTitle><p className="text-xs leading-5 text-muted-foreground">Controlled demo on a test name. Your wallet writes the preview CID straight to production with no approval, so Verify reports MISMATCH and names the check. Roll back from the Restore tab to repair it. This shows detection. It is not an attack.</p></CardHeader>
            <CardContent className="flex flex-col gap-4 px-0 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-0">
              <div className="min-w-0 text-[11px] text-muted-foreground"><p>Would write: <span className="break-all font-mono text-foreground">{candidate.data?.cid ?? "No preview to write yet"}</span></p>{candidate.data && candidate.data.cid === candidate.data.currentProduction.cid && <p className="mt-2">Production already serves this CID. Publish a new preview first.</p>}</div>
              {canUseOwnerActions ? <Button variant="danger" data-testid="tamper-open" onClick={() => setTamperOpen(true)} disabled={busy || !candidate.data || candidate.data.cid === candidate.data.currentProduction.cid}><LockKeyhole className="size-4" /> Write unapproved CID</Button> : ownerGate}
            </CardContent>
          </Card>
        </TabsContent>
        {controller && <TabsContent value="controller">
          <Card className="surface-flat">
            <CardHeader className="border-b border-border px-0 sm:px-0"><CardTitle>Release controller</CardTitle><p className="text-xs leading-5 text-muted-foreground">Pausing blocks promotions only. Signed rollback still works, and the live site stays online.</p></CardHeader>
            <CardContent className="flex flex-col gap-4 px-0 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-0">
              <div className="min-w-0"><p className="break-all font-mono text-xs text-foreground">{controller}</p><p className="mt-1 text-[11px] text-muted-foreground">Sequence {controllerState.data?.lastSequence.toString() ?? "…"} · {controllerState.data?.paused ? "promotions paused" : "promotions active"}</p></div>
              <Button variant={controllerState.data?.paused ? "secondary" : "danger"} onClick={() => void setPaused(!controllerState.data?.paused)} disabled={busy || !controllerState.data || !isOwner || !isSepolia || !walletClient}>{controllerState.data?.paused ? "Unpause promotions" : "Pause promotions"}</Button>
            </CardContent>
          </Card>
        </TabsContent>}
      </Tabs>
    </section>

    <AuthorityPanel />

    {!controller && <p className="mt-8 text-center text-[10px] leading-5 text-muted-foreground">No release controller is configured. The current owner sends a direct production-resolver multicall through MetaMask; no server key is involved.</p>}

    {tamperOpen && <Dialog open onOpenChange={(open) => { if (!open && !busy) setTamperOpen(false); }}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold text-foreground">Write an unapproved CID to production?</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">This is a real transaction from your wallet. {deployment.prodName} will serve the preview build with no approval, and Verify will report MISMATCH until you roll back.</DialogDescription>
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setTamperOpen(false)} disabled={busy}>Cancel</Button><Button variant="danger" data-testid="tamper-confirm" onClick={() => void writeUnapproved()} disabled={busy}>{busy && <LoaderCircle className="size-4 animate-spin" />} Send transaction</Button></div>
      </DialogContent>
    </Dialog>}

    {rollbackTarget && <Dialog open onOpenChange={(open) => { if (!open && !busy) setRollbackTarget(undefined); }}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold text-foreground">Restore this approved build?</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">This will write a new production release that points to the selected immutable IPFS content and ask you for a fresh owner signature. Target on Sepolia: {controller ?? deployment.prodResolver}.</DialogDescription>
        <div className="my-4 break-all rounded-xl border border-border bg-background p-3 font-mono text-xs leading-5 text-muted-foreground">Release #{rollbackTarget.release}<br />{rollbackTarget.cid}<br />Build manifest: {rollbackTarget.buildManifestCid}</div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setRollbackTarget(undefined)} disabled={busy}>Cancel</Button><Button variant="danger" onClick={() => void rollback()} disabled={!isOwner || !isSepolia || busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Confirm rollback</Button></div>
      </DialogContent>
    </Dialog>}
  </div>;
}

function CandidateField({ icon, label, value, mono }: { icon: ReactNode; label: string; value: string; mono?: boolean }) {
  return <div className="flex min-w-0 gap-3"><span className="mt-0.5 text-muted-foreground">{icon}</span><div className="min-w-0"><div className="text-[10px] text-muted-foreground">{label}</div><div className={`mt-1 truncate text-xs text-foreground ${mono ? "font-mono" : ""}`} title={value}>{mono && value.length > 32 ? shortCid(value) : value}</div></div></div>;
}
