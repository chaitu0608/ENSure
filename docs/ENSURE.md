# ENSure

The single context doc: the idea, how it works, what exists, what's left. Addresses live in `deployments/sepolia.json` and `deployments/mainnet.json`. If this doc disagrees with the chain or the code, they win.

## 1. The idea

ENSure deploys a website from a repo to an ENS name in one click, then lets a project protect it: separate publishing roles, owner approval, public verification, and recovery if the publishing path is compromised.

Visitor line: *"Before you connect your wallet, check that this ENS website is still serving the build its owner approved."*

**The problem.** Users rely on a Web3 frontend to understand what they sign, and it can change after they trust its URL (bad deploy, stolen CI key, malicious replacement). Files on IPFS aren't enough: the ENS pointer, publisher keys and recovery procedure are all attack surface. Git records source, not which files a name serves or whether an owner approved them.

**Two layers, one repo:**
1. **Base:** connect a repo, click Deploy, watch the build, get the site on IPFS under an ENS name.
2. **Lifeboat:** separate preview and production writers, owner approval, public Verify, rollback.

**Start to end:**
~~~text
push or Deploy → build exact SHA with no secrets → hash files → pin site, then manifest
→ fetch both back → write PREVIEW only → owner reviews and signs → production records change atomically
→ visitor verifies: ENS → approval → manifest → file hashes
→ if something goes wrong: owner rolls back to an approved release, with no rebuild
~~~

ENS is the publishing identity and permission system here, not a label. A successful build creates a candidate. It never reaches a protected production name by itself.

### Two kinds of name

| | Quick name | Protected name |
| --- | --- | --- |
| Example | `amber-falcon-3f2a.<platform>.eth` | `prod.<project>.eth` |
| Owner | Platform | User's wallet |
| A deploy goes | Straight live | To `preview`, then the owner promotes |
| Writers | Server key | `preview`: server/CI key. `prod`: owner or controller only |
| Recovery | None | Rollback |
| Verify | UNPROTECTED, never green | MATCH / MISMATCH / UNAVAILABLE |

## 2. System

~~~text
  Website   CLI   Telegram bot   GitHub push
      └──────┴────────┬───────────┘
                      ▼
  server/ (one API, one worker, Postgres)
      │             │                │
      ▼             ▼                ▼
  Docker build → Pinata (IPFS)   Sepolia ENSv2: quick names, preview names, deploy log
  (no secrets)

  Owner wallet ──▶ prod resolver, directly (v1) or through the controller (v2)
  Visitor ──▶ Verify page or CLI ──▶ chain + public IPFS gateways (never the server)
~~~

**The rules that hold it together:**
- The server and CI can deploy, but hold no role on any `prod` resolver. A full server compromise can change previews and quick names, not protected production.
- Verify never calls the server, so a compromised server can't fake a result.
- Everything except contracts is TypeScript, so server, CLI and browser share one copy of the manifest and ENS code.

### Who can do what

| Actor | Lives in | Can | Can't |
| --- | --- | --- | --- |
| Server publisher / CI key | Server env, Actions secret | Write preview `contenthash` and `ensure.build`, write quick names, log deploys | Touch any `prod` resolver or administer roles |
| Pinata JWT | Server env, Actions secret | Upload | Anything on-chain |
| GitHub App key | Server env | Short-lived tokens for installed repos | Reach other repos |
| Owner | MetaMask | Sign and send promote/rollback, pause, administer roles | n/a, root of trust |
| Build container | Docker | Run the build | See any key |
| Visitor | Browser | Read and verify | n/a |

## 3. ENSv2 on Sepolia

ENSure runs on ENSv2 only, on either network, chosen in the header. Sepolia is chain ID `11155111` and the default. Mainnet is chain ID `1`: ENSv2 went live there on 2026-10-27, and names not yet migrated still resolve through their v1 records. Migration is one-way and happens in the ENS app, never in ENSure. Sepolia ENS source: `ensdomains/contracts-v2` at `07e55a056f5b6a9c90119f501bdd05714e67dddd`.

| ENSv2 feature | Use |
| --- | --- |
| Permissioned Registry (ERC-1155) | Parent, `preview` and `prod` are tokens held by the owner |
| Permissioned Resolver, two instances | Preview and production have separate writers. **Required:** contenthash permission is resolver-wide |
| Enhanced Access Control (EAC) | Role bitmaps per resource, revocable |
| Contenthash (ENSIP-7), text records | Site CID and evidence pointers |
| Resolver `multicall` | All records change atomically |

**Addresses not in the deployment file:** ETHRegistrar `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3`, MockUSDC `0x240b0316df57887dbbe58b586508b19e633a14aa`, MockDAI `0xf6fac8a58a0be13b9197f27c41b73162fe32572b`.

**Gotchas:**
- Token IDs change on role changes and re-registration. Store the labelhash and pass it as `anyId`.
- Regeneration mints to the owner, so a Safe owner must accept ERC-1155.
- Leave `ROLE_CAN_TRANSFER_ADMIN` out of `preview` and `prod`, so they can't move.
- `getResolver` returns zero after a label expires. Use long expiries.
- Names passed to setters are DNS-encoded bytes, not namehashes. Text resource is `keccak256(key)`.
- `findExactRegistry(name)` returns the name's own child registry; `findParentRegistry(name)` returns the parent's. Comparing the wrong one caused a false MISMATCH.
- Grant with `grantRootRoles` and `grantSetterRoles`. Generic `grantRoles` reverts on resolvers.
- Revoking a role *and* its admin is permanent.
- Compare CIDs as v1 bytes, never as strings. Contenthash is `0xe301` + CID bytes.

**Roles.** A role is a nybble in a `uint256`, its admin is `role << 128`, up to 15 accounts per role per resource.

| Registry role | Value | | Resolver role | Value |
| --- | --- | --- | --- | --- |
| `REGISTRAR` | `1<<0` | | `SET_TEXT` (root or key) | `1<<4` |
| `SET_PARENT` | `1<<8` | | `SET_CONTENTHASH` (root) | `1<<8` |
| `UNREGISTER` | `1<<12` | | `LINK` | `1<<28` |
| `RENEW` | `1<<16` | | `UPGRADE` | `1<<124` |
| `SET_SUBREGISTRY` | `1<<20` | | | |
| `SET_RESOLVER` | `1<<24` | | | |
| `CAN_TRANSFER_ADMIN` | `(1<<28)<<128` | | | |
| `UPGRADE` | `1<<124` | | | |

**Setup** (`core/src/setup.ts`, `pnpm setup-ens`): register the parent → deploy two resolvers and a child registry through `VerifiableFactory.deployProxy` → `setSubregistry` and `setParent` → register `preview` and `prod` → grant the publisher preview rights only.

**Isolation gate:** publisher can write preview. Publisher writing prod, writing other text keys, granting roles or calling `setResolver` must revert.

## 4. Records and artifacts

Each build has two CIDs: the **site** directory and its **build manifest**.

~~~json
{
  "schemaVersion": 1,
  "repositoryId": "immutable GitHub repo ID",
  "repositoryUrl": "project URL",
  "commitSha": "40 lowercase hex",
  "workflowRunUrl": "build run URL",
  "siteCid": "IPFS directory CID",
  "buildTools": { "node": "version", "packageManager": "version" },
  "files": [{ "path": "index.html", "size": 1234, "mime": "text/html", "sha256": "64 lowercase hex" }]
}
~~~

**Canonical form** (`core/src/manifest.ts`): keys sorted recursively, no whitespace, UTF-8, no trailing newline, non-negative safe integers only. Files sorted by path, no duplicates. Paths are relative with `/`, no `.`, `..` or backslash, NFC. MIME comes from a fixed table.
`manifestDigest = keccak256(bytes)`, `commitDigest = keccak256(UTF8(commitSha))`.

The manifest ties an artifact to a commit and run. It doesn't prove a reproducible build.

| Text key | Written by | Meaning |
| --- | --- | --- |
| `ensure.build` | CI on preview, owner on prod | Build manifest pointer, `ipfs://<CID>` |
| `ensure.manifest` | Owner or controller on prod | v1: approval pointer. v2: same as `ensure.build` |
| `ensure.release` | Owner or controller on prod | v1: approval pointer. v2: decimal sequence |
| `ensure.approval` | Owner or controller on prod | v1: inline signed JSON. v2: ABI proof as lowercase hex |
| `ensure.controller` | Owner on prod | Controller address, owner-only |

## 5. Publish pipeline

1. Start from the website, CLI, bot or a verified push webhook (`X-Hub-Signature-256` over the raw body, in constant time).
2. **Clone container:** fetch the exact SHA with a short-lived token, then exit.
3. **Build container:** no secrets, frozen install from the lockfile, `--cap-drop ALL`, `no-new-privileges`, memory, CPU, PID and time limits, non-root. Detect framework (Next, Vite, CRA, plain) and package manager. Never rewrite the user's project; if Next has no `output: "export"`, fail and say so.
4. Reject empty output, missing `index.html`, symlinks, paths outside the root, `.env*`, `*.pem`, `*.key`, `.git/`, `.npmrc` and key-like content.
5. Pin the site, build the manifest with its CID, pin the manifest.
6. Fetch both back by CID and compare bytes. Fail the job if they differ.
7. Stop if the commit is no longer the branch tip (superseded).
8. Quick name: register if new and write it. Protected: write **preview** only.
9. Read back, simulate a production write (it must revert), log the deploy, save the receipt.

**Pinata:**
- Site: `POST pinFileToIPFS`, one `file` part per file named `release/<path>`, `cidVersion: 1`.
- Manifest: `POST uploads.pinata.cloud/v3/files` with `network=public` (the default is private).
- Never use `pinJSONToIPFS` for the manifest: the digest needs exact bytes.
- Never set an expiry or unpin an approved release. Rollback needs the old files.

**Gateways:** order is Filebase (`ipfs.filebase.io`), then the others. `ipfs.io` and `dweb.link` now return 429 to these fetches, and Pinata's subdomain gateway refuses HTML (ERR_ID:00023). Gateway availability is never integrity: bytes are always compared.

**Other limits:** free Pinata plan is 60 requests a minute. SSE needs `fetch` streaming, because `EventSource` can't send auth headers. A small race remains between the branch-tip check and the ENS write.

## 6. Release approval

The schema comes from `releaseController` in `deployments/sepolia.json`, **never from the records**. `null` means v1. An address means v2 only, with no fallback.

### v1: direct owner (live today)

One owner multicall on the prod resolver writes contenthash plus text keys:
- `ensure.approval`: canonical JSON `{ core, signature }`, at most 8 KB.
- `ensure.release` and `ensure.manifest`: both `ipfs://<raw CID of that JSON>`.

`core` holds `schemaVersion, chainId, name, projectName, parentRegistry, registry, parentResource, resource, resolver, cid, commit, buildHash, release, approver, issuedAt, validUntil, previousManifest`.

Signature: EIP-712 domain `{name: "ENSure", version: "1", chainId}`, type `ReleaseApproval(bytes32 coreHash)`, `coreHash = keccak256(UTF8(canonical core))`, 48-hour expiry.

`buildHash`: for a raw CID, the file's SHA-256. For a directory, the CID's multihash digest (`signedBuildHash`).

Release 5 predates `ensure.build` on prod, so its manifest is pinned in `legacyBuildManifests`. It's still bound by the signed CID and commit, and every file hash is checked.

### v2: `ENSureReleaseController` (written, not deployed)

Non-upgradeable, hard-scoped to `ensure.eth`, `prod`, `preview` and Sepolia. Reads the owner from `findExactOwner` on every action. Promote and rollback need **both** the current owner as caller and a valid signature from that owner, so no relayers. EOA signatures only: 65 bytes, low `s`, no ERC-1271.

Domain: `{name: "ENSureReleaseController", version: "2", chainId, verifyingContract}`.

~~~text
Promote(bytes32 contenthashHash,string buildPointer,bytes32 manifestDigest,bytes32 commitDigest,uint64 sequence,bytes32 expectedCurrentReleaseId,uint256 nonce,uint256 deadline)
Rollback(bytes32 targetReleaseId,uint64 sequence,bytes32 expectedCurrentReleaseId,uint256 nonce,uint256 deadline)
~~~

- Each action needs `nonce == nonces[owner]`, `sequence == last + 1` and the exact expected current ID. The deadline is inclusive. Clients use 15 minutes.
- Promote re-reads preview and requires its contenthash and `ensure.build` to match what was signed, so a CI publish during review makes the approval stale.
- Release ID: `keccak256(abi.encode(projectNode, contenthashHash, keccak256(bytes(buildPointer)), manifestDigest, commitDigest))`. Promoting the same ID twice fails; use rollback.
- One multicall writes five records, reads them back, and reverts everything on any failure: contenthash, `ensure.release` (decimal sequence), `ensure.manifest` and `ensure.build` (same pointer), `ensure.approval` (proof).
- Proof: `abi.encode(uint8(2), uint8(action), domainSeparator(), struct, signature)`, action 1 is promote and 2 is rollback.
- Rollback restores a stored artifact with a fresh signature and a new forward sequence. It works while paused, and can reassert the current release to repair a direct write.
- Pause blocks promotions only. `cancelNonce` invalidates pending signatures.
- History: `getRelease(id)`, `transitionCount()`, `getTransition(i)`. Events: `ReleasePromoted`, `ReleaseRolledBack`.
- Legacy releases aren't imported. The first action is `baseline + 1`.

**Cutover, each step with explicit approval:** deploy (`contracts/script/DeployReleaseController.s.sol`, `CONTROLLER_BASELINE_SEQUENCE`) → on the prod resolver, owner grants the controller root `SET_CONTENTHASH` (`1<<8`) and setter roles for the four keys above, nothing else → owner writes `ensure.controller` → set `releaseController` → first promote. Prod reads MISMATCH between setting the address and that promote, by design.

The original design had a separate recovery authority with a `recover()` call. v2 replaced it with owner-signed rollback, so there is no recovery key.

## 7. Verify

Public, no wallet, reads only the chain and gateways. Web: `web/src/lib/verify.ts`. CLI: `pnpm verify:sepolia prod`. Shared logic: `tools/ensure-sepolia/scripts/{controller-v2,build-check}.ts`.

**Gate order:**
1. Hierarchy: root → `.eth` → project registry, active registrations, routing to the configured resolvers, separate prod and preview resolvers, all read at one block snapshot.
2. Authority: current owner, effective writer roles, and writers limited to the allowlist (owner, plus controller in v2; CI on preview only).
3. Approval: v1 commitment, schema, signature, expiry. v2 five records, proof decode, signature, controller state, deadline at the action, sequence.
4. Manifest: raw-CID bytes hash to the pointer, canonical, digest equal, `siteCid` equals contenthash, commit equal.
5. Every listed file: size and SHA-256.

| Result | Meaning |
| --- | --- |
| **MATCH** | Every required comparison completed and agreed |
| **MISMATCH** | Data was readable and something differed. Name the check |
| **UNAVAILABLE** | RPC, ENS, manifest or IPFS failed first. Never green |
| **UNPROTECTED** | Files match, but nobody approved them (quick names). Never green. Web only |

CLI status words: GREEN = MATCH, RED = MISMATCH, AMBER = UNAVAILABLE.

Copy rule: say "verified release", never "safe". Every result carries: *"This checks the release matches what the owner approved. It doesn't mean the code is safe."*

## 8. Repo

~~~text
contracts/  ENSureReleaseController, DeployRegistry, AccessController, EnsOwned (Solidity, Foundry)
core/       manifest, ENS helpers, setup, pipeline, API types (shared)
server/     Hono API, deploy worker, Docker builder, Telegram bot, IPNS (Postgres)
cli/        init, login, push, publish, status, rollback, env
web/        React app: / overview, /deploy, /verify, /promote, /releases (Vite, wagmi, viem, TanStack Query, Tailwind, shadcn)
arkiv/      release history module (Rabdi testnet)
site/       the demo site that gets deployed
tools/ensure-sepolia/  verifier, approval tools, owner-promote page, tests, evidence
scripts/    setup-ens, ci-publish-preview
deployments/sepolia.json  address book
.github/workflows/publish.yml  on push to main: build site/, pin, update preview
~~~

**API** (JSON; session cookie for web, bearer token for CLI; types in `core/src/api.ts`): `/auth/{github,google}` and callbacks, `/auth/{me,logout,cli-token,telegram-code}`, `/github/{repos,repos/:owner/:repo/branches,webhook}`, `/projects` (CRUD, `/:id/records`, `/:id/rollback`, `/:id/deploys`, `/:id/arkiv-events`), `/names/custom/{challenge,verify}`, `/deploys` and `/deploys/:id/events` (SSE), `/health`.

**Tables:** `users`, `sessions`, `projects`, `name_challenges`, `deploys`, `deploy_logs`. Chain and IPFS hold what was approved. Postgres only supports the app: losing it stops deploys, not Verify or Promote.

**Other base features, built:** GitHub and Google login, quick names and wallet-proved custom names, `DeployRegistry` (on-chain log gated by ENS ownership), config in ENS text records, Telegram bot (must be linked to a user; LLM output validated, regex fallback), IPNS for previews only and never `prod`, `AccessController` (public, token, allowlist, DAO, pause; UI gate only, since files stay public).

**Hosting:** `web/` on a static host, never on a site it checks. `server/` with Docker and Postgres on one dedicated machine. No `VITE_*` secrets, since Vite exposes them to every browser.

## 9. Arkiv (optional)

Queryable release history on Rabdi (chain `7794095`), never authority. Writes are best-effort and must never fail a deploy. Never infer current production from Arkiv.

Schema `ensure.release-events.v1`, one event per `CANDIDATE`, `PROMOTED`, `ROLLBACK`. Indexed: `projectNode, eventId, eventType, releaseId, commitSha`. Also: `fromReleaseId, manifestCid, manifestDigest, siteCid, commitDigest, sourceTx, sourceContract, sourceChain, sourceBlock, sourceLogIndex, recordedAt`. Event IDs are deterministic. Reads filter by schema and trusted writer. Strings cap at 128 bytes, pages at 100.

Validate source transactions independently: reject failed receipts, wrong chain or wrong contract, and never trust a browser-supplied hash. Writer key stays server-side.

State: smoke create and query passed live on Rabdi. Preview candidate hook and `/projects/:id/arkiv-events` exist. **`arkiv/src/controller.ts` still targets the old controller** (`ReleaseRecovered`, `recoveryAuthority`), so it needs updating for v2. Nothing in `web/` reads Arkiv yet.

## 10. Demo

Live reads and transactions, on a test name, marked as a controlled demo. Never simulate an attack on a third party, and no hard-coded success.

**Before:** two approved releases, a commit ready to push, separate browser profiles (Developer, Owner, Visitor with no wallet), funded accounts, a full recording.

1. Log in, pick a repo, Deploy: live logs, quick name goes live. Verify says UNPROTECTED.
2. Protected project in Verify: MATCH, with the role table.
3. `git push`: exact SHA built, **preview updated, production unchanged**.
4. Simulate a production write with the server key: **reverts**.
5. Owner reviews evidence and promotes: Verify shows MATCH on the new release.
6. Owner writes a different contenthash straight to the prod resolver: Verify shows **MISMATCH**, naming the check.
7. Owner revokes the CI/publisher role: role table updates.
8. Owner rolls back to the approved release: **MATCH** again, and the history shows the whole incident.
9. Dead RPC: **UNAVAILABLE**, never green.

**Two wallets.** Wallet A is the owner (`0xE8dc…3d20` for `ritwikm.eth`). Wallet B is any other MetaMask account with no role. The publisher is the server's key and never needs to be in MetaMask. The header shows the connected wallet's role (Owner, Publisher or No role), read from the chain, and the "Who can change what" panel shows one card per wallet, marking yours as You. If the owner and publisher were ever the same address, both roles appear on one card with a warning.

**Run order on Sepolia:**
1. Wallet B connected. Header says No role. `/promote`: its card and column show every production write reverting, and the owner actions refuse with "This wallet has no role here".
2. Switch MetaMask to wallet A. Header says Owner, and its card is You. Same table: owner Allowed, publisher Reverts.
3. Push a change to the test repo (or redeploy it from `/deploy`, My ENS name). Preview updates and production doesn't.
4. `/promote`: review the candidate, sign, send. `/verify` shows MATCH.
5. Push another change so preview differs from production, then Demo drill tab: write it to production without approval. `/verify` shows MISMATCH and names the check.
6. Preview access tab: revoke the publisher. The publisher card flips to "Can't publish".
7. Restore tab: roll back to the earlier approved release. MATCH again, and `/releases` shows the unapproved write and the rollback.
8. Grant the publisher back afterwards, or the next deploy fails.

**Where each step lives:** 1: `/deploy`, then `/verify` with the quick name. 2, 4, 7: the "Who can change what" table on `/verify` and `/promote`, where each cell is a simulated call and nothing is sent. 3: run the publish commands below with a changed `site/`, or push to `main` if the workflow's repo variables and keys are set. 5: `/promote`. 6: `/promote`, Demo drill tab. 8: `/promote`, Restore tab, then `/releases`. 9: DevTools, Network, Offline, then Verify (about 20 seconds).

**Publishing to preview by hand** (sends one transaction from the CI key). The CID comes from the files, so change something in `site/` first or the new preview equals the old one, and step 6 stays disabled:

~~~bash
corepack pnpm --filter @ensure/site build
COMMIT_SHA=$(git rev-parse HEAD) corepack pnpm ci:publish-preview
~~~

**Say:** *"The server deploying your site can't touch your production name. You just saw it revert."* / *"Revoking the publisher doesn't change production, because it never had access."*
**Don't say:** MATCH means safe; the site can't be taken down; this stops lookalike names; step 6 is an attack; the whole service is decentralized.

## 11. What it can't claim

- It can't stop lookalike names. Users must start from the known name.
- MATCH isn't proof the source is safe. File hashes don't cover code a page loads from elsewhere.
- A manifest is only as trustworthy as the build and approval behind it.
- Rollback doesn't survive an owner compromise. The owner can always bypass or revoke the controller.
- Rollback can reselect any approved release, including one later found bad.
- IPFS needs pinning, and there's one pin provider.
- Deploys go through our server. Verify doesn't.

## 12. Rules

- No commit, push, deploy or transaction without explicit owner approval. Commits are authored as `chaitu0608`.
- On-chain production writes: owner MetaMask only. Never an agent-held owner key.
- No owner, setup or publisher keys in the frontend. No owner or setup keys on a server or in CI. No keys, JWTs or `.env` values in chat, `VITE_*` or docs.
- Builds never see secrets. Forked PRs never reach a publish job.
- Never weaken a check or fake a result. UNAVAILABLE is never MATCH.
- Don't auto-send repair transactions.
- Keep it simple: no new features, redesigns or paid infra. Mainnet spends real ETH: it has its own publisher key, never falls back to the testnet key, and owner steps go through the owner's wallet.
- No unrelated third-party project names in code, config or docs.

## 13. Status (2026-11-07)

**Active project:** `ritwikm.eth`, owned by `0xE8dc14D61687738592CcC538c165C0b506F03d20`, set up with separate prod and preview resolvers. It has no release until its first promote, so Verify reads MISMATCH until then. Quick names use `walunj.eth`. Each approval lasts 48 hours, after which Verify correctly fails until a fresh promote.

**Previous project:** `ensure.eth`, kept under `projects` in `deployments/sepolia.json`. The v2 controller is still hard-scoped to `ensure.eth` and needs changing before it can serve `ritwikm.eth`, so the demo uses the direct owner path (v1). Publishing follows `deployments/sepolia.json`.

**Mainnet:** code is ready, but no project exists yet (`deployments/mainnet.json` is empty) and nothing has been sent. Flow: migrate the name in the ENS app → `/setup` from the owner's wallet → `pnpm sync-deployment mainnet <name.eth> <publisher>` → publish with `ENSURE_NETWORK=mainnet` or the Deploy page → promote. The site opens at `https://prod.<name.eth>.limo`. Quick names and the on-chain deploy log are Sepolia only. Tested on a mainnet fork against the real ENSv2 contracts: setup in the browser, including reusing the registry of a really migrated name; a server deploy to preview; promote, on-chain revert, unapproved write, revoke and rollback. Tested on real mainnet, read-only: name status, and `/open` landing on a real v2 name at eth.limo with the name in the URL. Not yet proven: a v2 *subname* on eth.limo (subnames of v1 names load there, and no v2 subname with a site could be found to test), and real MetaMask.

**Tested:** the section 10 drill, steps 2 to 9, plus an UNPROTECTED read of a quick name, passes through the real web UI on a local Sepolia fork, against the real ENSv2 contracts. It used a generated owner and CI key, an injected test wallet instead of MetaMask, and stubbed IPFS. `pnpm test` passes 123 with 1 live test gated behind `ENSURE_LIVE=1`. v2 web and CLI code passes against a simulated chain only, never the real contract. Server and CLI pass on a local Sepolia fork with Pinata and GitHub stubbed. The Deploy pages pass in Chrome on a fork of live Sepolia, with the real project keys and a real GitHub clone, and with Pinata stubbed.

**Not built:**
- Web: a separate recover page (`/promote` is the owner page and handles rollback).
- `ensure verify` CLI command (use `pnpm verify:sepolia`). `core/src/verify.ts`: the verifier lives in `tools/` and `web/`.
- PR CI: tests and secret scan. Only `publish.yml` exists.
- Codec-aware UnixFS check of the directory CID: files are bound through manifest hashes, so a lying gateway combined with a lying CI manifest could pass.
- Arkiv v2 update and history panel.

**Not run for real:** anything on mainnet, v2 on the real contract, MetaMask signing in the new owner flow, Docker builds, GitHub App and webhooks, Google login, Telegram's live connection, a full server deploy with real Pinata.

**Next, in order:**
1. Duplicate-build fix and fork tests for the controller. The diff isn't in this repo and must be supplied.
2. Deploy v2 and cut over (section 6), with approval.
3. Record the full drill (section 10) and say exactly what its evidence proves.
4. Then the unbuilt items above, cutting from the bottom if time runs out.

**Before submitting:** repo public, history scanned for secrets, README with addresses, verified source and limits, real ENSv2 tx hashes for the ENS track. Tracks: ENS Best Use (primary); Arkiv only with a user-facing read feature; CROPS only if it shows users verifying the shipped frontend.

**Open questions:** final platform and demo names; any ENS objection to registered tokens for `preview`/`prod`; whether `07e55a05…` is still Sepolia's deployment on submission day.
  