# ENSure product and architecture audit

Reviewed: 7 November 2026. Local repository: `chaitu0608/ENSure`, branch `shashank`, base commit `d3ed099`, including the current uncommitted frontend work.

## Finding

ENSure has substantial implementation behind the product: a deployment backend, preview-only CI publishing, ENSv2 integrations, public verification, and owner publishing controls. It is not yet a connected, end-to-end Safe-approved release product. The most important dependency is agreement on the release protocol, before presenting the controller flow as operational.

The React frontend uses legacy v1 EOA approvals and direct resolver writes. The new Solidity controller implements a different v2 protocol. The frontend and Arkiv controller readers still expect older controller methods and events. The checked-in deployment configuration has `releaseController: null`. Safe release approval and guardian recovery are not implemented by that v2 contract.

The redesign should preserve working services, distinguish legacy and v2 capabilities explicitly, and make verification evidence the center of the interface. A beautiful workflow illustration must describe the product architecture; it must not imply a visitor has completed a verified release.

## Review scope and evidence limits

Inspected the workspace structure, package/configuration files, README, architecture/build/demo/controller/Arkiv/frontend documents, React routes and data services, static demo, core manifest and pipeline helpers, API/auth/build/queue integrations, CLI commands, CI publishing, Solidity contracts, deployment configuration, and existing test inventory. Source behavior takes precedence over aspirational or stale documentation.

`EXECUTION_PLAN.md` was absent; the companion plan has now been created at the repository root. Several older documents say the frontend is unbuilt or describe Safe/recovery as complete. Those statements do not match the current implementation.

The provided screenshots and attached motion brief informed the visual recommendation. No playable motion video was available in the material accessible for this review; the motion assessment follows the written requirements, not a claimed video inspection.

No credentials were read, changed, or generated. No deployment, live chain write, OAuth flow, or new Rabdi smoke transaction was performed. Historical transaction receipts and progress notes are evidence of earlier runs, not a fresh assertion about current chain state. This is a product/code audit, not a formal security audit.

## 1. Existing technology stack

| Layer | Actual implementation |
| --- | --- |
| Workspace | Node 24, pnpm workspaces, TypeScript; `core`, `server`, `cli`, `arkiv`, `site`, `web` |
| Product interface | React 19, Vite 7, React Router 7, TanStack Query 5 |
| UI | Tailwind 3, Radix primitives and shadcn-style components, Lucide, Framer Motion 12 |
| Typography | Georgia/Times serif display stack; Inter Variable body; JetBrains Mono technical values |
| Wallet/chain | wagmi 2 with injected wallet connector; viem 2; Sepolia, chain ID 11155111 |
| API | Hono on Node, Zod, PostgreSQL with SQL migrations and queue; session cookies and CLI bearer tokens |
| Build/storage | Docker builder with resource restrictions, framework/lockfile detection, Pinata directory and manifest uploads, public IPFS gateways; optional Kubo/IPNS |
| Contracts | Solidity 0.8.24, Foundry; ENSv2 Permissioned Registry/Resolver integration through viem helpers |
| Additional clients | Commander CLI, grammY Telegram bot, GitHub OAuth/App/webhooks, Google OAuth |
| History index | Arkiv TypeScript SDK on Rabdi, separate from Sepolia authorization |
| Tests | Vitest for core/server/Sepolia tools; Foundry for contracts; separate infrastructure-dependent server e2e |

There are two different site packages. `web/` is the product interface. `site/public/` is the static example release, built and pinned by `.github/workflows/publish.yml`. Editing the latter does not redesign the React application.

## 2. Implemented features and their boundaries

| Area | Present in code | Boundary |
| --- | --- | --- |
| Build and deploy | Exact commit builds, repository/branch/subfolder selection, Docker isolation, queue, stage/log streaming, dry runs and receipts | Backend and CLI; not connected to a React deployment journey. Live integrations need a fresh rehearsal |
| GitHub publishing | Signed webhook processing and delivery deduplication; Actions builds `site/`, pins output, writes preview | CI does not publish protected production; CI currently has no explicit test/typecheck gate |
| ENS naming | Quick names, custom-name ownership challenges, separate preview/production resolver model, role checks and ENS text/contenthash writes | Quick names go live without owner approval; protected candidates stop at preview |
| Public verification | No wallet/API required; chain-ID and pinned-block reads, hierarchy/provenance/permissions checks, v1 approval checks, declared file size/hash verification, gateway fallback, block-hash recheck | Single configured project; no general project discovery; directory completeness and trustless gateway proof are not established by fetching declared files alone |
| Owner controls | Wallet/chain checks, candidate loading, v1 EIP-712 signing and resolver multicall promotion, preview publisher permissions, legacy rollback | EOA flow; not Safe threshold approval; v2 controller branches are incompatible |
| Release timeline | Resolver approval events and optional controller event reads | Uses old controller ABI, scans from a configured checkpoint, some historical events lack build pointers; not an Arkiv-backed view |
| v2 controller | Source and tests for owner-authorized promote/rollback, sequence/current-release/nonce/deadline guards, pause/unpause and nonce cancellation | No configured deployment; EOA signature recovery; no ERC-1271/Safe release signatures or separate guardian recovery |
| Arkiv | Validated schema, readonly writes, trusted-writer queries, expiry, candidate recording, controller transaction ingestion endpoint | Historical create/query smoke passed; controller adapter is incompatible with v2; no reconciliation or permanent user-facing query view |
| Optional tooling | CLI login/init/push/publish/status/rollback/env, Telegram deployment assistant, deploy log contract, access policy contract, IPNS | Presence in source is not a claim of fresh live validation. Access policy gates an interface, not public IPFS bytes |

The canonical workflow is the intended destination:

`commit → build → IPFS + manifest → preview → owner approval → production ENSv2 → public verification`

There are currently two build entrances: GitHub Actions and the backend Docker worker. They should converge on the same versioned candidate/evidence model, rather than being portrayed as a single already-integrated system.

## 3. Existing APIs and contract integrations

### HTTP API

| Group | Existing routes |
| --- | --- |
| Health/session | `GET /health`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/cli-token`, `POST /auth/telegram-code` |
| OAuth | `GET /auth/github`, `/auth/github/callback`, `/auth/google`, `/auth/google/callback` |
| GitHub | `GET /github/repos`, `GET /github/repos/:owner/:repo/branches`, `POST /github/webhook` |
| Name ownership | `POST /names/custom/challenge`, `POST /names/custom/verify` |
| Projects | `GET/POST /projects`, `GET/DELETE /projects/:id`, `GET /projects/:id/deploys` |
| Project actions | `POST /projects/:id/rollback`, `/projects/:id/records`, `/projects/:id/arkiv-events` |
| Deployments | `POST /deploys`, `GET /deploys/:id`, `GET /deploys/:id/events` (SSE) |

User/project routes enforce sessions and project ownership. Custom protected names cannot use the server's quick-name rollback or arbitrary ENS-record editing path. The current React product reads RPC and gateways directly rather than using these deployment APIs.

Sessions are stored as token hashes; stored GitHub tokens use AES-256-GCM. The custom-name challenge uses viem `verifyMessage`, including contract-account verification. This onboarding capability does not imply Safe support for EIP-712 release approvals.

### On-chain boundaries

| Integration | Purpose and current constraint |
| --- | --- |
| ENSv2 registry, helper, factory, resolvers | Name ownership, hierarchy, provenance, resource roles, contenthash and text records. Preserve separate production and preview resolver instances |
| Legacy v1 approval | Signed site CID, commit, `index.html` hash, release sequence and ENS context; direct resolver publication in the owner UI |
| ENSureReleaseController v2 | Different domain/types, release tuple, events and rollback arguments. Owner must submit; 65-byte EOA signature must recover to the owner. Hardcoded project/network scope |
| DeployRegistry | Optional deployment log; not the production authorization authority |
| AccessController | ENS-owner-managed interface access policies; cannot make IPFS content private |
| Arkiv | Secondary presentation index. ENS/controller source evidence remains authoritative when entries expire or indexing fails |

Concrete protocol mismatches: `web/src/lib/verify.ts` expects an older `getRelease` tuple; `web/src/lib/history.ts` and `PromotePage.tsx` expect old events/rollback; `arkiv/src/controller.ts` expects `ownerSafe()`, `recoveryAuthority()`, `ReleaseRecovered`, and old release fields absent from the new controller. Merely setting a controller address will not resolve these differences.

## 4. Existing frontend routes and recommended information architecture

| Route now | Purpose now | Recommended redesign |
| --- | --- | --- |
| `/` | Landing/overview and live name snapshots | Centered editorial hero, continuous workflow transition, compact real project status with explicit environment and freshness |
| `/verify` | Public verification inspector | Name entry → live checks → result/evidence; distinguish unsupported project, integrity failure and unavailable evidence |
| `/promote` | Owner publishing controls | Candidate/production comparison, authority and network status, approval/transaction progress; capability-gated actions |
| `/releases` | Resolver/controller history | Timeline with source, evidence and completeness; later optional Arkiv filtering |
| Other paths | Redirect to `/` | Define intentional not-found and OAuth destination behavior |

There is no implemented `/dashboard`, repository import page, build-log page or Safe approval inbox. OAuth currently redirects to `/dashboard`, which falls through to `/`. Proposed future project/deploy routes must be wired to existing APIs, not filled with invented data. Keep public verification accessible without authentication or a wallet.

## 5. Missing functionality and upstream dependencies

1. **Versioned release contract:** agree with the contract owner on v2 ABI, typed data, approval proof format, build-pointer/digest meaning and rollout. Extract browser-safe protocol definitions shared by scripts, UI and Arkiv; keep legacy v1 support explicit.
2. **Safe approval:** define how a Safe authorizes and executes a release, including threshold/pending/rejection states and contract-signature verification. Current EOA assumptions must change across contract, UI and verifier; connecting a Safe alone is insufficient.
3. **Controller setup:** reviewed deployment/roles, ENS pointer setup, preview-only publisher proofs, production readback and matching frontend configuration. Owner role bypass remains a stated root-of-trust property.
4. **Connected deployment experience:** login, repo selection, ownership proof, project creation, exact-SHA deploy and SSE logs using existing API types. Hosting needs API configuration, cookies/CORS and SPA deep-link fallback.
5. **Consistent verification evidence:** validate manifest schemas at trust boundaries, bind/fetch evidence according to its protocol version, define directory-CID/completeness guarantees, and expose limited/unsupported states honestly.
6. **Arkiv completion:** v2 adapter, read-only browser boundary, history query view, confirmations/reorg policy, replay and retention handling. `RECOVERED` exists in its schema but is not an available v2 controller action.
7. **Signature visual:** a single generative scene with scroll-linked workflow evolution is not implemented. Existing SVG rotation and floating UI objects do not meet this brief; `hero-motion.ts` is an unused preparatory helper only.

## 6. Risks, ordered by product impact

| Priority | Finding | Required response |
| --- | --- | --- |
| Blocker | v1 UI/old controller adapters versus v2 source; controller unconfigured | Freeze/version the protocol and test adapters before enabling v2 actions |
| Blocker for Safe claim | Contract and release verifier recover EOA signatures; no Safe proposal/execution lifecycle | Implement and test an agreed Safe path, or label the demo explicitly as EOA until ready |
| High | Build manifest parser checks canonical JSON but casts to `Manifest`; schema checks differ by consumer. v1 signs the entry-file hash; public verifier does not reconstruct the directory root or prove all gateway paths | Shared runtime validation and explicit evidence binding/completeness tests; do not claim extra-file detection or trustless retrieval yet |
| High | Earlier manual frontend notes recorded a production hierarchy/owner MISMATCH | Reproduce against a fresh read-only chain snapshot before demo; do not replace real failures with reassuring copy |
| High | Webhook secret falls back to an empty string and is not required at startup | Fail closed when webhook configuration is absent; cover this with a targeted test |
| High | Verified custom-name proofs remain reusable without a fresh owner read in `isVerified` | Recheck ownership when connecting/using a protected project, including transfers |
| Medium | Untrusted build code; resource isolation exists, but live Docker operation, cache separation, cleanup/egress and output limits need review | Rehearse on a dedicated worker; validate limits and avoid secret-bearing build environments |
| Medium | In-process publisher lock; process restarts fail running jobs | Keep demo worker topology explicit; distributed nonce/job recovery needed before scaling |
| Medium | Gateway serial retries, full-response buffering, no overall verification budget | Add bounded sizes, cancellation, timeout budget and accurate progress/error states |
| Medium | History checkpoint, old ABI, non-atomic Arkiv duplicate lookup, expiring entities, no reconciliation | Label completeness, update adapters, reconcile confirmed source events and deduplicate by source identity |
| Medium | Root test configuration omits web and standalone Arkiv tests; root typecheck omits the web project | Add explicit web/Arkiv checks and protocol integration tests to CI |
| Medium | Production web build main JS is about 1.06 MB / 346 KB gzip | Split routes and owner/wallet code before adding a large graphics dependency |
| Medium | Documents describe inconsistent stages of implementation | Maintain the execution plan as current evidence; revise demo claims after acceptance gates pass |

## 7. Recommended component architecture

Keep the existing React application, routing, Radix primitives and service functions. Refactor by responsibility while preserving behavior; do not rebuild the backend for visual work.

```text
AppShell / navigation / wallet status
├── Overview
│   ├── HeroWorkflowScene (one sticky canvas across both sections)
│   │   ├── HeroCopy + real route CTAs
│   │   ├── WorkflowAnnotations + semantic HTML explanation
│   │   └── MotionControls
│   └── ProjectStatus (actual chain state, source and freshness)
├── Verify: NameForm → VerificationProgress → Result → EvidenceDetails
├── Promote: AuthorityGate → CandidateComparison → Approval/TransactionState
└── Releases: Timeline → EventEvidence → Source/Completeness

services: versioned protocol | ENS reads | verifier | IPFS | API/SSE | Arkiv reads
hooks: query keys, abort/retry lifecycle, chain snapshot and wallet state
shared UI: Button, Input, Tabs, Accordion, Dialog, technical identifier/copy
```

Use a normalized candidate/evidence model with explicit protocol version, source, chain, commit, site CID, manifest pointer/digest, approval status and transaction state. Keep quick deploys, previews and approved production distinct. A failed or missing read is never a success state. Arkiv cannot authorize production. Keep server writer imports and private configuration out of browser entry points.

Large editorial headings establish hierarchy. Use a small number of composed work areas, separators and expandable evidence instead of cards around every datum. Keep identifiers monospace, selectable and copyable. Surface the next useful action at each stage; no decorative controls without behavior.

## 8. Recommended animation and art direction

Use **Canvas 2D with mathematically projected 3D geometry**, driven by the installed Framer Motion scroll values. It supports the requested fine paths, particles, depth and evolving geometry without introducing Three.js/R3F into an already large initial bundle. Upgrade the renderer only if profiling shows a concrete need; React should not rerender at frame rate.

Create one seeded particle/path topology and retain the same point identities across the transition. Blend toroidal/orbital positions into workflow connection paths using continuous eased scroll progress. Low-frequency phase changes alter radius, twist, depth and orbital eccentricity over time, so the structure evolves rather than merely rotating. Small pointer parallax is optional and disabled on touch/reduced-motion.

| Scroll within scene | Choreography |
| --- | --- |
| 0–20% | Wide, calm toroidal and orbital paths around the centered headline; small technical perimeter annotations |
| 20–55% | Structure contracts and moves below the hero's text-safe region; paths progressively flatten and reconnect; headline clears naturally |
| 55–85% | The same particle IDs align along four connected workflow stations; labels settle into GITHUB → IPFS → ENSv2 → VERIFIED |
| 85–100% | Workflow stays legible as its explanatory HTML is revealed; subtle flow continues along connections |

The workflow is an architectural explanation, not a simulated live approval. Secondary copy explains build/manifest, preview, owner approval and public verification; four visual labels must not erase those trust boundaries.

Use a sticky scene inside a responsive multi-section wrapper, not two canvases or a crossfade to an unrelated diagram. Scroll maps to geometry, position, scale, opacity and line connectivity; use smooth interpolation without snapping or locking native scrolling. Measure foreground text bounds and feather out strokes/particles behind them. The headline and buttons remain semantic HTML above the canvas, with no pointer interception.

The exact palette is `#07152E` background, `#0B1F3A` secondary, `#10294B` surface, `#263B59` borders, `#FFFFFF` primary text, `#C5CEDD` secondary text, `#F4E8C1` accent. Preserve `--font-display` Georgia. Replace current royal-blue tokens and hardcoded colors. Cream is reserved for CTAs, emphasis and selected evidence, not broad glowing effects. Fine lines and restrained surface depth replace the earlier floating-card/clay aesthetic under this latest brief.

Performance/accessibility gates: cap pixel ratio and point count; adapt mobile geometry; pause offscreen/hidden animation; clean up observers/listeners/RAF; use a stable seeded layout; provide a pause control; honor reduced motion with a static, fully legible workflow; retain the product if canvas fails. Target a 30 fps frame budget on representative mobile hardware and 60 fps where feasible, then verify by profiling rather than assuming performance. Test zoom, keyboard, screen readers, long IDs and narrow widths.

## Validation performed for this audit

- Vitest excluding infrastructure-dependent server e2e: **10 files, 101 tests passed**.
- Root `tsc --noEmit`: **passed**.
- Web `tsc -b web --pretty false`: **passed**.
- Web Vite production build: **passed**, with dependency annotation warnings and the main-chunk size warning above.
- No fresh Foundry, Docker/Postgres e2e, live ENS verification, Safe transaction, or Rabdi write was run. Those remain separate acceptance gates.

See [EXECUTION_PLAN.md](../EXECUTION_PLAN.md) for dependencies, phases and completion criteria.
