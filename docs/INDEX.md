# ENSure docs

| File | Use |
| --- | --- |
| [LIFEBOAT_CONTEXT.md](./LIFEBOAT_CONTEXT.md) | The product. Wins on scope |
| [BUILD_SPEC.md](./BUILD_SPEC.md) | How to build it. Wins on implementation |
| [REFERENCE_ARCHITECTURE.md](./REFERENCE_ARCHITECTURE.md) | Background: an existing deploy platform, and what not to copy |

**State:** nothing is deployed. `contracts/src/ENSureReleaseController.sol` compiles but has no tests. The rest of the source files are empty.

**First task:** components 1 and 2 (pure code), then [component 3](./BUILD_SPEC.md#7-component-3-ens-setup), the first live step. The build order is in [BUILD_SPEC.md section 4](./BUILD_SPEC.md#4-build-plan).
