# Landing page implementation

Updated: 7 November 2026. Local implementation; not committed, pushed or deployed by this task.

## Delivered

- Custom ENSure release monogram and matching favicon: three manifest records share a spine to form an E, with a cut/folded corner. Replaces the generic shield in navigation; the wordmark is preserved.
- Product landing page in `web/`, with sticky navigation, mobile section menu, problem comparison, seven-stage release path, asymmetric feature composition, lifecycle reference, live release workspace, public verifier, expandable architecture, closing CTA and oversized ENSure footer.
- Exact midnight navy/cream tokens, preserved Georgia display font, Inter supporting text and JetBrains Mono identifiers. Shared working pages retain their layout and use the new palette.
- One Canvas scene in `HeroJourney.tsx`, using the mathematical helpers in `hero-motion.ts`. Deformed toroidal wireframes, orbital paths, cross-sections and particles are generated at runtime. Existing vertices interpolate into workflow rails driven by Framer Motion scroll progress; the diagram is not replaced by another scene.
- Text-safe masking from measured copy bounds; staged annotation visibility avoids crossing the fading headline. Horizontal desktop workflow becomes vertical on phones.
- A 30 fps rendering cap, DPR cap of 1.5, lower mobile geometry density, visibility/offscreen pause, and observer/listener/RAF cleanup. These are implementation limits, not a measured cross-device frame-rate guarantee.
- Pause/resume control. Reduced motion freezes the scene and provides a separate semantic static workflow without the sticky scroll choreography.
- The existing verifier is invoked by the landing form. Failed/unavailable checks expand their details, snapshot links are public, and the resolver comparison shows configured versus observed values when available. Unsupported projects are reported as unavailable without sending requests for them.
- Existing production/preview/activity workspace preserved as `ReleaseWorkspace.tsx`. It mounts near the viewport and refreshes explicitly rather than polling continuously, reducing competing public-RPC traffic.

## Product truth maintained

Safe release approval and the new v2 controller are labelled pending. The lifecycle reference is explicitly not a live deployment log. The manifest illustration describes structure, not a fabricated release. Existing v1 verification and owner actions remain the actual product flow. No contracts, approval protocols, backend routes, credentials or environment values were changed.

## Checks and observations

- Root typecheck passed; web typecheck and Vite production build passed.
- Existing Vitest suite: 10 files, 101 tests passed, excluding infrastructure-dependent server e2e.
- Native Chrome preview inspected on desktop and at an emulated 390 × 844 viewport. Checked hero framing, scroll morph, vertical workflow, feature environment toggle, mobile menu, pause/resume, verifier form and unsupported-project feedback.
- Reduced-motion emulation displayed the disabled “Reduced motion” control and semantic static workflow. Browser testing settings were returned to a desktop preview with normal motion.
- A real read-only verification returned **MISMATCH** for the configured project at ENSv2 hierarchy/ownership validation. This is surfaced directly. No successful verification or Safe transaction is claimed.
- Public RPC 429 responses occurred during repeated browser testing. The workspace no longer continuously polls; existing verifier fallback/error behavior is retained.
- Production build still reports a large main chunk and dependency annotation warnings. No graphics dependency was added; route/wallet bundle splitting remains follow-up work.
- No wallet connection/signature, production transaction, live controller deployment, Foundry suite or Docker/Postgres e2e was performed for this UI task.

## Remaining dependencies

Protocol alignment, Safe approval, live hierarchy/configuration resolution, controller activation and Arkiv reconciliation remain tracked in `EXECUTION_PLAN.md`. Visual implementation does not complete those integrations. The supplied screenshots and written brief informed the motion; no playable reference video was available.
