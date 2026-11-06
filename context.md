# ENSure Shared Context

**Updated:** 2026-11-06

**Canonical project:** ENSure
**Current state:** Product and implementation planning are committed. The application and contract are not implemented or deployed yet.

This file is the starting point for every teammate and new work session. Read [plan.md](./plan.md) for product decisions and [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) for the ordered implementation checklist.

## What we are making

ENSure publishes a static website from a Git commit, pins the exact output on IPFS, and uses ENSv2 to expose an owner-approved release. Anyone can check that the production ENS name and the retrieved files still match the approved release before connecting a wallet.

**Short pitch:** “Know which website build your ENS name is serving, and whether its owner approved that exact build.”

The main use case is a wallet-facing website whose frontend could be replaced or deployed incorrectly. The product makes release changes visible and gives the owner a clear rollback path.

## Why this is different from a Git history

Git identifies source revisions. ENSure connects a source revision to built static files, an IPFS CID, the current production ENS records, and the owner transaction that approved those records. A visitor checks the public name and artifact, not merely a repository version label.

The connection is evidence for investigation. It does not prove that a named human authored malicious code, that the source is safe, or that a particular release caused a production outage. Those claims would require stronger identity, build attestation, and observability systems.

## Agreed MVP scope

| Area | Decision |
| --- | --- |
| Build source | One team-controlled GitHub project with a protected main branch |
| Build runner | GitHub Actions building the exact triggering commit SHA |
| Storage | Pinata pins the static site directory and release manifest to IPFS |
| Naming | ENSv2 parent name with preview and production subnames |
| Permissions | Separate Permissioned Resolver instances for preview and production |
| Approval | Owner wallet or Safe calls ENSureReleaseController |
| Public check | Verify page reads ENSv2, controller state, manifest, and site files |
| First network | Sepolia after confirming the live V2 deployment and interfaces |
| Deferred | Arkiv, Swarm, IPNS, World ID, token gating, AI agents, arbitrary public builds |

The project is independent. Repository files and commit messages should describe ENSure and its own architecture. Do not add names or links from historical inspiration to code, documentation, issues, or demo copy.

## The end-to-end flow

~~~text
1. Developer pushes a commit to protected main.
2. CI checks out that exact SHA and builds static files.
3. CI hashes every published file and creates a canonical manifest.
4. Pinata pins the site directory and returns the site CID.
5. CI adds the site CID to the manifest, pins it, and gets the manifest CID.
6. CI checks both pinned artifacts, then updates preview ENS only.
7. Owner reviews the candidate and signs a Promote transaction.
8. Release controller updates production ENS contenthash and evidence records atomically.
9. Visitor verifies production ENS → controller release → manifest → file hashes.
10. Owner can roll back to an earlier approved release.
~~~

A CI success creates a candidate. It does not publish that candidate to production.

## ENSv2 structure and authority

The project parent name has reserved preview and production entries in a child Permissioned Registry. Each entry points to a different Permissioned Resolver:

~~~text
<project>.eth
├── preview.<project>.eth → preview resolver → CI may write contenthash
└── prod.<project>.eth    → production resolver → controller may write contenthash
~~~

ENSv2 resolver permissions are shared across all names served by that resolver instance. Separate instances are required to make the preview key unable to write production. The owner Safe controls registry pointers and role administration. The release controller gets only the production contenthash and necessary text-key setter roles. CI receives no production or admin role.

Production records are:

- contenthash: ENSIP-7 encoded IPFS site CID
- ensure.manifest: full manifest CID
- ensure.release: current release ID

The controller changes these records in one resolver multicall. It checks that the registry still points the production label at the configured resolver. Verify checks the same pointer and compares the live records with the controller's approved release.

The owner Safe remains the root of trust because it can administer the registry and resolver. A direct change that bypasses the controller should appear as a mismatch to the verifier.

## Artifact identities

Each build produces two CIDs:

1. **Site CID:** identifies the static website directory.
2. **Manifest CID:** identifies canonical JSON containing the site CID, repository ID, full commit SHA, GitHub Actions run, build tool versions, and sorted file list with SHA-256 digests.

The controller stores the encoded site contenthash, full manifest CID, a digest of canonical manifest bytes, a commit digest, approval details, and release history. CIDs are complete strings or encoded contenthash bytes; they are not assumed to fit into bytes32.

The same manifest canonicalization and hashing code must run in CI and the verifier.

## What Verify must show

- **MATCH:** resolver pointer, ENS records, controller state, manifest digest, site CID, and checked files all agree.
- **MISMATCH:** available data disagrees; show exactly which comparison failed and the previous approved release.
- **UNAVAILABLE:** ENS, RPC, manifest, or IPFS retrieval failed before verification finished.

UNAVAILABLE must not be shown as a green result. The verifier does not declare code safe; it checks release consistency and the bytes it fetched.

## Pinata, performance, and availability

Pinata pins the static files and manifest and returns CIDs. It helps keep content available; it does not decide which release is official. The owner-approved ENS pointer does that.

An IPFS CID protects content identity, but one pin provider or gateway can be slow or unavailable. For the MVP, measure retrieval time and show an honest UNAVAILABLE state. Additional pins and Swarm mirroring are future availability work. Arkiv may later index richer release passports; it is not the static website delivery path in the MVP.

## Important network uncertainty

The prize wording supplied to the team says ENSv2 is live on Ethereum mainnet. The [current ENS deployment documentation](https://docs.ens.domains/learn/deployments/) lists mainnet V2 contracts but says mainnet registration and resolution continue through V1 until launch completes. It lists Sepolia as running V2. Treat this as a deployment gate: confirm the target with ENS and verify actual contract behavior onchain. Do not assume a mainnet V2 address or ABI from event wording alone.

The prize allows mainnet or Sepolia. The first implementation target is Sepolia unless a live mainnet V2 path is confirmed.

## Build sequence and present status

| Step | Outcome required | Status |
| --- | --- | --- |
| 1. Confirm ENSv2 deployment and permissions | Preview key succeeds on preview and reverts on production | Not started |
| 2. Build manifest and Pinata scripts | One commit yields site CID, manifest CID, and digest | Not started |
| 3. Implement release controller | Owner promotion and rollback update production records atomically | Not started |
| 4. Wire GitHub Actions and dashboard | CI publishes preview; owner signs production | Not started |
| 5. Build public Verify page | Real MATCH, MISMATCH, and UNAVAILABLE states | Not started |
| 6. Demo and submit | Live demo, deployed contracts, accessible source | Not started |

The first technical task is the ENSv2 smoke test. The team should confirm the parent name, chain, owner Safe, preview writer address, official deployment addresses, and ABI version before deploying the controller. Grokbot can help generate and deploy the contract after those inputs are fixed; its output must be reviewed against the confirmed interfaces.

## Demonstration to build toward

1. Push a static site change and show its commit and build run.
2. Show the site and manifest CIDs from Pinata.
3. Show CI updating preview while a production write from the same key reverts.
4. Promote the candidate with the owner wallet.
5. Verify the live production ENS name and show MATCH.
6. Change a test pointer or serve a deliberately mismatched artifact and show MISMATCH.
7. Roll back to the previous approved release and show MATCH again.

The demo must use live ENSv2 reads and transactions. Hard-coded success values do not meet the product goal.

## Team rules for implementation

- Use this repository as the only project codebase.
- Keep production wallet keys out of CI, source files, logs, and chat.
- Keep forked pull-request builds separate from the trusted publish job.
- Pin the selected ENSv2 ABI and deployed addresses before writing contract integration code.
- Record a release receipt with full CIDs, commit SHA, workflow URL, manifest digest, and ENS transaction hashes.
- Preserve the distinction between a verified artifact and a safe artifact in product copy.
- Keep the MVP focused on one team-controlled static site and one production channel.

## Submission requirements

The application must function on ENSv2 mainnet or Sepolia, use ENSv2 features as part of the core flow, expose a live demo, and publish accessible open-source code. The repository is currently private and must become public before submission.

## Decisions still needed

1. Final ENS parent name and owner Safe.
2. Static demo site's build command and output folder.
3. Sponsor-confirmed network and ENSv2 deployment addresses.
4. RPC provider and IPFS retrieval route for public verification.

These are configuration decisions. They do not change the agreed product flow.
