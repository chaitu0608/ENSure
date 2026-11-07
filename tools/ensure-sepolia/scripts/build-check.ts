// Fetches a build manifest and its listed files through IPFS gateways, comparing them with the signed commitments.
// Browser-safe and shared by the web app and CLI verifier.
import { buildManifest, hashFiles, manifestDigest, parseManifest, type Manifest } from '@ensure/core/manifest';
import { sameCid } from '@ensure/core/ens';
import type { Hex } from 'viem';
import { bytesCid } from './owner-promote-shared.js';

export class GatewayUnavailableError extends Error { override name = 'GatewayUnavailableError'; }
export class GatewayContentMismatchError extends Error { override name = 'GatewayContentMismatchError'; }
/** Data was readable but a comparison failed. Network failures never raise this. */
export class IntegrityError extends Error {}

export interface BuildCheck { cid: string; manifestCid: string; manifestDigest: Hex; gateway: string; url: string; manifest: Manifest; fileCount: number }

const pathFor = (cid: string, path?: string) => `/ipfs/${encodeURIComponent(cid)}${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`;

/** Tries each gateway until one returns bytes accepted by `matches`. A gateway serving wrong bytes never counts as success. */
export async function fetchIpfsMatching(gateways: readonly string[], cid: string, path: string | undefined, matches: (bytes: Uint8Array) => boolean | Promise<boolean>) {
  let lastError = 'No gateway configured';
  let receivedBytes = false;
  for (const gateway of new Set(gateways)) {
    const url = `${gateway}${pathFor(cid, path)}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: 'no-store' });
        if (response.status === 429 && attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await new Promise((done) => setTimeout(done, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 2500) : 350 * (2 ** attempt)));
          continue;
        }
        if (!response.ok) { lastError = `${new URL(gateway).host} returned HTTP ${response.status}`; break; }
        const bytes = new Uint8Array(await response.arrayBuffer());
        receivedBytes = true;
        if (await matches(bytes)) return { bytes, gateway, url };
        lastError = `${new URL(gateway).host} returned bytes that do not match the expected hash`;
        break;
      } catch (error) {
        lastError = `${new URL(gateway).host}: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
    }
  }
  if (receivedBytes) throw new GatewayContentMismatchError(lastError);
  throw new GatewayUnavailableError(lastError);
}

function normalizeManifest(manifest: Manifest): Manifest {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new IntegrityError('Build manifest schema is invalid or has no files');
  if (!/^[0-9a-f]{40}$/.test(manifest.commitSha) || !manifest.siteCid) throw new IntegrityError('Build manifest is missing a valid commit or site CID');
  try {
    return buildManifest({ repositoryId: manifest.repositoryId, repositoryUrl: manifest.repositoryUrl, commitSha: manifest.commitSha, workflowRunUrl: manifest.workflowRunUrl, siteCid: manifest.siteCid, buildTools: manifest.buildTools, files: manifest.files });
  } catch (error) {
    throw new IntegrityError(error instanceof Error ? error.message : 'Build manifest file list is invalid');
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; output[index] = await fn(items[index]); }
  }));
  return output;
}

/** Fetches the raw-CID build manifest, then every listed file, comparing size and SHA-256. */
export async function verifyBuild(gateways: readonly string[], siteCid: string, manifestCid: string, onProgress?: (complete: number, total: number) => void): Promise<BuildCheck> {
  if (!/^bafkrei[a-z2-7]{52}$/.test(manifestCid)) throw new IntegrityError(`Build manifest pointer ${manifestCid} is not a raw SHA-256 CID`);
  const fetched = await fetchIpfsMatching(gateways, manifestCid, undefined, async (bytes) => sameCid(await bytesCid(bytes), manifestCid));
  let parsed: Manifest;
  try { parsed = normalizeManifest(parseManifest(fetched.bytes)); }
  catch (error) {
    if (error instanceof IntegrityError) throw error;
    throw new IntegrityError(error instanceof Error ? error.message : 'Build manifest could not be parsed');
  }
  if (!sameCid(parsed.siteCid, siteCid)) throw new IntegrityError(`Build manifest siteCid ${parsed.siteCid} differs from the ENS contenthash ${siteCid}`);
  const paths = new Set<string>();
  for (const file of parsed.files) {
    if (paths.has(file.path)) throw new IntegrityError(`Build manifest repeats file path ${file.path}`);
    paths.add(file.path);
  }
  if (!paths.has('index.html')) throw new IntegrityError('Build manifest does not include index.html');
  let complete = 0;
  await mapLimit(parsed.files, 6, async (file) => {
    await fetchIpfsMatching(gateways, siteCid, file.path, (bytes) => bytes.length === file.size && hashFiles([{ path: file.path, bytes }])[0].sha256 === file.sha256);
    onProgress?.(++complete, parsed.files.length);
  });
  return { cid: siteCid, manifestCid, manifestDigest: manifestDigest(fetched.bytes), gateway: fetched.gateway, url: fetched.url, manifest: parsed, fileCount: parsed.files.length };
}
