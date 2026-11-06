# ENSure Product and Build Plan

## Purpose

ENSure lets a team publish a static website under an ENSv2 name and lets visitors verify that the name still serves the exact release the owner approved.

**One-line pitch:** “Before you connect your wallet, check that this ENS website is still serving the build its owner approved.”

This plan is the product handoff for implementation. [context.md](./context.md) records the team's current state and agreed decisions. [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) contains the detailed build sequence and contract handoff.

## The problem

A website can change after users have trusted its URL. A malicious frontend replacement, a mistaken deployment, or a compromised CI key can put different code in front of a wallet user. Git records source revisions, but it does not itself show which static files the public ENS name currently serves or whether an owner approved that exact release.

ENSure gives each build a content address and makes the production approval visible. A visitor checks the live ENS resolver, the approved release record, the IPFS manifest, and the fetched files.

The product does not label a developer malicious. It can show the commit, build run, approving wallet, and ENS transaction associated with a release. Those facts support an investigation but do not establish a person's identity or the root cause of an outage by themselves.

## MVP user journeys

### Developer

1. Push a commit to the protected project branch.
2. GitHub Actions builds the exact SHA and generates a static output directory.
3. The pipeline pins the directory and a release manifest through Pinata.
4. The pipeline updates a preview ENS name using a key with preview-only rights.
5. The developer shares the preview and release receipt with the owner.

### Owner

1. Open the dashboard and inspect the preview, commit, run, CIDs, and file list.
2. Promote a chosen candidate using the owner wallet or Safe.
3. See production ENS records update together and the release appear in history.
4. If needed, select an earlier approved release and roll back without rebuilding.

### Visitor

1. Open the public Verify page without connecting a wallet.
2. Enter the production ENS name.
3. See MATCH, MISMATCH, or UNAVAILABLE, with the specific evidence behind the result.
4. If there is a mismatch, inspect the last known approved release.

## Release and verification flow

~~~text
Git commit SHA
    ↓
Static build and sorted file list
    ↓
Pinata pins website directory → site CID
    ↓
Manifest binds commit + build run + site CID + file hashes
    ↓
Pinata pins manifest → manifest CID
    ↓
Preview ENS name updated by CI
    ↓
Owner approves one candidate onchain
    ↓
Production ENS contenthash + manifest pointer + release ID updated together
    ↓
Anyone verifies ENS → approval record → manifest → downloaded files
~~~

The site CID identifies the static file tree. The manifest CID identifies the release description. The production name can change over time, but each approved release keeps its own immutable artifact identity.

## ENSv2 architecture

~~~text
<project>.eth
├── preview.<project>.eth → preview Permissioned Resolver
└── prod.<project>.eth    → production Permissioned Resolver
~~~

The owner controls the parent name. A child Permissioned Registry contains reserved preview and production labels. Each label points to its own Permissioned Resolver. Reserved entries are useful because these are routing names, not transferable user subnames.

ENSv2 features are central to the product:

| Feature | Product value |
| --- | --- |
| Hierarchical registry | The project controls its own preview and production namespace. |
| Permissioned Resolver instances | Preview and production have separate writer boundaries. |
| Enhanced Access Control | CI may write preview contenthash; the controller may write production contenthash and only the required text keys. |
| Contenthash | The public name points to an IPFS content address for the approved website. |
| Universal Resolver | The public verifier reads the actual records served by the name. |
| Resolver multicall | Production contenthash and release evidence change in one transaction. |

Resolver roles are not scoped to a single name. A writer granted a role on one resolver can use that role on every name served by it. The two-resolver split is a required security boundary. Text roles can be restricted to individual keys, while contenthash permission is resolver-wide.

Record linking and wildcard resolution are useful ENSv2 features, but the MVP uses explicit registry entries and direct records to keep the authorization path clear. Additional channel names can be added later under the same architecture.

## Production records

| Record | Meaning |
| --- | --- |
| contenthash | ENSIP-7 encoded IPFS site CID |
| ensure.manifest text record | Complete manifest CID |
| ensure.release text record | Current approved release ID |

The ENSureReleaseController is the only routine writer to the production resolver. It checks that the registry still points the production label to the configured resolver before each write. The owner Safe retains registry and resolver administration. A verifier flags any current pointer or record that disagrees with the controller's approved state.

## Contract boundary

One application contract, ENSureReleaseController, handles promotion and rollback. It stores:

- The owner Safe address and production ENS configuration.
- The current approved release ID.
- Each approved release's encoded contenthash, manifest CID, manifest digest, commit digest, previous release ID, approver, and timestamp.

The owner calls promote with the encoded contenthash, manifest CID, manifest digest, and commit digest. The contract updates contenthash, ensure.manifest, and ensure.release through one ENSv2 Permissioned Resolver multicall. Rollback restores all three values for a stored release.

The contract does not build a site, fetch IPFS data, assess code safety, or issue ENS names. The owner reviews a candidate before approval; the public verifier checks the evidence afterward.

## Manifest and artifact rules

- Build the exact triggering Git commit SHA.
- Generate a deterministic, sorted list of published relative paths.
- Record each file's byte length, MIME type, and SHA-256 digest.
- Pin the static directory first, then include its full CID in the canonical manifest.
- Pin the manifest separately and calculate keccak256 over its canonical bytes.
- Store full CID strings. Encode the site CID as ENSIP-7 contenthash bytes for ENS.
- Keep manifest canonicalization in one shared package used by both CI and Verify.

For the first demo, support one known static build command and output directory. Build arbitrary submitted repositories only after the permissioned release flow is stable.

## Pinata's role

Pinata receives the static directory and manifest, pins them on IPFS, and returns their CIDs. The CID gives the verifier a content identity; pinning helps keep the bytes available. Pinata does not approve a release or attest that the code is safe. ENSv2 and the owner transaction decide which pinned artifact is production.

A single pinning provider and gateway can be slow or unavailable. The verifier must show UNAVAILABLE in that case. Independent pins and Swarm mirroring can improve availability later. Arkiv may later hold a queryable passport, but it is not a replacement for serving the static website in the MVP.

## Verify result rules

The public page reads the production name through ENSv2 resolution. It checks the returned resolver against the configured production resolver and the registry pointer. Then it compares ENS records with the controller's current release, downloads the manifest by CID, checks its canonical digest, decodes the site CID from contenthash, and hashes the files retrieved from IPFS.

| Result | Meaning |
| --- | --- |
| MATCH | Every required comparison completed and agreed. |
| MISMATCH | Data was available, but a resolver, record, manifest, CID, or file differed. |
| UNAVAILABLE | RPC, ENS resolution, or IPFS retrieval failed before the check completed. |

Show the expected and observed values, the commit and build run, both CIDs, the approval transaction, and the previous approved release. Never show green when a required check did not finish.

## Stack

| Layer | Initial choice |
| --- | --- |
| Smart contract | Solidity + Foundry |
| Network | Sepolia first, after confirming live ENSv2 deployment |
| Frontend | TypeScript + React, with wallet integration for owner actions |
| ENS access | Current ENSv2-compatible library and official deployed ABIs |
| Build automation | GitHub Actions on protected main |
| Artifact storage | Pinata pinning static files and manifest on IPFS |
| Public evidence | ENS records, controller state/events, IPFS CIDs |

Do not put the owner Safe key in CI. A restricted preview signing key and Pinata credential may live in a protected GitHub Environment for the trusted publish job. Pull requests build without those credentials.

## Network decision

The prize wording supplied to the team says ENSv2 is live on mainnet. The [current ENS deployment page](https://docs.ens.domains/learn/deployments/) lists V2 contracts on mainnet but also says mainnet registration and resolution still use V1 until launch completes; it lists Sepolia as running V2. These statements must be reconciled with the ENS sponsor and a live onchain smoke test. Do not hard-code mainnet addresses or claim mainnet V2 behavior before the chosen path is proven. Sepolia satisfies the stated prize requirement and is the first target.

## Ordered milestones

### 1. Confirm ENS deployment and roles

- [ ] Confirm chain, Universal Resolver entry point, factory, registry, and resolver addresses with ENS.
- [ ] Pin the matching ABI version.
- [ ] Create parent/child registry setup and reserved preview/production labels.
- [ ] Assign separate resolvers.
- [ ] Prove the preview key can write preview and is rejected on production.

### 2. Build the artifact pipeline

- [ ] Build one static demo site from an exact commit.
- [ ] Create and hash the canonical manifest.
- [ ] Pin site and manifest with Pinata and read them back.
- [ ] Encode and decode the ENS contenthash.

### 3. Deploy the release controller

- [ ] Implement the controller against the confirmed ENSv2 interfaces.
- [ ] Verify authorization, resolver-pointer check, atomic writes, and rollback.
- [ ] Deploy and verify source on the selected test network.
- [ ] Grant the controller only production contenthash and key-scoped text setter roles.

### 4. Connect CI, dashboard, and Verify

- [ ] Publish preview from the trusted GitHub Actions job.
- [ ] Display candidate evidence and let the owner sign Promote.
- [ ] Read production records back after confirmation.
- [ ] Build the independent public Verify page and evidence display.
- [ ] Add rollback to a previously approved release.

### 5. Demonstrate the security story

- [ ] Show a valid release producing MATCH.
- [ ] Show CI updating preview but failing to write production.
- [ ] Deliberately point a test name or fixture to a different CID and show MISMATCH.
- [ ] Roll back and show the approved release matches again.
- [ ] Publish a live demo, open-source code, contract addresses, and a short integration explanation.

## Hackathon acceptance

The demo must use actual ENSv2 registry/resolver permissions and live reads. A hard-coded CID or a UI-only permission simulation does not satisfy this plan. The code and live demo must be accessible to judges at submission. ENSv2 must control the live publication decision, not just appear as a display label.

The strongest three-minute demo is: build a candidate, update preview, reject a CI production write, promote with the owner, verify MATCH, introduce a changed pointer, verify MISMATCH, and roll back.

## Open decisions for the build chat

1. Which ENS parent name and owner Safe will the team use?
2. What exact static demo site and build command will be connected first?
3. Which Sepolia ENSv2 deployment and ABI version are confirmed by ENS?
4. Does the sponsor recommend reserved registry entries for preview/production on that deployment?
5. Which RPC and IPFS retrieval route will the public verifier use?

These decisions should be recorded before deployment. They do not block local manifest generation or UI scaffolding.

## Future work after the MVP

- Multiple independent IPFS pins and a Swarm mirror for availability.
- Arkiv passport indexing tied to the approved release digest.
- Gateway latency measurement and resilient retrieval.
- Signed build attestations and reproducible-build comparison.
- Optional automated scanning and incident investigation views.

None of these changes the core approval rule: production is selected by an owner action and checked against the exact content CID.

## Official documentation

- [ENSv2 Permissioned Registry](https://docs.ens.domains/ensv2/permissioned-registry/)
- [ENSv2 Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver/)
- [ENSv2 Enhanced Access Control](https://docs.ens.domains/ensv2/enhanced-access-control/)
- [ENSv2 contract developer guide](https://docs.ens.domains/ensv2/tutorial-contract-developers/)
- [ENS deployments](https://docs.ens.domains/learn/deployments/)
- [ENSIP-7 contenthash](https://docs.ens.domains/ensip/7/)
