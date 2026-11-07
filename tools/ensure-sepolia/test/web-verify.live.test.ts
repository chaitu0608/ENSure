// Read-only check of the real web verifier against live Sepolia and IPFS. Run with: ENSURE_LIVE=1 pnpm vitest run tools/ensure-sepolia/test/web-verify.live.test.ts
import { expect, test } from 'vitest';
import { deployment } from '../../../web/src/lib/config';
import { verifyProject } from '../../../web/src/lib/verify';

test.runIf(process.env.ENSURE_LIVE)(`${deployment.projectName} verifies end to end`, async () => {
  const r = await verifyProject(deployment.projectName);
  console.log(r.status, '-', r.explanation);
  for (const c of r.checks) console.log(`  [${c.state}] ${c.label}: ${c.detail}`);
  expect(r.status).toBe('MATCH');
}, 180_000);
