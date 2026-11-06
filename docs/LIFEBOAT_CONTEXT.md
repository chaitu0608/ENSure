# ENS Lifeboat (repo: ENSure): Shared Context

**Updated:** 2026-11-06
**Canonical project:** ENS Lifeboat, built in the ENSure repository
**Current state:** Product and implementation planning are committed. The application and contract are not implemented or deployed yet.

This is the single starting point for every teammate and work session. Implementation details are in [BUILD_SPEC.md](./BUILD_SPEC.md).

---

## 1. Pitch

**One line:** ENS Lifeboat lets a project publish a verified website release through ENSv2 and gives its community a way to recover the site if the primary publishing path is compromised or unavailable.

**Visitor-facing line:** "Before you connect your wallet, check that this ENS website is still serving the build its owner approved."

**Defensible positioning:**
> GitHub tells the team what code changed, and hosting platforms manage deployments. ENS Lifeboat makes the ENS publishing authority and recovery path explicit, then lets users check whether a known project name points to the recorded release.

This is bigger than "deploy a site to IPFS". A project registers a release identity in ENSv2, ties each release to evidence, separates routine publishing from approval and recovery, and lets visitors verify the result.

No idea guarantees a top-10 result. Competitiveness comes from a working end-to-end demo, real ENSv2 permissions, and honesty about trust boundaries.

## 2. The problem

1. A Web3 frontend is as important as its contracts: users rely on it to understand and sign wallet transactions.
2. A frontend can change after users trust its URL (malicious replacement, bad deploy, compromised CI key).
3. If the site goes down, users may not know where the legitimate interface is.
4. Files on IPFS are not enough: the ENS pointer, publisher keys, and recovery procedure are all part of the attack surface.
5. Git records source revisions, but not which static files the public ENS name serves or whether an owner approved them.
6. A verifier cannot prove code is safe or an ENS name authentic by itself. Users need a **known project ENS name** to start from.

## 3. What the product does

1. Sets up a project publishing identity under ENSv2 (parent, preview, prod, recovery).
2. Builds a static site from an exact commit and pins it to IPFS through Pinata.
3. Creates a **Release Manifest / Release Passport** binding commit, build run, file hashes, site CID, and approval.
4. Publishes candidates to a **preview** ENS name using a preview-only key.
5. Lets the owner approve one candidate for **production** with a wallet or Safe transaction.
6. Lets a visitor verify production without a wallet: ENS → controller → manifest → files.
7. Provides a **recovery path**: restore a previously approved release when routine publishing is compromised or disabled.

A CI success creates a candidate. It never publishes to production.

## 4. Why ENSv2 is essential

ENS is the project's **publishing identity and permission system**, not a display label.

| ENSv2 feature | Product use |
| --- | --- |
| Hierarchical / Permissioned Registry | Project owns its namespace, with `preview` and `prod` as ERC-1155 name tokens held by the owner |
| Permissioned Resolver (separate instances) | Preview and production have separate writer boundaries |
| Enhanced Access Control | CI writes preview only; controller writes production; owner administers; roles are revocable |
| Contenthash (ENSIP-7) | Public name points at the approved IPFS site CID |
| Text records | `ensure.manifest`, `ensure.release` carry evidence pointers |
| Resolver multicall | Contenthash and evidence change atomically |
| Universal Resolver V2 | Verifier reads what the name actually serves |

Resolver roles apply to every name served by one resolver instance, so two resolvers are a required security boundary. Text roles can be key-scoped; contenthash permission is resolver-wide.

Deferred ENSv2 features: record linking, wildcard resolution, per-release subnames. The MVP uses explicit registry entries for a clear authorization path.

## 5. Roles and authority

| Actor | Can do | Cannot do |
| --- | --- | --- |
| **CI publisher** (preview-only key) | Write preview contenthash and preview manifest text | Write production, administer roles, link, or upgrade |
| **Owner Safe** | Promote, roll back, administer registry pointers, roles, and resolver upgrades; revoke CI | n/a (root of trust) |
| **ENSureReleaseController** | Write production contenthash plus `ensure.manifest` and `ensure.release` | Anything else; checks registry pointer first |
| **Recovery authority** (Lifeboat addition: separate Safe or multisig) | Restore a *previously approved* release with a recorded reason | Promote a new, never-approved release; administer roles |
| **Visitor** | Read and verify | n/a |

The owner Safe stays the root of trust. A change that bypasses the controller must appear as a mismatch in Verify. Recovery cannot introduce new content, only re-select stored, approved content.

## 6. Scope

### Agreed MVP

| Area | Decision |
| --- | --- |
| Build source | One team-controlled GitHub project, protected `main` |
| Build runner | GitHub Actions building the exact triggering SHA |
| Storage | Pinata pins site directory and manifest on IPFS |
| Naming | ENSv2 parent with `preview` and `prod` entries |
| Permissions | Separate Permissioned Resolvers for preview and production |
| Approval | Owner wallet or Safe calls `ENSureReleaseController` |
| Recovery | Separate recovery authority restores an approved release |
| Public check | Verify page reads ENSv2, controller, manifest, and files |
| First network | Sepolia, after confirming live V2 deployment and ABI |

### Optional stretch (only if core works)

- **Arkiv:** store Release Passports as queryable entities, with a user-facing release-history view or verifier lookup that **reads** Arkiv. Write-only logging does not count. If included, supply schema, queries, and judging docs.
- Gateway latency measurement and resilient retrieval.

### Cut unless the core works first

Swarm replication, IPNS, World ID, AI scanning, token gating, governance voting, multiple build systems, arbitrary public repo builds, automatic incident attribution.

The project is independent. Do not add names or links from historical inspiration to code, docs, issues, or demo copy.

## 7. End-to-end flows

### A. Project setup
1. Maintainer connects a wallet and chooses the ENSv2 parent name.
2. Create the child Permissioned Registry and register `preview` and `prod` as tokens, each with its own resolver.
3. Assign roles (Section 5). The UI shows exactly which account can do each action.

### B. Publish a release
~~~text
1. Developer pushes a commit to protected main.
2. CI checks out that exact SHA and builds static files.
3. CI hashes every file and creates a canonical manifest.
4. Pinata pins the site directory → site CID.
5. CI adds site CID to the manifest, pins it → manifest CID.
6. CI retrieves both artifacts, then updates preview ENS only.
7. Owner reviews the candidate and signs Promote.
8. Controller updates production contenthash and evidence records atomically.
9. Visitor verifies production ENS → controller → manifest → file hashes.
10. Owner or recovery authority can restore an earlier approved release.
~~~

### C. Verify a site
Visitor starts from the project's **known ENS name** (not an arbitrary name from a stranger), and the page reports which checks passed or failed and what the result does and does not establish. Detailed steps are in Section 11.

### D. Recover the site
1. The normal publishing path is lost, compromised, or disabled.
2. Owner revokes the CI role (or disables the path).
3. Recovery authority reviews release history and selects a previously approved release.
4. Controller restores all three production records in one multicall, with a reason recorded in the event.
5. Visitor verifies the restored site against its manifest.

## 8. Artifacts and records

**Two CIDs per build**
1. **Site CID:** static website directory.
2. **Manifest CID:** canonical JSON describing the release.

**Production ENS records**

| Record | Value |
| --- | --- |
| contenthash | ENSIP-7 encoded IPFS site CID |
| `ensure.manifest` (text) | Full manifest CID string |
| `ensure.release` (text) | Current approved release ID |

**Manifest (Release Passport content)**
~~~json
{
  "schemaVersion": 1,
  "repositoryId": "immutable GitHub repository ID",
  "repositoryUrl": "connected project URL",
  "commitSha": "full Git commit SHA",
  "workflowRunUrl": "build run URL",
  "siteCid": "complete IPFS directory CID",
  "buildTools": {"node": "version", "packageManager": "version"},
  "files": [
    {"path": "index.html", "size": 1234, "mime": "text/html", "sha256": "hex digest"}
  ]
}
~~~

Rules:
- Exact triggering SHA; sorted, normalized relative paths; SHA-256 per file.
- `manifestDigest` = keccak256 of canonical manifest bytes.
- Store full CID strings; a CID is not a bytes32.
- **One shared canonicalization package** used by both CI and Verify.
- Public records contain no secrets or private user data.
- The manifest ties an artifact to a commit and run. It does not prove a reproducible build.

## 9. Contract: ENSureReleaseController

Handles promotion, rollback, and recovery. Official ENSv2 registry and resolver contracts handle names and records.

**Immutable config:** ownerSafe, recoveryAuthority, projectNode, productionRegistry, production label `prod`, productionResolver, DNS-encoded full production name.

~~~solidity
promote(bytes contenthashBytes, string manifestCid, bytes32 manifestDigest, bytes32 commitDigest) returns (bytes32 releaseId); // owner only
rollback(bytes32 releaseId);                        // owner only
recover(bytes32 releaseId, string reason);          // recovery authority; approved releases only
currentReleaseId() view returns (bytes32);
getRelease(bytes32 releaseId) view returns (release data);
~~~

Behavior:
- Before every write, require `productionRegistry.getResolver("prod") == productionResolver`.
- Reject empty values; derive release ID from project and artifact digests.
- Store encoded contenthash, full manifest CID, digests, approver, approval time, and previous release ID.
- Write contenthash, `ensure.manifest`, and `ensure.release` in **one resolver multicall**; any failing setter reverts all.
- Emit events for promotion, rollback, and recovery (including reason).
- Rollback and recovery only select stored approved releases; they never rebuild.
- The contract does not build sites, fetch IPFS, assess safety, or issue names. File hashing happens off-chain in the verifier.

**Grokbot handoff** (use after inputs are fixed; review output against the pinned ABI):
> Implement ENSureReleaseController in Foundry using the current official ENSv2 registry and Permissioned Resolver interfaces for the selected Sepolia deployment. Owner is a configured Safe; a separate configured recovery authority may only restore previously approved releases with a reason. Before each write, require productionRegistry.getResolver("prod") to equal the configured productionResolver. Implement promote, rollback, and recover. Use one resolver multicall to set contenthash, ensure.manifest, and ensure.release. Store all data needed for rollback, expose release lookup and currentReleaseId, and emit events. Use DNS-encoded full-name setter arguments and ENSIP-7 contenthash bytes. Include unit tests for authorization, resolver mismatch, atomic updates, promotion, rollback, and recovery. Provide a deployment script reading non-secret config from environment variables. Do not request or print private keys.

After deploying, record the address, chain ID, tx hash, compiler version, and verified source location. Grant the controller only the production contenthash role and key-scoped text setter roles.

## 10. CI pipeline

1. Pull requests build without Pinata or wallet credentials (forked PRs never reach the publish job).
2. Push to protected `main` checks out the exact SHA; install from the committed lockfile; build one known output directory.
3. Reject empty output, symlinks, secret-like files, and paths outside the output root.
4. Build the sorted file list and hash each file.
5. Pin the site, add its CID to the manifest, compute `manifestDigest`, pin the manifest.
6. Retrieve the manifest and site entrypoint by CID before touching ENS.
7. Encode the contenthash; use the preview-only key to update preview contenthash and manifest text.
8. Confirm the commit is still the latest `main` commit before moving preview (so a slow old job cannot overwrite a newer preview).
9. Save a receipt: commit SHA, run URL, site CID, manifest CID, digest, preview tx hash.

Credentials: Pinata token and preview-only key live in a protected GitHub Environment for the publish job. The owner Safe and recovery keys never enter CI. Protect workflow-file changes.

## 11. Verify page and result states

No wallet needed. Steps:
1. Resolve the name via the ENSv2 Universal Resolver; capture the resolver address.
2. Read contenthash, `ensure.manifest`, `ensure.release`.
3. Compare resolver with the controller's configured resolver and the registry's `prod` entry.
4. Read `currentReleaseId` and release data from the controller.
5. Compare ENS records with the approved release.
6. Fetch the manifest by CID; canonicalize and compare with the onchain `manifestDigest`.
7. Decode contenthash and compare its site CID with the manifest.
8. Fetch site files and compare each SHA-256 with the manifest.
9. Show expected vs observed values, commit, build run, both CIDs, approval tx, previous release, and any recovery events with reasons.

| State | Meaning |
| --- | --- |
| **MATCH** | Every required comparison completed and agreed |
| **MISMATCH** | Data was available but something differed; identify exactly which comparison failed and show the last approved release |
| **UNAVAILABLE** | RPC, ENS, manifest, or IPFS failed before verification finished; never green |

Verify checks release consistency and the bytes it fetched. It does not declare code safe.

## 12. The memorable demo: live "site rescue" drill

Use a test ENS name and mark the scenario as a controlled demo. Never simulate an attack on a third party. All reads and transactions are live; hard-coded success values fail the goal.

1. Push a change; show commit, build run, and Pinata site and manifest CIDs.
2. CI updates **preview**; the same key's **production** write **reverts**.
3. Owner promotes; Verify shows **MATCH**.
4. Write a different contenthash directly to the production resolver, bypassing the controller; Verify shows **MISMATCH**.
5. Owner revokes the CI role (normal publishing path off).
6. Recovery authority restores the previous approved release with a reason.
7. Verify shows **MATCH** again; history shows promotion, mismatch window, and recovery.

Three-minute version: candidate → preview → blocked production write → promote → MATCH → tamper → MISMATCH → recover → MATCH.

## 13. Network uncertainty (deployment gate)

Prize wording says ENSv2 is live on mainnet. The [ENS deployments page](https://docs.ens.domains/learn/deployments/) lists mainnet V2 contracts but says mainnet registration and resolution continue through V1 until launch completes, and lists Sepolia as running V2. Confirm with ENS and verify onchain behavior. **Do not assume mainnet V2 addresses or ABIs.** Target Sepolia unless a live mainnet V2 path is proven. Pin ABI and addresses before writing integration code.

## 14. Build order and status

Built one component at a time, in product-flow order. Interfaces and done-conditions are in [BUILD_SPEC.md section 4](./BUILD_SPEC.md#4-build-plan).

| # | Component | Outcome | Status |
| --- | --- | --- | --- |
| 1 | Manifest | Build output → canonical manifest and digests | Not started |
| 2 | ENS library | Contenthash encoding, role constants, record reads | Not started |
| 3 | ENS setup | Parent, child registry, `preview` and `prod` tokens, two resolvers, roles; preview key writes preview and **reverts on prod** | Not started |
| 4 | Pin | Site and manifest pinned, fetched back by CID | Not started |
| 5 | Preview publish | CIDs written to preview ENS and read back | Not started |
| 6 | CI | Every push to `main` produces a preview candidate | Not started |
| 7 | Controller | Promote, rollback, recover; atomic multicall; deployed and source-verified; minimal roles | Not started |
| 8 | Verifier | Real MATCH / MISMATCH / UNAVAILABLE, in library and CLI | Not started |
| 9 | Verify page | Verifier in the browser | Not started |
| 10 | Owner page | Review, Promote, Rollback | Not started |
| 11 | Recover page | Restore an approved release with a reason | Not started |
| 12 | Demo and submit | Rescue drill runs live; public repo, README, limitations | Not started |
| Stretch | Arkiv passports with a real read feature (after 10) | | Not started |

Components 1 and 2 are pure code and can start now. Component 3 is the first live step; it gates the preview publish and the controller deploy.

### Layout
~~~text
ENSure/
├── contracts/           release controller, tests, deploy script
├── core/                manifest, ENS, verifier (shared)
├── scripts/             setup-ens, release, verify
├── site/                the static site being released
├── web/                 Verify, Owner, Recover
├── deployments/         addresses
├── docs/
├── .github/workflows/release.yml
~~~
Stack: Solidity + Foundry; TypeScript + React with wallet integration; no app database in v1.

## 15. Track fit

- **ENS Best Use (primary):** ENSv2 names, resolvers, and EAC are live and central; permissions shown in real transactions.
- **Arkiv from scratch (optional):** only if a user-facing feature reads Arkiv; include schema, queries, and docs.
- **CROPS (possible):** works if the product proves users can verify the shipped frontend, with open source, privacy/security disclosures, and a demo of the moment the property matters.

Different tracks have different requirements. Do not add Arkiv to merely mention it, and do not claim censorship resistance just because files are on IPFS.

## 16. What the product cannot claim

- It cannot stop a lookalike ENS name from being registered; users must start from the known name.
- A MATCH is not proof the source is safe.
- A manifest is only as trustworthy as the build and approval process behind it.
- It does not prove who authored a commit or the cause of an outage; commit, run, approver, and tx are investigation evidence only.
- IPFS retrieval requires files to stay pinned; one pin provider or gateway can be slow or down (shown as UNAVAILABLE).
- Recovery needs the recovery authority and earlier release files to remain available.
- Recovery protects against loss of the publishing path, not compromise of the owner Safe.
- Onchain records do not make every part of the service decentralized.

Preserve the distinction between a **verified artifact** and a **safe artifact** in all product copy.

## 17. Team rules

- This repository is the only project codebase.
- No production, owner, or recovery keys in CI, source, logs, or chat.
- Keep forked-PR builds separate from the trusted publish job.
- Pin ENSv2 ABI and addresses before contract integration.
- Record a release receipt: full CIDs, commit SHA, workflow URL, manifest digest, ENS tx hashes.
- Keep the MVP to one team-controlled static site and one production channel.
- Cut stretch items before the core demo is at risk.

## 18. Submission requirements

Functions on ENSv2 mainnet or Sepolia; ENSv2 is core to the flow; live demo; accessible open-source code with setup instructions, deployed contract addresses, and clear limitations. The repository is currently private and must become public before submission.

## 19. Decisions still needed

1. Final ENS parent name, owner Safe, and recovery authority account.
2. Static demo site, build command, and output folder.
3. Sponsor-confirmed network, deployment addresses, and ABI version.
4. Whether the sponsor objects to registered tokens for preview/prod on that deployment.
5. RPC provider and IPFS retrieval route for public verification.
6. Whether Arkiv is attempted (only after component 10).

These are configuration decisions and do not change the agreed flow.

## 20. 30-second judge pitch

> "ENS Lifeboat is a recovery and verification system for Web3 websites. A project publishes through ENSv2 with separate roles for preview publishing, production approval, and recovery. Each release is tied to its commit, build hash, and IPFS CID in a manifest. Visitors verify a site from the project's known ENS name, and maintainers can restore production to a previously approved release. In our demo, the CI key is blocked from production, the normal path is disabled, and the recovery authority restores a verified release. ENS controls publication and IPFS serves the files."

## 21. References

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
- [ETHGlobal prize requirements](https://ethglobal.com/events/mumbai/prizes)
