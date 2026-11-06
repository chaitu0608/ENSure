# ENSure: ENSv2 Execution Plan

**Project:** ENSure  
**Goal:** An ENS name serves the exact static website release approved by its owner.  
**First network:** Sepolia, subject to a live ENSv2 smoke test.  
**MVP integrations:** GitHub Actions, Pinata/IPFS, ENSv2.  
**Later:** Arkiv and Swarm.

## 1. Product promise

A team publishes a static website from a Git commit. The resulting IPFS directory CID identifies one set of files. A preview ENS name displays the candidate. The owner approves a specific candidate with a wallet transaction, which updates the production ENS name and records the release. Visitors can independently check the ENS name, release record, manifest, and downloaded files.

ENSure checks release integrity and owner approval. It does not certify code safety, prove who wrote a commit, or guarantee that one pinning provider will always be reachable.

## 2. End-to-end flow

~~~text
Developer pushes commit
        ↓
GitHub Actions builds the exact commit SHA
        ↓
Generate sorted file manifest with SHA-256 per file
        ↓
Pin site directory to IPFS via Pinata → site CID
        ↓
Add site CID to manifest; pin manifest → manifest CID
        ↓
CI updates preview ENS contenthash only
        ↓
Owner reviews preview and signs Promote
        ↓
ENSureReleaseController updates production ENS records atomically
        ↓
Visitor runs Verify: ENS → controller → manifest → site files
~~~

The CI signing key has preview permission only. Production promotion requires the owner's wallet or Safe. Rollback selects a previously approved release without building again.

## 3. ENSv2 name structure

~~~text
<project>.eth
├── preview.<project>.eth
└── prod.<project>.eth
~~~

The owner controls the parent name. A child Permissioned Registry contains reserved preview and prod entries. Each entry routes to a separate Permissioned Resolver. These are routing labels; the MVP does not need transferable subname tokens.

The preview resolver grants the CI address contenthash permission and permission for the preview manifest text key. The production resolver grants the ENSureReleaseController contenthash permission and permission for two text keys. The owner Safe retains registry administration, resolver role administration, and resolver upgrade authority.

ENSv2 resolver roles apply across every name served by one resolver instance. This is why preview and production require separate resolver instances. Contenthash permission is root-scoped. Text permission can be scoped to a specific text key. CI receives no production registry or resolver role, role-admin role, link role, or upgrade role.

Use the current official ENSv2 contract interfaces and the deployed addresses for the target network. Resolver writes take the DNS-encoded full name. Resolve records through the ENSv2 Universal Resolver; do not assume direct ENSv1-style record getters.

## 4. Production ENS records

| Record | Value |
| --- | --- |
| contenthash | ENSIP-7 encoded IPFS URI for the site directory CID |
| text key ensure.manifest | Complete CID string for the release manifest |
| text key ensure.release | Current release ID |

The owner-approved controller changes all three records in one Permissioned Resolver multicall. A failed setter reverts the whole transaction.

The production registry's resolver pointer is also security-critical. The controller checks that the prod label still points to its configured resolver before each promotion or rollback. Verify makes the same comparison before showing a match.

## 5. Release manifest

The manifest is canonical JSON with these fields:

~~~json
{
  "schemaVersion": 1,
  "repositoryId": "immutable GitHub repository ID",
  "repositoryUrl": "the connected project URL",
  "commitSha": "full Git commit SHA",
  "workflowRunUrl": "build run URL",
  "siteCid": "complete IPFS directory CID",
  "buildTools": {"node": "version", "packageManager": "version"},
  "files": [
    {"path": "index.html", "size": 1234, "mime": "text/html", "sha256": "hex digest"}
  ]
}
~~~

Sort normalized relative file paths before serialization. CI and Verify must use the same canonicalization code. Hash each file with SHA-256. Calculate manifestDigest as keccak256 of the canonical manifest bytes. Store full CID strings; a CID is not generally a bytes32 value.

The manifest ties the artifact to a commit and build run. It does not prove a reproducible build.

## 6. Contract: ENSureReleaseController

One custom contract handles production promotion and rollback. Use official ENSv2 registry and Permissioned Resolver contracts for names and records.

Immutable configuration:

- ownerSafe
- projectNode
- productionRegistry
- production label prod
- productionResolver
- DNS-encoded full production name

Required interface:

~~~solidity
promote(
    bytes contenthashBytes,
    string manifestCid,
    bytes32 manifestDigest,
    bytes32 commitDigest
) returns (bytes32 releaseId);

rollback(bytes32 releaseId);
currentReleaseId() view returns (bytes32);
getRelease(bytes32 releaseId) view returns (release data);
~~~

Promotion requires the owner Safe, checks the current prod resolver pointer, rejects empty values, derives a release ID from the project and artifact digests, and calls the production resolver multicall. It stores the encoded contenthash, complete manifest CID, digests, approval time, and previous release ID. It emits a promotion event.

Rollback requires the owner Safe and an existing release. It rechecks the resolver pointer, restores the stored contenthash and text records in one multicall, updates currentReleaseId, and emits a rollback event.

The owner Safe is the root of trust because it administers registry and resolver permissions. Verify detects a production pointer or record that diverges from the controller's approved state.

### Contract handoff for Grokbot

> Implement ENSureReleaseController in Foundry using the current official ENSv2 registry and Permissioned Resolver interfaces for the selected Sepolia deployment. The owner is a configured Safe. Before each write, require productionRegistry.getResolver("prod") to equal the configured productionResolver. Implement owner-only promote and rollback. Use one resolver multicall to set production contenthash, ensure.manifest, and ensure.release. Store complete data needed for rollback, expose release lookup and currentReleaseId, and emit events. Use DNS-encoded full-name setter arguments and ENSIP-7 encoded contenthash bytes. Include meaningful unit tests for authorization, resolver mismatch, atomic updates, promotion, and rollback. Provide a deployment script that reads non-secret configuration from environment variables. Do not request or print private keys.

Review the generated contract against the pinned ENSv2 ABI before deployment. Deploy to Sepolia and record the contract address, chain ID, transaction hash, compiler version, and verified source location.

## 7. GitHub Actions pipeline

1. Pull requests build without Pinata or wallet credentials.
2. A push to protected main checks out the exact triggering commit SHA.
3. Install from the committed lockfile and build one known static output directory.
4. Reject empty output, symlinks, secret-like files, and paths outside the output root.
5. Build the deterministic file list and calculate per-file hashes.
6. Pin the site directory to Pinata and record its full CID.
7. Add that CID to the canonical manifest, calculate manifestDigest, and pin the manifest separately.
8. Retrieve the manifest and site entrypoint by CID before writing ENS.
9. Encode the site CID as ENSIP-7 contenthash bytes.
10. Use the preview-only key to update preview contenthash and preview manifest text.
11. Save a build receipt containing commit SHA, run URL, site CID, manifest CID, digest, and preview transaction.

Store the Pinata credential and preview-only key in a protected GitHub Environment for the publish job. Keep the owner Safe out of CI. Protect workflow-file changes. Check that the commit is still the latest protected-branch commit before moving the preview pointer so a slow older job cannot replace a newer preview.

The first version builds one connected team project. This keeps the build command and output path explicit.

## 8. Owner dashboard

Show the candidate commit, build run, preview name, site CID, manifest CID and digest, and file list. The owner reviews those values and signs Promote. After the transaction confirms, read production ENS records and controller state back; show Live only when they agree.

Show previously approved releases and let the owner call rollback on one. Rollback points production to stored content; it does not rebuild files.

## 9. Public Verify page

Anyone can verify the production ENS name without connecting a wallet:

1. Resolve the name through the ENSv2 Universal Resolver and capture the returned resolver address.
2. Read contenthash, ensure.manifest, and ensure.release through ENSv2 profile resolution.
3. Compare the resolver address with the controller's configured resolver and the registry's prod entry.
4. Read currentReleaseId and the release data from ENSureReleaseController.
5. Compare the ENS records with the approved release.
6. Fetch the manifest by CID; canonicalize it and compare its digest with manifestDigest onchain.
7. Decode the ENS contenthash and compare its site CID with the manifest.
8. Fetch the site files and compare each file's SHA-256 with the manifest.
9. Show expected and observed values, Git commit, build run, CIDs, approval transaction, and previous release.

The page has three result states:

- **MATCH:** every required comparison completed and agreed.
- **MISMATCH:** available data disagreed; identify the failing value.
- **UNAVAILABLE:** RPC, ENS resolution, manifest, or IPFS retrieval failed; verification could not finish.

Gateway or RPC failure never appears as MATCH. A normal HTTP gateway can serve bytes for file-level checking; verified IPFS retrieval is a later hardening step.

## 10. Build order

### Phase A — ENSv2 smoke test

- [ ] Confirm the live Sepolia ENSv2 deployment and pin matching ABI and addresses.
- [ ] Control a parent test name and attach a child registry.
- [ ] Create reserved preview and prod entries with separate resolvers.
- [ ] Give a test CI key preview permissions.
- [ ] Write preview and read it through Universal Resolver.
- [ ] Prove that key's production write reverts.

**Gate:** live name resolution and permission isolation work before building the dashboard.

### Phase B — Artifact format and Pinata

- [ ] Choose one static demo site and its build output.
- [ ] Implement manifest canonicalization and file hashing.
- [ ] Pin site and manifest and retrieve both by CID.
- [ ] Encode and decode the ENS contenthash value.

**Gate:** one commit produces a site CID, manifest CID, and repeatable manifest digest.

### Phase C — Contract and deployment

- [ ] Give Grokbot the contract handoff above.
- [ ] Review interfaces, access control, multicall, and rollback storage.
- [ ] Run focused Foundry tests for the authorization and record invariants.
- [ ] Deploy and verify source on Sepolia.
- [ ] Grant only required production resolver setter roles to the controller.

**Gate:** owner can promote and roll back; the preview key cannot update production.

### Phase D — CI and dashboard

- [ ] Add protected-branch GitHub Actions build and Pinata publish.
- [ ] Publish preview only from CI.
- [ ] Display candidate details and allow owner promotion.
- [ ] Read back production records after promotion.

**Gate:** a Git commit creates a verifiable candidate, while production changes only after owner approval.

### Phase E — Verify and demo

- [ ] Implement ENS, controller, manifest, and file comparisons.
- [ ] Display MATCH, MISMATCH, and UNAVAILABLE with evidence.
- [ ] Demonstrate normal release, altered pointer, and rollback.
- [ ] Publish deployment addresses, source, and demo instructions.

**Gate:** a fresh browser session can independently verify a release and see a deliberate mismatch.

## 11. Suggested project layout

~~~text
ENSure/
├── apps/web/                        owner dashboard and Verify page
├── contracts/src/                   release controller
├── contracts/test/                  focused contract tests
├── contracts/script/                Sepolia deployment
├── packages/manifest/               shared canonicalization and hashing
├── packages/ens-v2/                 ENS reads, writes, contenthash encoding
├── scripts/                         build, pin, preview, verify
├── .github/workflows/release.yml
├── README.md
└── EXECUTION_PLAN.md
~~~

Use Foundry for the contract and TypeScript for the app and pipeline. Keep the manifest logic shared between CI and Verify. The first version does not require an app database.

## 12. Completion checklist

- [ ] Exact commit SHA and workflow run are visible for each candidate.
- [ ] Site and manifest have separate full CIDs.
- [ ] CI can write preview and cannot write production.
- [ ] Owner transaction updates production contenthash and evidence records together.
- [ ] Controller stores release history and supports rollback.
- [ ] Verify reads real ENSv2, contract, manifest, and site data.
- [ ] Changed resolver, changed record, or changed file produces MISMATCH.
- [ ] Missing RPC or IPFS data produces UNAVAILABLE.
- [ ] Arkiv, Swarm, and IPNS are absent from the MVP's critical path.

## 13. Protocol documentation

- [ENSv2 overview](https://docs.ens.domains/ensv2/overview/)
- [Permissioned Registry](https://docs.ens.domains/ensv2/permissioned-registry/)
- [Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver/)
- [Enhanced Access Control](https://docs.ens.domains/ensv2/enhanced-access-control/)
- [Subnames](https://docs.ens.domains/ensv2/subnames/)
- [Contract developer guide](https://docs.ens.domains/ensv2/tutorial-contract-developers/)
- [App developer guide](https://docs.ens.domains/ensv2/tutorial-app-developers/)
- [Universal Resolver V2](https://docs.ens.domains/ensv2/universal-resolver-v2/)
- [Network deployments](https://docs.ens.domains/learn/deployments/)
- [ENSIP-7 contenthash](https://docs.ens.domains/ensip/7/)
- [IPFS content addressing](https://docs.ipfs.tech/concepts/content-addressing/)
