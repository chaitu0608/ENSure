// Node-only content store. The shared CID helpers live in content-core.ts so the browser can use them too.
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
import { ROOT } from './config.js';
import { Unavailable, cidOf } from './content-core.js';
export * from './content-core.js';
const MAX_BYTES = 1024 * 1024;
export async function put(bytes: Uint8Array) {
  if (bytes.length > MAX_BYTES) throw new Error('Raw fixture exceeds 1 MiB');
  const cid = await cidOf(bytes); await mkdir(resolve(ROOT, 'store'), { recursive: true });
  await writeFile(resolve(ROOT, 'store', cid + '.bin'), bytes); return cid;
}
export async function putFile(path: string) {
  if (basename(path).startsWith('.') || /\.(?:pem|key|p12|pfx)$/i.test(path)) throw new Error('Secret/dotfiles cannot be release artifacts');
  const s = await lstat(path); if (!s.isFile() || s.size > MAX_BYTES) throw new Error('Use one bounded regular raw fixture file');
  return put(new Uint8Array(await readFile(path)));
}
export async function get(cidString: string) {
  const cid = CID.parse(cidString).toV1();
  if (cid.code !== raw.code || cid.multihash.code !== sha256.code) throw new Error('This MVP verifies raw/sha2-256 CIDs only, not arbitrary UnixFS directory DAGs');
  const path = resolve(ROOT, 'store', cid.toString() + '.bin');
  let s; try { s = await lstat(path); } catch {
    const fixture = new Uint8Array(await readFile(resolve(ROOT, 'fixtures/release-a.html')));
    if (await cidOf(fixture) === cid.toString()) return fixture;
    throw new Unavailable('CID bytes unavailable in local content store; no Pinata/IPFS pin claimed');
  }
  if (!s.isFile() || s.size > MAX_BYTES) throw new Error('Stored object exceeds size/type limit');
  const b = new Uint8Array(await readFile(path));
  if (await cidOf(b) !== cid.toString()) throw new Error('Stored bytes fail CID integrity');
  return b;
}
