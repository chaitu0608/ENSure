# ENSure execution plan

Updated: 7 November 2026. Status: audit complete; landing-page visual phases implemented locally. Protocol, Safe and backend integration gates below remain incomplete. See [landing implementation and checks](docs/LANDING_IMPLEMENTATION.md).

Read [the product audit](docs/PRODUCT_AUDIT.md) first. Existing application edits are preserved. This plan does not authorize a main-branch push or live contract deployment.

## Product acceptance

A candidate built from an exact commit is pinned with canonical release evidence, published only to preview by CI, reviewed and approved through the supported owner flow, promoted through the matching ENSv2 protocol, and independently verified from chain/IPFS. Safe approval is a required final capability in the brief and cannot be claimed until implemented and exercised.

The interface uses the exact midnight-navy/cream palette, existing serif display font, readable evidence, and one continuous generative hero-to-workflow transition. Animation never changes or fabricates security state.

## Phase 0 — Establish one truthful baseline

Status: audit and local unit/type/build baseline complete; live baseline pending.

- Record supported project, chain, deployment addresses, release version and rights model without exposing keys.
- Resolve documentation conflicts; use this plan and the audit as the current implementation map.
- Reproduce the earlier reported production hierarchy/owner verification mismatch with a read-only snapshot. Separate configuration, deployment and verifier causes.
- Record known working preview/production evidence and unavailable services. Keep unavailable/mismatch states visible.
- Preserve the existing uncommitted work and the distinction between `web/` and the CI demo artifact `site/`.

Exit: a reproducible current-state receipt and a capability matrix agreed with the contract/integration owner. A historical GREEN receipt is not enough.

## Phase 1 — Resolve protocol compatibility and evidence contracts

Depends on: Phase 0; contract-team agreement.

- Specify v1 legacy versus v2 controller domains, typed data, storage tuples, events, proof records, digest semantics and rollback behavior.
- Place browser-safe, versioned ABI/types/validation in a shared module; migrate UI/script/Arkiv consumers deliberately.
- Keep v1 reads for historical releases; enable v2 writes only for matching, checked configuration. Reject unsupported versions clearly.
- Define runtime manifest validation and the actual byte/CID guarantees. Add tamper, missing/extra file, digest, gateway, signature/context and version-boundary tests appropriate to each guarantee.
- Verify publisher preview-only rights and absence of production/admin/link/upgrade permissions.

Exit: shared protocol vectors pass across controller, tools, web verifier and Arkiv adapter. No old ABI branch is accidentally enabled by adding an address.

## Phase 2 — Complete owner Safe and controller integration

Depends on: Phase 1; contract/Safe integration owner; owner-controlled deployment and role setup.

- Agree Safe contract-signature and execution semantics. Current EOA `ecrecover` checks and owner-caller requirements are not a Safe integration.
- Implement reviewed contract/verifier/UI changes needed for the chosen mechanism, with EOA and contract-owner tests.
- Add honest proposed, awaiting confirmations, executable, submitted, confirmed, rejected, expired and failed states as supported by that mechanism.
- Wire actual v2 promote/rollback arguments and expose pause/cancel actions only after implementation and tests.
- Deploy/configure through the owner-approved process, then validate ENS pointers, roles and readback. Do not invent guardian recovery; treat it as separately designed scope.

Exit: a real candidate can be Safe-approved and promoted, fresh public verification passes, CI production writes fail, and rollback selects an approved release. Record receipts and exact limitations. Until then, label any legacy EOA demonstration explicitly.

## Phase 3 — Connect the existing deployment backend

Depends on: Phase 1 data contracts; may proceed alongside Phase 2 without advertising Safe completion.

- Add a typed API client using `core/src/api.ts`, session handling and an intentional OAuth return route.
- Connect repository/branch selection, ownership challenge, project creation and deploy actions to existing endpoints.
- Add project/deploy views only where they serve real flows; stream SSE logs with cancellation and reconnect behavior.
- Surface exact SHA, stage, receipt, candidate status, gateway link and next owner action. Distinguish quick names from protected production.
- Add fail-closed webhook configuration and fresh ownership checks; review worker lifecycle, output limits and nonce coordination.

Exit: a user can start and inspect a real deployment from the UI; session expiry, build failure, stale/superseded commits and API outages are handled without fake success.

## Phase 4 — Establish the visual system and page composition

Depends on: Phase 0 audit. This visual phase can begin before live integration is complete, using real states and clearly isolated test fixtures.

- Replace royal/cobalt colors with the exact seven navy/cream tokens from the brief, including hardcoded page and chart colors.
- Preserve Georgia display typography, Inter body and JetBrains Mono identifiers. Define responsive type/spacing scales and contrast-safe focus/status treatments.
- Recompose overview, verifier, owner controls and history around primary tasks. Use whitespace, fine rules and expandable evidence rather than excessive cards.
- Center the hero headline: “Publish with proof. Keep control.” Keep the provided supporting text and route-backed Verify/Manage CTAs.
- Remove floating dashboard objects from the hero. Keep real status separate from generative art.

Exit: desktop/mobile still compositions approved against the brief; all current routes/actions remain usable; no overlap or unexplained decoration.

## Phase 5 — Implement the live generative scene

Depends on: Phase 4 foreground composition and safe-zone measurements.

- Build one Canvas renderer with toroidal paths, evolving orbit parameters, connected particles, depth projection and subtle pointer influence.
- Keep geometry/time outside React render state; use seeded point identities and deterministic resize behavior.
- Measure and feather a central text/CTA exclusion zone. Render behind semantic HTML with no pointer interception.
- Add responsive density, DPR cap, offscreen/background pause, cleanup, reduced-motion fallback and a pause control.
- Evaluate the unused `hero-motion.ts` helper; retain only code used by the final renderer.

Exit: clearly continuous evolving geometry, readable foreground, no image/video substitution, no floating cards, no console/lifecycle errors.

## Phase 6 — Morph the same scene into the workflow on scroll

Depends on: Phase 5.

- Use one sticky scene over the hero/workflow wrapper and Framer Motion scroll progress.
- Contract and reorganize the same paths/particles from wide orbital geometry into connected workflow stations. Blend position, depth, scale, opacity and connectivity continuously.
- Reveal semantic labels GITHUB → IPFS → ENSv2 → VERIFIED; supporting copy retains build manifest, preview and owner approval steps.
- Preserve readable content in forward/reverse scroll and at every viewport size; avoid scroll hijacking and snapping.
- Provide a static equivalent for reduced motion, paused animation and renderer failure.

Exit: the workflow emerges from the hero structure with no hard swap, no text collisions and no implication of a fabricated live verification result.

## Phase 7 — Complete history and optional Arkiv presentation

Depends on: Phase 1; Phase 2 for recording real v2 production actions.

- Update controller receipt ingestion to the agreed ABI and verification rules; remove unsupported recovery claims.
- Add trusted-writer public queries, event filtering, source evidence, expiry and incomplete-history states.
- Add confirmation/reorg handling, replay/reconciliation and source-event deduplication; never authorize releases using Arkiv alone.
- Add mocked Arkiv unit tests and a clearly separate opt-in live smoke procedure. Keep writer code out of browser bundles.

Exit: actual source events can be mirrored, queried and inspected; outages and expired entities leave production verification independent.

## Phase 8 — Acceptance, performance and ETHGlobal rehearsal

Depends on: all capabilities selected for the final demo.

- Run root and web typechecks/builds, unit suites, relevant Foundry tests, and Docker/Postgres e2e separately. Add web/Arkiv checks to CI and gate preview publishing on appropriate checks.
- Validate clean/tampered releases, wrong signer/chain/context, expiry, stale nonce/sequence, owner transfer, disallowed CI writes, gateway failures, replay and rollback.
- Rehearse GitHub commit → exact build → pin → preview → Safe approval → production → independent verification with recorded public evidence.
- Inspect desktop/mobile, keyboard/zoom, reduced motion, animation pause, long technical values, empty/error states and deep links. Profile frame time and split the oversized JS bundle by route/owner functionality.
- Document setup, trust assumptions, limitations, manual recovery and demo receipts. Publish only claims demonstrated by the final build.

Exit: passing checks and a reproducible end-to-end rehearsal, with real transaction/evidence links and no secrets in logs or artifacts.

## Manual and external dependencies

- Contract/integration owner: v2 protocol agreement; Safe mechanism; deployment, grants and ENS pointers; independently reviewed authority boundaries.
- Infrastructure operator: OAuth callbacks/GitHub App and webhook configuration, Pinata, API/worker/database hosting, SPA fallback, RPC availability and test funds. Configure secrets locally/in secret stores; never paste them into docs or the browser.
- Arkiv operator: Rabdi access/funding and retention policy if the indexed history is in the demo. Existing credentials are reused; no new wallet is necessary for this plan.
- Design reference: a playable motion reference is needed only for precise video matching; the supplied text is sufficient to implement the described motion direction.

## Progress log

| Date | Work | Evidence |
| --- | --- | --- |
| 2026-11-07 | Repository/product audit and dependency-ordered plan | `docs/PRODUCT_AUDIT.md`; no new application implementation in the audit pass |
| 2026-11-07 | Current local baseline | 101 Vitest tests passed; root/web typechecks passed; Vite production build passed with chunk-size and dependency-annotation warnings |
| 2026-11-07 | Landing-page visual implementation, Canvas scene and continuous scroll morph | `docs/LANDING_IMPLEMENTATION.md`; desktop/390 × 844 browser inspection, pause/menu/environment controls, reduced motion and real verifier MISMATCH exercised. Safe/controller integration remains pending |

Update this log after each acceptance gate. Record tested behavior and outstanding dependencies, not visual completion percentages.
