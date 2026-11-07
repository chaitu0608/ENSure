// Browser-safe CID/contenthash helpers (no node:* imports). content.ts re-exports these.
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
import { bytesToHex, concatHex, hexToBytes, type Hex } from 'viem';
export class Unavailable extends Error {}
export const canonicalCid = (s: string) => CID.parse(s).toV1().toString();
export async function cidOf(bytes: Uint8Array) { return CID.createV1(raw.code, await sha256.digest(bytes)).toString(); }
export const contenthash = (cid: string): Hex => concatHex(['0xe301', bytesToHex(CID.parse(cid).toV1().bytes)]);
export function cidFromContenthash(hash: Hex) {
  if (!hash.startsWith('0xe301')) throw new Error('Expected ENSIP-7 direct ipfs-ns contenthash');
  return CID.decode(hexToBytes(('0x' + hash.slice(6)) as Hex)).toV1().toString();
}
export const sha256Hex = async (bytes: Uint8Array): Promise<Hex> => bytesToHex((await sha256.digest(bytes)).digest);
/** True when the CID is a raw (single-file) codec; false for UnixFS directories and other codecs. */
export const isRawCid = (cid: string) => CID.parse(cid).toV1().code === raw.code;
/** Multihash digest of a CIDv1, as 0x-prefixed hex, used as buildHash for directory releases. */
export const cidDigestHex = (cid: string): Hex => bytesToHex(CID.parse(cid).toV1().multihash.digest);
