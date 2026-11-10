// Runs the real web verifier against a simulated chain and gateway, with real EIP-712 signatures from a throwaway key.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { concat, decodeFunctionData, encodeAbiParameters, hashTypedData, keccak256, namehash, parseAbi, toBytes, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildManifest, commitDigest, hashFiles, manifestBytes, manifestDigest } from '@ensure/core/manifest';
import { encodeContenthash, labelId } from '@ensure/core/ens';
import { bytesCid } from '../scripts/owner-promote-shared.js';
import { decodeProof, domainSeparatorOf, encodePromoteProof, encodeRollbackProof, promoteTypedData, releaseIdOf, rollbackTypedData, type PromoteAction, type RollbackAction } from '../scripts/controller-v2.js';

const owner = privateKeyToAccount(keccak256(toBytes('ENSure web-verify-v2 unit-test owner')));
const stranger = privateKeyToAccount(keccak256(toBytes('ENSure web-verify-v2 unit-test stranger')));
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const CONTROLLER = addr(0xc0), REGISTRY = addr(0xa1), PROD = addr(0xa2), PREVIEW = addr(0xa3), CI = addr(0xa4), ROOT = addr(0xa5), ETH = addr(0xa6), HELPER = addr(0xa7), FACTORY = addr(0xa8), REG_IMPL = addr(0xa9), RES_IMPL = addr(0xaa);
const SITE = 'bafybeicxywmb2dczdj55tpw7j2mh6alllmxutpblzqns5xc33refxjchh4';
const SHA = 'a'.repeat(40);
const ZERO = `0x${'0'.repeat(64)}` as Hex;
const S = 1n << 8n, T = 1n << 4n;

const deployment = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const chain = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock('../../../web/src/lib/config', () => ({
  get deployment() { return deployment.value; },
  get publicClient() { return chain.client; },
  NETWORK_NAME: 'Sepolia',
  GATEWAYS: ['https://gateway.test'],
  resolverForName: (name: string) => (name.startsWith('prod.') ? addr(0xa2) : addr(0xa3)),
}));

const fileBytes = new TextEncoder().encode('<h1>site</h1>');
const manifest = buildManifest({ repositoryId: 1, repositoryUrl: 'https://example.test/r', commitSha: SHA, workflowRunUrl: 'https://example.test/run', siteCid: SITE, buildTools: {}, files: hashFiles([{ path: 'index.html', bytes: fileBytes }]) } as never);
const mBytes = manifestBytes(manifest);
const mDigest = manifestDigest(mBytes);
const cDigest = commitDigest(SHA);
const contenthash = encodeContenthash(SITE);

let pointer: string;
let world: { records: Record<string, string>; contenthash: Hex; state: any; ciRootContent: boolean; files: Uint8Array; owner: Address };

async function promoted(signer = owner, digest = mDigest) {
  const separator = domainSeparatorOf(11155111, CONTROLLER);
  const action: PromoteAction = { contenthashHash: keccak256(contenthash), buildPointer: pointer, manifestDigest: digest, commitDigest: cDigest, sequence: 6n, expectedCurrentReleaseId: ZERO, nonce: 0n, deadline: 2_000_000_000n };
  const typed = promoteTypedData(11155111, CONTROLLER, action);
  const signature = await signer.signTypedData(typed);
  const proof = encodePromoteProof(separator, action, signature);
  const releaseId = releaseIdOf('ensure.eth', contenthash, pointer, digest, cDigest);
  return { separator, proof, releaseId, digest: hashTypedData(typed) };
}

async function setPromoted(signer = owner, digest = mDigest) {
  const p = await promoted(signer, digest);
  world.contenthash = contenthash;
  world.records = { 'ensure.release': '6', 'ensure.manifest': pointer, 'ensure.build': pointer, 'ensure.approval': p.proof };
  world.state = {
    separator: p.separator, lastSequence: 6n, currentReleaseId: p.releaseId, paused: false, transitionCount: 1n,
    release: { exists: true, contenthash, buildPointer: pointer, manifestDigest: digest, commitDigest: cDigest, approver: owner.address, approvedAt: 1n, firstSequence: 6n },
    transition: { sequence: 6n, fromReleaseId: ZERO, toReleaseId: p.releaseId, authorizer: owner.address, timestamp: 1n, isRollback: false, actionDigest: p.digest, proof: p.proof },
  };
}

function makeClient() {
  const profile = parseAbi(['function contenthash(bytes32 node) view returns (bytes)', 'function text(bytes32 node,string key) view returns (string)']);
  const stateOf = (latestOwner: Address, resource: bigint) => ({ status: 2, expiry: 9_999_999_999n, latestOwner, tokenId: resource, resource });
  return {
    getChainId: async () => 11155111,
    getBlock: async () => ({ number: 100n, timestamp: 1_900_000_000n, hash: `0x${'b'.repeat(64)}` }),
    readContract: async ({ address, functionName, args }: { address: Address; functionName: string; args?: readonly any[] }) => {
      switch (functionName) {
        case 'getSubregistry': return ETH;
        case 'getState':
          if (address === ROOT) return stateOf(addr(1), labelId('eth'));
          if (address === ETH) return stateOf(world.owner, 77n);
          return stateOf(addr(2), args![0] === labelId('prod') ? 88n : 99n);
        case 'findParentRegistry': case 'findExactRegistry': return REGISTRY;
        case 'findExactOwner': return addr(2);
        case 'getResolver': return args![0] === 'prod' ? PROD : PREVIEW;
        case 'verifyContract': return args![0] === REGISTRY ? REG_IMPL : RES_IMPL;
        case 'resolve': {
          const call = decodeFunctionData({ abi: profile, data: args![1] });
          const prod = address === PROD;
          if (call.functionName === 'contenthash') return encodeAbiParameters([{ type: 'bytes' }], [prod ? world.contenthash : '0x']);
          return encodeAbiParameters([{ type: 'string' }], [prod ? world.records[call.args[1] as string] ?? '' : '']);
        }
        case 'hasRootRoles': {
          const [bits, who] = args as [bigint, Address];
          if (who === CI) return world.ciRootContent && bits === S;
          if (who === CONTROLLER) return bits === S;
          if (who === owner.address) return bits === S || bits === T;
          return false;
        }
        case 'hasRoles': { const [, bits, who] = args as [bigint, bigint, Address]; return who === CONTROLLER && bits === T; }
        case 'getAssigneeCount': { const [res, bits] = args as [bigint, bigint]; return res === 0n ? [bits === S ? 2n * S : T, 0n] : [T, 0n]; }
        case 'productionRegistry': return REGISTRY;
        case 'productionResolver': return PROD;
        case 'previewResolver': return PREVIEW;
        case 'domainSeparator': return world.state.separator;
        case 'lastSequence': return world.state.lastSequence;
        case 'currentReleaseId': return world.state.currentReleaseId;
        case 'paused': return world.state.paused;
        case 'transitionCount': return world.state.transitionCount;
        case 'getRelease': return world.state.release;
        case 'getTransition': return world.state.transition;
        default: throw new Error(`Unmocked read ${functionName}`);
      }
    },
  };
}

beforeEach(async () => {
  pointer = `ipfs://${await bytesCid(mBytes)}`;
  deployment.value = {
    chainId: 11155111, label: 'ensure', projectName: 'ensure.eth', prodName: 'prod.ensure.eth', previewName: 'preview.ensure.eth',
    registry: REGISTRY, prodResolver: PROD, previewResolver: PREVIEW, owner: owner.address, ci: CI, projectResource: '77', prodResource: '88', minRelease: '4',
    releaseController: CONTROLLER, legacyBuildManifests: {},
    protocol: { rootRegistry: ROOT, ethRegistry: ETH, universalHelper: HELPER, verifiableFactory: FACTORY, registryImplementation: REG_IMPL, resolverImplementation: RES_IMPL },
  };
  world = { records: {}, contenthash: '0x', state: {}, ciRootContent: false, files: fileBytes, owner: owner.address };
  chain.client = makeClient();
  await setPromoted();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response((String(url).endsWith('/index.html') ? world.files : mBytes) as BodyInit)));
});
afterEach(() => vi.unstubAllGlobals());

const run = async () => (await import('../../../web/src/lib/verify')).verifyProject('ensure.eth');

describe('web verifier with a controller configured', () => {
  test('MATCH when records, proof, controller history, manifest digest and file hashes agree', async () => {
    const r = await run();
    expect(r.explanation).toContain('agree');
    expect(r.status).toBe('MATCH');
    expect(r.release).toBe('6');
    expect(r.approver).toBe(owner.address);
    expect(r.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['owner', 'authority', 'controller', 'approval', 'build-record', 'files']));
  });

  test('MATCH on a rollback proof', async () => {
    const { releaseId, separator } = await promoted();
    const from = `0x${'1'.repeat(64)}` as Hex;
    const action: RollbackAction = { targetReleaseId: releaseId, sequence: 8n, expectedCurrentReleaseId: from, nonce: 2n, deadline: 2_000_000_000n };
    const typed = rollbackTypedData(11155111, CONTROLLER, action);
    const proof = encodeRollbackProof(separator, action, await owner.signTypedData(typed));
    world.records['ensure.release'] = '8'; world.records['ensure.approval'] = proof;
    world.state.lastSequence = 8n;
    world.state.transition = { sequence: 8n, fromReleaseId: from, toReleaseId: releaseId, authorizer: owner.address, timestamp: 1n, isRollback: true, actionDigest: hashTypedData(typed), proof };
    expect((await run()).status).toBe('MATCH');
  });

  test('never falls back to the direct-owner path: legacy records are a MISMATCH', async () => {
    world.records = { 'ensure.release': pointer, 'ensure.manifest': pointer, 'ensure.build': '', 'ensure.approval': '{"core":{}}' };
    const r = await run();
    expect(r.status).toBe('MISMATCH');
    expect(r.explanation).toMatch(/not controller v2 records/);
  });

  const mismatches: [string, () => Promise<void> | void, RegExp][] = [
    ['contenthash written directly', () => { world.contenthash = '0xe30101701220c62d5d6bc95b90abb5a0e7536f2a894ae392f2661171649c259b6af6011bda48'; }, /contenthash differs/i],
    ['stale ensure.release', () => { world.records['ensure.release'] = '7'; }, /signed sequence/],
    ['non-canonical sequence', () => { world.records['ensure.release'] = '06'; }, /canonical decimal/],
    ['manifest pointer differs from build', () => { world.records['ensure.manifest'] = 'ipfs://bafkreihdbz27xulaxqkk7k2cbvuc2nwqtv4nd55tklyyar4faj2qauee4m'; }, /ensure\.manifest differs/],
    ['signed by someone other than the owner', async () => { await setPromoted(stranger); }, /not the current ENS parent-name owner/],
    ['owner transferred without migrating resolver roles', () => { world.owner = stranger.address; }, /additional production contenthash writer/],
    ['upper-case proof', () => { world.records['ensure.approval'] = world.records['ensure.approval'].toUpperCase().replace('0X', '0x'); }, /lower-case/],
    ['proof differs from the transition', () => { world.state.transition = { ...world.state.transition, proof: '0x00' }; }, /differs from the controller transition/],
    ['controller moved on without the records', () => { world.state.lastSequence = 7n; }, /controller sequence/],
    ['controller release ID disagrees', () => { world.state.release = { ...world.state.release, commitDigest: keccak256(toHex('other')) }; }, /release ID does not match/],
    ['proof for another controller', () => { world.state.separator = domainSeparatorOf(11155111, addr(0xdd)); }, /domain/],
    ['fetched manifest differs from the owner-signed digest', async () => { await setPromoted(owner, keccak256(toHex('another manifest'))); }, /owner-signed manifest digest/],
    ['tampered file', () => { world.files = new TextEncoder().encode('<h1>evil</h1>'); }, /do not match/],
    ['CI holds a production role', () => { world.ciRootContent = true; }, /CI .* root role/],
  ];
  test.each(mismatches)('MISMATCH: %s', async (_label, mutate, reason) => {
    await mutate();
    const r = await run();
    expect(r.status).toBe('MISMATCH');
    expect(r.explanation).toMatch(reason);
  });

  test('gateway outage is UNAVAILABLE, never MATCH', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await run()).status).toBe('UNAVAILABLE');
  });

  test('RPC outage is UNAVAILABLE, never MATCH', async () => {
    chain.client = { ...makeClient(), getChainId: async () => { throw new Error('rpc down'); } };
    expect((await run()).status).toBe('UNAVAILABLE');
  });
});

describe('v2 encoding mirrors the Solidity contract', () => {
  test('typed digest matches keccak256(0x1901 . domainSeparator . keccak256(abi.encode(TYPEHASH, ...)))', () => {
    const p: PromoteAction = { contenthashHash: keccak256('0x01'), buildPointer: 'ipfs://bafkreihdbz27xulaxqkk7k2cbvuc2nwqtv4nd55tklyyar4faj2qauee4m', manifestDigest: keccak256('0x02'), commitDigest: keccak256('0x03'), sequence: 6n, expectedCurrentReleaseId: ZERO, nonce: 1n, deadline: 99n };
    const typehash = keccak256(toBytes('Promote(bytes32 contenthashHash,string buildPointer,bytes32 manifestDigest,bytes32 commitDigest,uint64 sequence,bytes32 expectedCurrentReleaseId,uint256 nonce,uint256 deadline)'));
    const structHash = keccak256(encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }],
      [typehash, p.contenthashHash, keccak256(toBytes(p.buildPointer)), p.manifestDigest, p.commitDigest, p.sequence, p.expectedCurrentReleaseId, p.nonce, p.deadline],
    ));
    expect(hashTypedData(promoteTypedData(11155111, CONTROLLER, p))).toBe(keccak256(concat(['0x1901', domainSeparatorOf(11155111, CONTROLLER), structHash])));

    const r: RollbackAction = { targetReleaseId: keccak256('0x04'), sequence: 8n, expectedCurrentReleaseId: keccak256('0x05'), nonce: 2n, deadline: 99n };
    const rollbackHash = keccak256(encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }],
      [keccak256(toBytes('Rollback(bytes32 targetReleaseId,uint64 sequence,bytes32 expectedCurrentReleaseId,uint256 nonce,uint256 deadline)')), r.targetReleaseId, r.sequence, r.expectedCurrentReleaseId, r.nonce, r.deadline],
    ));
    expect(hashTypedData(rollbackTypedData(11155111, CONTROLLER, r))).toBe(keccak256(concat(['0x1901', domainSeparatorOf(11155111, CONTROLLER), rollbackHash])));
  });

  test('project node is the namehash the contract derives from its DNS name', () => {
    expect(namehash('ensure.eth')).toBe(keccak256(concat([namehash('eth'), keccak256(toBytes('ensure'))])));
  });

  test('proofs decode back to the same action', async () => {
    const { proof } = await promoted();
    const decoded = decodeProof(proof);
    expect(decoded.action).toBe(1);
    expect(decoded.struct.sequence).toBe(6n);
  });
});
