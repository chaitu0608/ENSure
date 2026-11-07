// Node-only config. The shared constants live in chain-constants.ts so the browser can use them too.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DeploymentConfig } from './chain-constants.js';
export * from './chain-constants.js';
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FORK_BLOCK = Number(process.env.FORK_BLOCK ?? '12076677');
if(!Number.isSafeInteger(FORK_BLOCK)||FORK_BLOCK<1)throw new Error('Invalid FORK_BLOCK');
export const SOURCE_COMMIT = '07e55a056f5b6a9c90119f501bdd05714e67dddd';
export const CONFIG_FILE = resolve(REPO_ROOT, 'deployments/sepolia.json');
export const loadConfig = (): DeploymentConfig => JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
export const isMain = (url: string) => !!process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href;
export function fatal(error: unknown) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
