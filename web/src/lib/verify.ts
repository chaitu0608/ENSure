import { decodeAbiParameters, encodeFunctionData, keccak256, namehash, parseAbi, recoverTypedDataAddress, toBytes, type Address, type Hex } from "viem";
import { decodeContenthash, dnsEncode, labelId, sameCid } from "@ensure/core/ens";
import { commitDigest } from "@ensure/core/manifest";
import { B } from "../../../tools/ensure-sepolia/scripts/protocol-abi";
import { jcs, typedApproval, type Envelope } from "../../../tools/ensure-sepolia/scripts/release-approval";
import { bytesCid, resolverAbi as ownerResolverAbi, signedBuildHash } from "../../../tools/ensure-sepolia/scripts/owner-promote-shared";
import { GatewayContentMismatchError, GatewayUnavailableError, IntegrityError, verifyBuild, type BuildCheck } from "../../../tools/ensure-sepolia/scripts/build-check";
import { ACTION_ROLLBACK, ReleaseProofError, prodAuthorityProblem, readControllerState, verifyV2Release } from "../../../tools/ensure-sepolia/scripts/controller-v2";
import { GATEWAYS, NETWORK_NAME, deployment, publicClient, resolverForName } from "./config";
import { cidFromPointer } from "./ipfs";

export type { BuildCheck };
export type CheckState = "pass" | "fail" | "unavailable" | "info";
export type VerifyStatus = "MATCH" | "MISMATCH" | "UNAVAILABLE" | "UNPROTECTED";
export type VerificationCheck = { id: string; label: string; state: CheckState; detail: string };
export type EnvironmentSummary = {
  name: string;
  cid?: string;
  buildRecord?: string;
  buildManifestCid?: string;
  resolver?: Address;
  detail: string;
};
export type Verification = {
  name: string;
  status: VerifyStatus;
  checks: VerificationCheck[];
  production: EnvironmentSummary;
  preview: EnvironmentSummary;
  cid?: string;
  approvalManifestCid?: string;
  buildManifestCid?: string;
  release?: string;
  commit?: string;
  approver?: Address;
  issuedAt?: string;
  transaction?: Hex;
  blockNumber?: bigint;
  gateway?: string;
  siteUrl?: string;
  approvalManifestUrl?: string;
  buildManifestUrl?: string;
  explanation?: string;
};

const profileAbi = parseAbi([
  "function contenthash(bytes32 node) view returns (bytes)",
  "function text(bytes32 node,string key) view returns (string)",
]);
const helper = parseAbi([
  "function findParentRegistry(bytes name) view returns (address)",
  "function findExactRegistry(bytes name) view returns (address)",
]);
const findOwnerAbi = parseAbi(["function findExactOwner(bytes name) view returns (address)"]);
const rootRegistry = parseAbi(["function getSubregistry(string label) view returns (address)"]);
const ROLE_SET_TEXT = 1n << 4n;
const ROLE_SET_CONTENTHASH = 1n << 8n;
const ROLE_LINK = 1n << 28n;
const ROLE_UPGRADE = 1n << 124n;
const admin = (role: bigint) => role << 128n;
const equalAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const toIso = (unixSeconds: string) => new Date(Number(unixSeconds) * 1000).toISOString();

type RegistrationState = { status: number; expiry: bigint; latestOwner: Address; tokenId: bigint; resource: bigint };

function append(checks: VerificationCheck[], id: string, label: string, state: CheckState, detail: string, onCheck?: (check: VerificationCheck) => void) {
  const check = { id, label, state, detail };
  const existing = checks.findIndex((item) => item.id === id);
  if (existing >= 0) checks[existing] = check;
  else checks.push(check);
  onCheck?.(check);
}

async function read<T>(args: object): Promise<T> {
  return await publicClient.readContract(args as never) as T;
}

async function resolveAt(name: string, resolver: Address, data: Hex, blockNumber: bigint): Promise<Hex> {
  return await read<Hex>({ address: resolver, abi: ownerResolverAbi, functionName: "resolve", args: [dnsEncode(name), data], blockNumber });
}

async function readContenthashAt(name: string, resolver: Address, blockNumber: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi: profileAbi, functionName: "contenthash", args: [namehash(name)] });
  const resolved = await resolveAt(name, resolver, data, blockNumber);
  return decodeAbiParameters([{ type: "bytes" }], resolved)[0];
}

async function readTextAt(name: string, resolver: Address, key: string, blockNumber: bigint): Promise<string> {
  const data = encodeFunctionData({ abi: profileAbi, functionName: "text", args: [namehash(name), key] });
  const resolved = await resolveAt(name, resolver, data, blockNumber);
  return decodeAbiParameters([{ type: "string" }], resolved)[0];
}

async function checkProductionAuthority(resolver: Address, blockNumber: bigint): Promise<boolean> {
  const ci = deployment.ci as Address;
  const rootRoles = [ROLE_SET_CONTENTHASH, ROLE_SET_TEXT, ROLE_LINK, ROLE_UPGRADE];
  const root = await Promise.all(rootRoles.flatMap((role) => [
    read<boolean>({ address: resolver, abi: ownerResolverAbi, functionName: "hasRootRoles", args: [role, ci], blockNumber }),
    read<boolean>({ address: resolver, abi: ownerResolverAbi, functionName: "hasRootRoles", args: [admin(role), ci], blockNumber }),
  ]));
  const scoped = await Promise.all(["ensure.manifest", "ensure.release", "ensure.approval", "ensure.build"].flatMap((key) => {
    const resource = BigInt(keccak256(toBytes(key)));
    return [
      read<boolean>({ address: resolver, abi: ownerResolverAbi, functionName: "hasRoles", args: [resource, ROLE_SET_TEXT, ci], blockNumber }),
      read<boolean>({ address: resolver, abi: ownerResolverAbi, functionName: "hasRoles", args: [resource, admin(ROLE_SET_TEXT), ci], blockNumber }),
    ];
  }));
  return !root.some(Boolean) && !scoped.some(Boolean);
}

function parseApproval(text: string): Envelope {
  let envelope: Envelope;
  try { envelope = JSON.parse(text) as Envelope; }
  catch { throw new IntegrityError("Approval manifest is not valid JSON"); }
  if (jcs(envelope) !== text) throw new IntegrityError("Approval manifest is not canonical JSON");
  if (!envelope || typeof envelope !== "object" || !envelope.core || typeof envelope.core !== "object") throw new IntegrityError("Approval manifest has no signed core");
  const expectedFields = ["approver", "buildHash", "chainId", "cid", "commit", "issuedAt", "name", "parentRegistry", "parentResource", "previousManifest", "projectName", "registry", "release", "resolver", "resource", "schemaVersion", "validUntil"].sort().join(",");
  if (Object.keys(envelope.core).sort().join(",") !== expectedFields) throw new IntegrityError("Signed approval has an unexpected schema");
  if (envelope.core.schemaVersion !== 1 || !/^0x[0-9a-f]{64}$/i.test(envelope.core.buildHash)) throw new IntegrityError("Approval schema or signed build hash is invalid");
  if (!/^0x[0-9a-f]{130}$/i.test(envelope.signature)) throw new IntegrityError("Approval signature is malformed");
  return envelope;
}

export const verifyBuildManifestFiles = (siteCid: string, manifestCid: string, onProgress?: (complete: number, total: number) => void) => verifyBuild(GATEWAYS, siteCid, manifestCid, onProgress);

function pointerOrCid(value: string | undefined): string | undefined {
  return cidFromPointer(value);
}

type ProdRecords = { resolver: Address; contenthash: Hex; cid?: string; state: RegistrationState; buildRecord: string; manifestRecord: string; releaseRecord: string; approvalText: string };
type ApprovedRelease = { buildManifestCid: string; bindingDetail: string; checkBuild: (build: BuildCheck) => void };
type OnCheck = ((check: VerificationCheck) => void) | undefined;

/** Direct-owner path used only while no controller is configured. */
async function checkLegacyApproval(prod: ProdRecords, projectName: string, prodName: string, projectState: RegistrationState, currentOwner: Address, now: bigint, result: Verification, checks: VerificationCheck[], onCheck: OnCheck): Promise<ApprovedRelease> {
  result.approvalManifestCid = pointerOrCid(prod.manifestRecord);
  if (!result.approvalManifestCid || !prod.approvalText) throw new IntegrityError("Production signed approval pointer or inline approval text record is missing");
  if (prod.releaseRecord !== prod.manifestRecord) throw new IntegrityError("ensure.release differs from the signed approval manifest pointer");
  // The signed envelope is stored inline on-chain; its pointer is a raw CID commitment to those exact bytes.
  const approvalBytes = new TextEncoder().encode(prod.approvalText);
  if (!sameCid(await bytesCid(approvalBytes), result.approvalManifestCid)) throw new IntegrityError("Inline ENS approval bytes do not match the ensure.manifest CID");
  const envelope = parseApproval(prod.approvalText);
  append(checks, "approval-cid", "Approval bytes match on-chain pointer", "pass", `Inline ensure.approval hashes to ${result.approvalManifestCid}`, onCheck);

  const core = envelope.core;
  const contextOk = core.chainId === String(deployment.chainId) && core.name === prodName && core.projectName === projectName &&
    equalAddress(core.parentRegistry, deployment.protocol.ethRegistry) && equalAddress(core.registry, deployment.registry) &&
    core.parentResource === projectState.resource.toString() && core.resource === prod.state.resource.toString() &&
    equalAddress(core.resolver, prod.resolver) && equalAddress(core.approver, currentOwner) && BigInt(core.release) >= BigInt(deployment.minRelease);
  if (!contextOk) throw new IntegrityError("Signed approval name, resolver, resource, chain, current owner or release checkpoint does not match live ENSv2 state");
  const recovered = await recoverTypedDataAddress({ ...typedApproval(core), signature: envelope.signature });
  if (!equalAddress(recovered, currentOwner)) throw new IntegrityError(`EIP-712 signer ${recovered} is not the current ENS parent-name owner ${currentOwner}`);
  if (BigInt(core.issuedAt) > now || BigInt(core.validUntil) <= now || BigInt(core.validUntil) <= BigInt(core.issuedAt)) throw new IntegrityError("Owner approval has expired or is not yet valid at the snapshot");
  if (!sameCid(core.cid, prod.cid!)) throw new IntegrityError("Production ENS contenthash CID differs from the signed release CID");
  result.release = core.release;
  result.commit = core.commit;
  result.approver = recovered;
  result.issuedAt = toIso(core.issuedAt);
  append(checks, "approval", "Current owner EIP-712 signature", "pass", `Release ${core.release} signed by current owner ${recovered}; valid until ${toIso(core.validUntil)}`, onCheck);
  append(checks, "cid", "ENS contenthash matches signed CID", "pass", `Both point to ${prod.cid}`, onCheck);
  append(checks, "controller", "Release controller", "info", "No release controller is configured; the direct owner approval path is checked", onCheck);

  // Legacy promotes may not have written prod ensure.build. The fallback pointer is not trusted: its manifest must
  // still match the signed CID and commit, and every file hash below must match.
  const pinned = deployment.legacyBuildManifests[prod.cid!];
  const buildManifestCid = pointerOrCid(prod.buildRecord) ?? pointerOrCid(pinned);
  if (!buildManifestCid) {
    append(checks, "build-record", "Production build manifest pointer", "unavailable", "The live ensure.build text record is empty, so full directory verification cannot run yet.", onCheck);
    throw new GatewayUnavailableError("Production ensure.build has no build manifest CID; full directory verification cannot run yet");
  }
  append(checks, "build-record", "Production build manifest pointer", "pass", prod.buildRecord ? `ensure.build → ${buildManifestCid}` : `Live ensure.build is unset on this legacy release; using the manifest CI published for this CID: ${buildManifestCid}`, onCheck);
  return {
    buildManifestCid,
    bindingDetail: "The owner-signed build hash and commit also match.",
    checkBuild(build) {
      const index = build.manifest.files.find((file) => file.path === "index.html")!;
      if (signedBuildHash(prod.cid!, index.sha256) !== core.buildHash.toLowerCase()) throw new IntegrityError("The signed buildHash differs from this release's CID digest or index.html SHA-256");
      if (build.manifest.commitSha !== core.commit) throw new IntegrityError("The build manifest commit differs from the owner-signed commit");
    },
  };
}

/** Controller v2 path. There is no direct-resolver fallback: legacy records fail here once a controller is configured. */
async function checkControllerApproval(controller: Address, prod: ProdRecords, currentOwner: Address, blockNumber: bigint, result: Verification, checks: VerificationCheck[], onCheck: OnCheck): Promise<ApprovedRelease> {
  const state = await readControllerState(publicClient, controller, blockNumber);
  const verified = await verifyV2Release(
    { chainId: deployment.chainId, controller, projectName: deployment.projectName, owner: currentOwner, prodResolver: prod.resolver, previewResolver: deployment.previewResolver as Address, registry: deployment.registry as Address },
    { contenthash: prod.contenthash, release: prod.releaseRecord, manifest: prod.manifestRecord, build: prod.buildRecord, approval: prod.approvalText },
    state,
  );
  const kind = verified.action === ACTION_ROLLBACK ? "rollback" : "promotion";
  result.release = verified.sequence.toString();
  result.approver = verified.signer;
  result.issuedAt = new Date(Number(state.transition!.timestamp) * 1000).toISOString();
  append(checks, "controller", "Controller history matches ENS records", "pass", `Sequence ${verified.sequence} · release ID ${verified.releaseId}`, onCheck);
  append(checks, "approval", "Current owner EIP-712 signature", "pass", `Signed ${kind} recovered to current owner ${verified.signer}; digest ${verified.digest}`, onCheck);
  append(checks, "build-record", "Production build manifest pointer", "pass", `ensure.build and ensure.manifest → ${verified.manifestCid}`, onCheck);
  return {
    buildManifestCid: verified.manifestCid,
    bindingDetail: "The owner-signed manifest and commit digests also match.",
    checkBuild(build) {
      if (build.manifestDigest !== verified.release.manifestDigest) throw new IntegrityError("Fetched build manifest differs from the owner-signed manifest digest");
      if (commitDigest(build.manifest.commitSha) !== verified.release.commitDigest) throw new IntegrityError("Build manifest commit differs from the owner-signed commit digest");
    },
  };
}

async function verifyOnce(nameInput: string, onCheck?: (check: VerificationCheck) => void): Promise<Verification> {
  const input = nameInput.trim().toLowerCase().replace(/\.$/, "");
  const projectName = input === deployment.prodName.toLowerCase() || input === deployment.previewName.toLowerCase()
    ? deployment.projectName.toLowerCase()
    : input;
  const prodName = `prod.${projectName}`;
  const previewName = `preview.${projectName}`;
  const checks: VerificationCheck[] = [];
  const result: Verification = {
    name: projectName,
    status: "UNAVAILABLE",
    checks,
    production: { name: prodName, detail: "Not checked" },
    preview: { name: previewName, detail: "Not checked" },
  };
  let currentStep = `${NETWORK_NAME} RPC`;
  try {
    const chainId = await publicClient.getChainId();
    if (chainId !== deployment.chainId) throw new Error(`Configured read client is on chain ${chainId}; expected ${NETWORK_NAME} ${deployment.chainId}`);
    const block = await publicClient.getBlock();
    result.blockNumber = block.number;
    append(checks, "network", `${NETWORK_NAME} snapshot`, "pass", `Chain ${chainId} · block ${block.number}`, onCheck);

    const platform = deployment.platform;
    if (platform && input.endsWith(`.${platform.name.toLowerCase()}`)) {
      currentStep = "Quick name records";
      const resolver = platform.resolver as Address;
      const [contenthash, buildRecord] = await Promise.all([readContenthashAt(input, resolver, block.number), readTextAt(input, resolver, "ensure.build", block.number)]);
      result.name = input;
      result.production = { name: input, resolver, buildRecord, detail: "A quick name. The platform key writes it, and no owner approves its releases." };
      result.preview = { name: "None", detail: "Quick names have no preview step." };
      if (contenthash === "0x") throw new IntegrityError(`${input} has no site`);
      const cid = decodeContenthash(contenthash);
      const manifestCid = pointerOrCid(buildRecord);
      if (!manifestCid) throw new IntegrityError(`${input} has no ensure.build record`);
      result.production.cid = result.cid = cid;
      result.production.buildManifestCid = result.buildManifestCid = manifestCid;
      append(checks, "quick-name", "Name points to a site and manifest", "pass", `${input} → ${cid}`, onCheck);
      currentStep = "Build manifest and files";
      const build = await verifyBuildManifestFiles(cid, manifestCid);
      result.commit = build.manifest.commitSha;
      result.gateway = build.gateway;
      append(checks, "files", "Every file matches the build manifest", "pass", `${build.manifest.files.length} files checked`, onCheck);
      append(checks, "approval", "Owner approval", "info", "Nobody approved this release. Quick names have no owner approval step.", onCheck);
      result.status = "UNPROTECTED";
      result.explanation = "The files match their manifest, but nobody approved them. The platform key can change this name at any time.";
      return result;
    }

    if (projectName !== deployment.projectName.toLowerCase()) {
      append(checks, "scope", "Configured ENS project", "fail", `This app is configured for ${deployment.projectName}; ${projectName} is not in deployments/sepolia.json`, onCheck);
      result.status = "MISMATCH";
      result.explanation = "The entered ENS parent name does not match this deployment configuration.";
      return result;
    }

    currentStep = "ENSv2 name ownership and resolver routing";
    const [ethForward, rootEthState, projectState, parentRegistry, exactRegistry] = await Promise.all([
      read<Address>({ address: deployment.protocol.rootRegistry, abi: rootRegistry, functionName: "getSubregistry", args: ["eth"], blockNumber: block.number }),
      read<RegistrationState>({ address: deployment.protocol.rootRegistry, abi: B.eth, functionName: "getState", args: [labelId("eth")], blockNumber: block.number }),
      read<RegistrationState>({ address: deployment.protocol.ethRegistry, abi: B.eth, functionName: "getState", args: [labelId(deployment.label)], blockNumber: block.number }),
      read<Address>({ address: deployment.protocol.universalHelper, abi: helper, functionName: "findParentRegistry", args: [dnsEncode(prodName)], blockNumber: block.number }),
      read<Address>({ address: deployment.protocol.universalHelper, abi: helper, functionName: "findExactRegistry", args: [dnsEncode(projectName)], blockNumber: block.number }),
    ]);
    const hierarchyOk = equalAddress(ethForward, deployment.protocol.ethRegistry) && Number(rootEthState.status) === 2 && rootEthState.expiry > block.timestamp &&
      Number(projectState.status) === 2 && projectState.expiry > block.timestamp && projectState.resource.toString() === deployment.projectResource &&
      equalAddress(parentRegistry, deployment.registry) && equalAddress(exactRegistry, deployment.registry);
    append(checks, "owner", "ENSv2 parent and current owner", hierarchyOk ? "pass" : "fail", hierarchyOk ? `Current parent-name owner: ${projectState.latestOwner}` : "The .eth parent, project registration, resource or project child registry does not match the configured ENSv2 hierarchy", onCheck);
    if (!hierarchyOk) throw new IntegrityError("ENSv2 project registration or ownership context does not match the configured hierarchy");
    const currentOwner = projectState.latestOwner;

    const envs = await Promise.all([prodName, previewName].map(async (name) => {
      const resolver = resolverForName(name);
      if (!resolver) throw new IntegrityError(`No resolver configured for ${name}`);
      const envLabel = name.split(".")[0];
      const [forwardResolver, state, exactOwner, contenthash, buildRecord, manifestRecord, releaseRecord, approvalText] = await Promise.all([
        read<Address>({ address: deployment.registry, abi: B.registry, functionName: "getResolver", args: [envLabel], blockNumber: block.number }),
        read<RegistrationState>({ address: deployment.registry, abi: B.registry, functionName: "getState", args: [labelId(envLabel)], blockNumber: block.number }),
        read<Address>({ address: deployment.protocol.universalHelper, abi: findOwnerAbi, functionName: "findExactOwner", args: [dnsEncode(name)], blockNumber: block.number }),
        readContenthashAt(name, resolver, block.number),
        readTextAt(name, resolver, "ensure.build", block.number),
        readTextAt(name, resolver, "ensure.manifest", block.number),
        readTextAt(name, resolver, "ensure.release", block.number),
        readTextAt(name, resolver, "ensure.approval", block.number),
      ]);
      const expectedResource = envLabel === "prod" ? BigInt(deployment.prodResource) : undefined;
      const active = Number(state.status) === 2 && state.expiry > block.timestamp && (!expectedResource || state.resource === expectedResource);
      if (!equalAddress(forwardResolver, resolver) || !active) throw new IntegrityError(`${name} is inactive or its registered resolver/resource differs from deployments/sepolia.json`);
      const summary: EnvironmentSummary = {
        name,
        resolver,
        buildRecord: buildRecord || undefined,
        buildManifestCid: pointerOrCid(buildRecord),
        detail: "Live ENSv2 records read at the verification block",
      };
      let cid: string | undefined;
      if (contenthash && contenthash !== "0x") {
        try { cid = decodeContenthash(contenthash); }
        catch (error) { throw new IntegrityError(`${name} contenthash is not a valid IPFS contenthash: ${error instanceof Error ? error.message : String(error)}`); }
      }
      summary.cid = cid;
      return { name, resolver, state, exactOwner, contenthash, cid, buildRecord, manifestRecord, releaseRecord, approvalText, summary };
    }));
    const [prod, preview] = envs;
    result.production = prod.summary;
    result.preview = preview.summary;
    append(checks, "resolver", "Production and preview resolvers", "pass", `${prodName} → ${prod.resolver} · ${previewName} → ${preview.resolver}`, onCheck);
    append(checks, "env-records", "Live production and preview records", prod.cid ? "pass" : "fail", `Production CID ${prod.cid ?? "missing"}; build record ${prod.buildRecord || "missing"}. Preview CID ${preview.cid ?? "missing"}; build record ${preview.buildRecord || "missing"}.`, onCheck);
    if (!prod.cid) throw new IntegrityError("Production ENS contenthash is empty");
    result.cid = prod.cid;
    currentStep = "ENSv2 implementation and resolver isolation";
    const [registryImpl, prodImpl, previewImpl] = await Promise.all([
      read<Address>({ address: deployment.protocol.verifiableFactory, abi: B.factory, functionName: "verifyContract", args: [deployment.registry], blockNumber: block.number }),
      read<Address>({ address: deployment.protocol.verifiableFactory, abi: B.factory, functionName: "verifyContract", args: [prod.resolver], blockNumber: block.number }),
      read<Address>({ address: deployment.protocol.verifiableFactory, abi: B.factory, functionName: "verifyContract", args: [preview.resolver], blockNumber: block.number }),
    ]);
    const implementationOk = equalAddress(registryImpl, deployment.protocol.registryImplementation) && equalAddress(prodImpl, deployment.protocol.resolverImplementation) && equalAddress(previewImpl, deployment.protocol.resolverImplementation) && !equalAddress(prod.resolver, preview.resolver);
    append(checks, "implementation", "Resolver implementation and separation", implementationOk ? "pass" : "fail", implementationOk ? "Both names use the configured PermissionedResolver implementation and separate resolver instances" : "Resolver implementation provenance or production/preview isolation differs from configuration", onCheck);
    if (!implementationOk) throw new IntegrityError("ENSv2 resolver implementation or separation check failed");

    currentStep = "Production writer permissions";
    const controller = deployment.releaseController;
    const authorityProblem = controller
      ? await prodAuthorityProblem((functionName, args) => read({ address: prod.resolver, abi: B.resolver, functionName, args, blockNumber: block.number }), { owner: currentOwner, controller, ci: deployment.ci as Address })
      : await checkProductionAuthority(prod.resolver, block.number) ? undefined : `CI ${deployment.ci} has production writer or role-admin permission`;
    append(checks, "authority", controller ? "Production writers are owner and controller only" : "CI cannot write production", authorityProblem ? "fail" : "pass", authorityProblem ?? (controller ? `CI ${deployment.ci} has no production role; controller holds exactly its documented roles` : `CI ${deployment.ci} has no production record-writing or role-admin permissions`), onCheck);
    if (authorityProblem) throw new IntegrityError(authorityProblem);

    currentStep = "Owner EIP-712 approval";
    const approved = controller
      ? await checkControllerApproval(controller, prod, currentOwner, block.number, result, checks, onCheck)
      : await checkLegacyApproval(prod, projectName, prodName, projectState, currentOwner, block.timestamp, result, checks, onCheck);
    currentStep = "Production build manifest and site files";
    let build: BuildCheck;
    try {
      build = await verifyBuildManifestFiles(prod.cid, approved.buildManifestCid, (complete, total) => {
        if (complete === total || complete === 1) append(checks, "files", "Build file SHA-256 checks", "info", `Verified ${complete} of ${total} files against the build manifest`, onCheck);
      });
    } catch (error) {
      const mismatch = error instanceof IntegrityError || error instanceof GatewayContentMismatchError;
      append(checks, "files", "Build files match manifest", mismatch ? "fail" : "unavailable", error instanceof Error ? error.message : String(error), onCheck);
      throw error;
    }
    approved.checkBuild(build);
    result.buildManifestCid = build.manifestCid;
    result.gateway = build.gateway;
    result.buildManifestUrl = build.url;
    result.siteUrl = `${build.gateway}/ipfs/${encodeURIComponent(prod.cid)}/`;
    result.commit = build.manifest.commitSha;
    append(checks, "files", "Build files match manifest", "pass", `${build.fileCount} files fetched from the IPFS CID; every size and SHA-256 matches. ${approved.bindingDetail}`, onCheck);
    append(checks, "preview", "Preview remains separately addressable", "info", preview.cid ? `${preview.name} has its own CID ${preview.cid} and build pointer ${preview.buildRecord || "not set"}` : `${preview.name} is not currently published; production verification is independent`, onCheck);

    const snapshotHash = block.hash;
    if (snapshotHash && (await publicClient.getBlock({ blockNumber: block.number })).hash !== snapshotHash) throw new IntegrityError("Sepolia block changed during verification; retry against a stable snapshot");
    append(checks, "snapshot", `${NETWORK_NAME} snapshot remained stable`, "pass", `Verification reads correspond to block ${block.number}`, onCheck);
    result.status = "MATCH";
    result.explanation = "The live production name, current owner signature, build manifest and fetched file hashes agree. This checks release integrity; it does not audit the site's code for vulnerabilities.";
    return result;
  } catch (error) {
    // viem errors carry the URL and request body in message. Keep the one-line summary.
    const detail = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : String(error);
    const isMismatch = error instanceof IntegrityError || error instanceof ReleaseProofError || error instanceof GatewayContentMismatchError;
    const state: CheckState = isMismatch ? "fail" : "unavailable";
    if (!checks.some((item) => item.state === "fail" || item.id === "verification-error")) append(checks, "verification-error", currentStep, state, detail, onCheck);
    else if (error instanceof GatewayUnavailableError && !checks.some((item) => item.id === "verification-error")) append(checks, "verification-error", currentStep, "unavailable", detail, onCheck);
    result.status = isMismatch ? "MISMATCH" : "UNAVAILABLE";
    result.explanation = detail;
    return result;
  }
}

// Load-balanced public RPCs can route a pinned-block read to a backend that has not seen that block yet.
const isSnapshotLag = (result: Verification) => result.status === "UNAVAILABLE" && /(?:header|block) not found/i.test(result.explanation ?? "");

export async function verifyProject(nameInput: string, onCheck?: (check: VerificationCheck) => void): Promise<Verification> {
  for (let attempt = 0; ; attempt++) {
    const result = await verifyOnce(nameInput, onCheck);
    if (!isSnapshotLag(result) || attempt >= 3) return result;
    await new Promise((done) => setTimeout(done, 2000 * (attempt + 1)));
  }
}

export const verifyName = verifyProject;

export async function readCurrentProjectOwner(blockNumber?: bigint): Promise<Address> {
  const state = await read<RegistrationState>({
    address: deployment.protocol.ethRegistry,
    abi: B.eth,
    functionName: "getState",
    args: [labelId(deployment.label)],
    ...(blockNumber ? { blockNumber } : {}),
  });
  if (Number(state.status) !== 2 || state.expiry <= BigInt(Math.floor(Date.now() / 1000))) throw new Error(`${deployment.projectName} is inactive or expired`);
  if (state.resource.toString() !== deployment.projectResource) throw new Error(`${deployment.projectName} has a different registry resource than configured`);
  return state.latestOwner;
}
