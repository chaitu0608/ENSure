// ENSureReleaseController v2 protocol: ABI, typed data, proof decoding and record checks.
// Browser-safe and shared by the web app and CLI verifier. See docs/ENSURE.md.
import { decodeAbiParameters, encodeAbiParameters, hashTypedData, isAddressEqual, keccak256, namehash, parseAbi, recoverTypedDataAddress, toBytes, type Address, type Hex } from 'viem';

export const controllerAbi = parseAbi([
  'struct Promote { bytes32 contenthashHash; string buildPointer; bytes32 manifestDigest; bytes32 commitDigest; uint64 sequence; bytes32 expectedCurrentReleaseId; uint256 nonce; uint256 deadline; }',
  'struct Rollback { bytes32 targetReleaseId; uint64 sequence; bytes32 expectedCurrentReleaseId; uint256 nonce; uint256 deadline; }',
  'struct Release { bool exists; bytes contenthash; string buildPointer; bytes32 manifestDigest; bytes32 commitDigest; address approver; uint64 approvedAt; uint64 firstSequence; }',
  'struct Transition { uint64 sequence; bytes32 fromReleaseId; bytes32 toReleaseId; address authorizer; uint64 timestamp; bool isRollback; bytes32 actionDigest; bytes proof; }',
  'function promote(bytes contenthashBytes, Promote p, bytes signature) returns (bytes32 releaseId)',
  'function rollback(Rollback r, bytes signature)',
  'function pause()',
  'function unpause()',
  'function paused() view returns (bool)',
  'function lastSequence() view returns (uint64)',
  'function currentReleaseId() view returns (bytes32)',
  'function nonces(address owner) view returns (uint256)',
  'function domainSeparator() view returns (bytes32)',
  'function currentOwner() view returns (address)',
  'function productionRegistry() view returns (address)',
  'function productionResolver() view returns (address)',
  'function previewResolver() view returns (address)',
  'function getRelease(bytes32 releaseId) view returns (Release)',
  'function transitionCount() view returns (uint256)',
  'function getTransition(uint256 index) view returns (Transition)',
  'event ReleasePromoted(bytes32 indexed releaseId, bytes32 indexed previousReleaseId, address indexed approver, uint64 sequence, bytes32 actionDigest)',
  'event ReleaseRolledBack(bytes32 indexed releaseId, bytes32 indexed fromReleaseId, address indexed approver, uint64 sequence, bytes32 actionDigest)',
  'error WrongChain()', 'error InvalidConfig()', 'error NotOwner()', 'error InvalidOwnerContext()', 'error InvalidSignature()',
  'error InvalidNonce()', 'error ApprovalExpired()', 'error InvalidSequence()', 'error CurrentReleaseMismatch()', 'error ResolverMismatch()',
  'error PreviewContenthashMismatch()', 'error PreviewBuildMismatch()', 'error InvalidArtifact()', 'error ReleaseExists()', 'error UnknownRelease()',
  'error PromotionsPaused()', 'error InvalidPauseState()', 'error WriteVerificationFailed()', 'error Reentrancy()',
]);

export interface PromoteAction { contenthashHash: Hex; buildPointer: string; manifestDigest: Hex; commitDigest: Hex; sequence: bigint; expectedCurrentReleaseId: Hex; nonce: bigint; deadline: bigint }
export interface RollbackAction { targetReleaseId: Hex; sequence: bigint; expectedCurrentReleaseId: Hex; nonce: bigint; deadline: bigint }
export interface ControllerRelease { exists: boolean; contenthash: Hex; buildPointer: string; manifestDigest: Hex; commitDigest: Hex; approver: Address; approvedAt: bigint; firstSequence: bigint }
export interface ControllerTransition { sequence: bigint; fromReleaseId: Hex; toReleaseId: Hex; authorizer: Address; timestamp: bigint; isRollback: boolean; actionDigest: Hex; proof: Hex }

const promoteFields = [
  { name: 'contenthashHash', type: 'bytes32' }, { name: 'buildPointer', type: 'string' }, { name: 'manifestDigest', type: 'bytes32' }, { name: 'commitDigest', type: 'bytes32' },
  { name: 'sequence', type: 'uint64' }, { name: 'expectedCurrentReleaseId', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
] as const;
const rollbackFields = [
  { name: 'targetReleaseId', type: 'bytes32' }, { name: 'sequence', type: 'uint64' }, { name: 'expectedCurrentReleaseId', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
] as const;
const proofHead = [{ type: 'uint8' }, { type: 'uint8' }, { type: 'bytes32' }] as const;
const promoteProof = [...proofHead, { type: 'tuple', components: promoteFields }, { type: 'bytes' }] as const;
const rollbackProof = [...proofHead, { type: 'tuple', components: rollbackFields }, { type: 'bytes' }] as const;

export const ACTION_PROMOTE = 1, ACTION_ROLLBACK = 2;
export const domain = (chainId: number, controller: Address) => ({ name: 'ENSureReleaseController', version: '2', chainId, verifyingContract: controller }) as const;
export const promoteTypedData = (chainId: number, controller: Address, message: PromoteAction) => ({ domain: domain(chainId, controller), types: { Promote: promoteFields }, primaryType: 'Promote', message }) as const;
export const rollbackTypedData = (chainId: number, controller: Address, message: RollbackAction) => ({ domain: domain(chainId, controller), types: { Rollback: rollbackFields }, primaryType: 'Rollback', message }) as const;

export const domainSeparatorOf = (chainId: number, controller: Address): Hex => keccak256(encodeAbiParameters(
  [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
  [keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(toBytes('ENSureReleaseController')), keccak256(toBytes('2')), BigInt(chainId), controller],
));

export const releaseIdOf = (projectName: string, contenthash: Hex, buildPointer: string, manifestDigest: Hex, commitDigest: Hex): Hex => keccak256(encodeAbiParameters(
  [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
  [namehash(projectName), keccak256(contenthash), keccak256(toBytes(buildPointer)), manifestDigest, commitDigest],
));

export const encodePromoteProof = (separator: Hex, p: PromoteAction, signature: Hex): Hex => encodeAbiParameters(promoteProof, [2, ACTION_PROMOTE, separator, p, signature]);
export const encodeRollbackProof = (separator: Hex, r: RollbackAction, signature: Hex): Hex => encodeAbiParameters(rollbackProof, [2, ACTION_ROLLBACK, separator, r, signature]);

/** A controller record or proof that was readable but does not agree. Never used for RPC or gateway failures. */
export class ReleaseProofError extends Error {}
function check(ok: unknown, why: string): asserts ok { if (!ok) throw new ReleaseProofError(why); }

export type DecodedProof =
  | { action: typeof ACTION_PROMOTE; separator: Hex; struct: PromoteAction; signature: Hex }
  | { action: typeof ACTION_ROLLBACK; separator: Hex; struct: RollbackAction; signature: Hex };

export function decodeProof(approval: string): DecodedProof {
  check(/^0x(?:[0-9a-f]{2})+$/.test(approval), 'ensure.approval is not lower-case 0x hex');
  const hex = approval as Hex;
  try {
    const [version, action, separator] = decodeAbiParameters(proofHead, hex);
    check(version === 2, `Unsupported approval proof version ${version}`);
    check(action === ACTION_PROMOTE || action === ACTION_ROLLBACK, `Unknown approval proof action ${action}`);
    if (action === ACTION_PROMOTE) {
      const [, , , struct, signature] = decodeAbiParameters(promoteProof, hex);
      check(encodePromoteProof(separator, struct, signature) === hex, 'Approval proof is not canonically encoded');
      return { action, separator, struct: struct as PromoteAction, signature };
    }
    const [, , , struct, signature] = decodeAbiParameters(rollbackProof, hex);
    check(encodeRollbackProof(separator, struct, signature) === hex, 'Approval proof is not canonically encoded');
    return { action, separator, struct: struct as RollbackAction, signature };
  } catch (error) {
    if (error instanceof ReleaseProofError) throw error;
    throw new ReleaseProofError('ensure.approval is not a valid controller v2 ABI proof');
  }
}

export interface ControllerState {
  productionRegistry: Address; productionResolver: Address; previewResolver: Address;
  separator: Hex; lastSequence: bigint; currentReleaseId: Hex; paused: boolean;
  release: ControllerRelease; transitionCount: bigint; transition?: ControllerTransition;
}
type Reader = { readContract: (args: any) => Promise<any> };

export async function readControllerState(client: Reader, controller: Address, blockNumber?: bigint): Promise<ControllerState> {
  const read = (functionName: string, args: readonly unknown[] = []) => client.readContract({ address: controller, abi: controllerAbi, functionName, args, ...(blockNumber === undefined ? {} : { blockNumber }) });
  const [productionRegistry, productionResolver, previewResolver, separator, lastSequence, currentReleaseId, paused, transitionCount] = await Promise.all([
    read('productionRegistry'), read('productionResolver'), read('previewResolver'), read('domainSeparator'), read('lastSequence'), read('currentReleaseId'), read('paused'), read('transitionCount'),
  ]);
  const [release, transition] = await Promise.all([read('getRelease', [currentReleaseId]), transitionCount > 0n ? read('getTransition', [transitionCount - 1n]) : undefined]);
  return { productionRegistry, productionResolver, previewResolver, separator, lastSequence, currentReleaseId, paused, release, transitionCount, transition };
}

export interface V2Records { contenthash: Hex; release: string; manifest: string; build: string; approval: string }
export interface V2Context { chainId: number; controller: Address; projectName: string; owner: Address; prodResolver: Address; previewResolver: Address; registry: Address }
export interface V2Result { sequence: bigint; action: DecodedProof['action']; signer: Address; releaseId: Hex; manifestCid: string; release: ControllerRelease; digest: Hex }

const POINTER = /^ipfs:\/\/((?:bafkrei|bafybei)[a-z2-7]{52})$/;

/** Checks the five prod records, the signed proof and controller history all agree. Files are checked separately. */
export async function verifyV2Release(ctx: V2Context, records: V2Records, state: ControllerState): Promise<V2Result> {
  check(isAddressEqual(state.productionResolver, ctx.prodResolver) && isAddressEqual(state.previewResolver, ctx.previewResolver) && isAddressEqual(state.productionRegistry, ctx.registry), 'Controller is wired to a different registry or resolver than configured');
  check(/^[1-9][0-9]*$/.test(records.release) && records.release.length <= 20, 'ensure.release is not a canonical decimal sequence; these are not controller v2 records');
  const pointer = POINTER.exec(records.build);
  check(pointer, 'ensure.build is not a CID-only ipfs:// build manifest pointer');
  check(records.manifest === records.build, 'ensure.manifest differs from ensure.build');
  const proof = decodeProof(records.approval);
  const expectedSeparator = domainSeparatorOf(ctx.chainId, ctx.controller);
  check(proof.separator === expectedSeparator && state.separator === expectedSeparator, 'Approval proof domain is not this chain and controller');

  const sig = proof.signature;
  check(/^0x[0-9a-f]{130}$/.test(sig) && BigInt(`0x${sig.slice(66, 130)}`) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n && ['1b', '1c'].includes(sig.slice(130)), 'Approval signature is malformed or noncanonical');
  const typedPromote = proof.action === ACTION_PROMOTE ? promoteTypedData(ctx.chainId, ctx.controller, proof.struct) : undefined;
  const typedRollback = proof.action === ACTION_ROLLBACK ? rollbackTypedData(ctx.chainId, ctx.controller, proof.struct) : undefined;
  const signer = typedPromote ? await recoverTypedDataAddress({ ...typedPromote, signature: sig }) : await recoverTypedDataAddress({ ...typedRollback!, signature: sig });
  check(isAddressEqual(signer, ctx.owner), `EIP-712 signer ${signer} is not the current ENS parent-name owner ${ctx.owner}`);
  const digest = typedPromote ? hashTypedData(typedPromote) : hashTypedData(typedRollback!);

  const sequence = BigInt(records.release);
  check(proof.struct.sequence === sequence && state.lastSequence === sequence, `ensure.release ${records.release} differs from the signed sequence ${proof.struct.sequence} or controller sequence ${state.lastSequence}`);

  const { release, transition, currentReleaseId } = state;
  check(transition, 'Release controller has no recorded transition');
  check(transition.sequence === sequence && transition.toReleaseId === currentReleaseId && transition.fromReleaseId === proof.struct.expectedCurrentReleaseId, 'Latest controller transition does not match the live records');
  check(isAddressEqual(transition.authorizer, signer) && transition.isRollback === (proof.action === ACTION_ROLLBACK) && transition.actionDigest === digest && transition.proof === records.approval, 'Live approval proof differs from the controller transition');

  check(release.exists, 'Current controller release does not exist');
  check(release.contenthash === records.contenthash, 'ENS contenthash differs from the controller-approved artifact');
  check(release.buildPointer === records.build, 'ensure.build differs from the controller-approved build pointer');
  check(releaseIdOf(ctx.projectName, release.contenthash, release.buildPointer, release.manifestDigest, release.commitDigest) === currentReleaseId, 'Controller release ID does not match its artifact fields');
  if (proof.action === ACTION_PROMOTE) {
    const p = proof.struct;
    check(p.contenthashHash === keccak256(release.contenthash) && p.buildPointer === release.buildPointer && p.manifestDigest === release.manifestDigest && p.commitDigest === release.commitDigest, 'Signed promotion differs from the stored controller release');
  } else {
    check(proof.struct.targetReleaseId === currentReleaseId, 'Signed rollback targets a different release');
  }
  return { sequence, action: proof.action, signer, releaseId: currentReleaseId, manifestCid: pointer[1], release, digest };
}

const SET_TEXT = 1n << 4n, SET_CONTENTHASH = 1n << 8n, LINK = 1n << 28n, UPGRADE = 1n << 124n;
const adminOf = (role: bigint) => role << 128n;
const V2_KEYS = ['ensure.release', 'ensure.manifest', 'ensure.approval', 'ensure.build'] as const;
export type RoleRead = (functionName: 'hasRootRoles' | 'hasRoles' | 'getAssigneeCount', args: readonly unknown[]) => Promise<unknown>;

/**
 * Explicit production-writer allowlist once the controller is live: only the owner and controller may write,
 * the controller has exactly its documented roles, and CI has none. Returns the first problem, or undefined.
 */
export async function prodAuthorityProblem(read: RoleRead, who: { owner: Address; controller: Address; ci: Address }): Promise<string | undefined> {
  const root = (bits: bigint, account: Address) => read('hasRootRoles', [bits, account]) as Promise<boolean>;
  const scoped = (key: string, bits: bigint, account: Address) => read('hasRoles', [BigInt(keccak256(toBytes(key))), bits, account]) as Promise<boolean>;
  const count = async (resource: bigint, bits: bigint) => ((await read('getAssigneeCount', [resource, bits])) as readonly [bigint, bigint])[0];

  for (const role of [SET_CONTENTHASH, SET_TEXT, LINK, UPGRADE]) {
    if (await root(role, who.ci) || await root(adminOf(role), who.ci)) return `CI ${who.ci} holds a production resolver root role`;
    if (await root(adminOf(role), who.controller)) return 'Controller holds a production resolver admin role';
  }
  if (await root(SET_TEXT, who.controller) || await root(LINK, who.controller) || await root(UPGRADE, who.controller)) return 'Controller holds a root role beyond contenthash';
  if (!await root(SET_CONTENTHASH, who.controller)) return 'Controller lacks the production contenthash role';
  for (const key of V2_KEYS) {
    if (await scoped(key, SET_TEXT, who.ci) || await scoped(key, adminOf(SET_TEXT), who.ci)) return `CI ${who.ci} holds a production ${key} role`;
    if (!await scoped(key, SET_TEXT, who.controller)) return `Controller lacks the production ${key} text role`;
    if (await scoped(key, adminOf(SET_TEXT), who.controller)) return `Controller holds a production ${key} admin role`;
    if (await count(BigInt(keccak256(toBytes(key))), SET_TEXT) !== SET_TEXT) return `Unexpected additional writer for production ${key}`;
  }
  // EAC counts are packed: one assignee on a role reads back as that role's bit.
  const ownerContent = await root(SET_CONTENTHASH, who.owner), ownerText = await root(SET_TEXT, who.owner);
  if (await count(0n, SET_CONTENTHASH) !== (ownerContent ? 2n : 1n) * SET_CONTENTHASH) return 'Unexpected additional production contenthash writer';
  if (await count(0n, SET_TEXT) !== (ownerText ? SET_TEXT : 0n)) return 'Unexpected additional production root text writer';
  return undefined;
}
