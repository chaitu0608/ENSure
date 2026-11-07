# ENSure

ENSure deploys a website from a repo to an ENS name in one click, then lets a project protect it: separate publishing roles, owner approval, public verification, and recovery.

It builds in a sandbox, pins to IPFS through Pinata, and publishes through ENSv2 on Sepolia.

The idea, architecture, protocol and current status are all in [docs/ENSURE.md](./docs/ENSURE.md).

## Web app

~~~bash
corepack pnpm install
cp web/.env.example web/.env.local     # all values optional
corepack pnpm --filter @ensure/web dev  # port is set in web/vite.config.ts
~~~

Build with `corepack pnpm --filter @ensure/web build`; output goes to `web/dist/`. Addresses come from `deployments/sepolia.json`. Wallet actions go through MetaMask, and no secret ever belongs in a `VITE_` variable.

| Variable | Use |
| --- | --- |
| `VITE_SEPOLIA_RPC_URL` | Public RPC. Public fallbacks exist, but they rate-limit and slow Verify down |
| `VITE_PINATA_GATEWAY`, `VITE_IPFS_GATEWAYS` | Gateway overrides |
| `VITE_HISTORY_FROM_BLOCK` | Earlier start for release history. The default is the last recorded promotion |
| `VITE_APP_BUILD_CID` | This frontend's own CID, shown in the footer |

## Deploy server

Run the deploy flow on your own machine. You need Node 24, Postgres, and Sepolia ETH in the wallets below.

**1. Database and packages**

~~~bash
corepack pnpm install
createdb ensure          # or: docker compose up -d postgres
cp .env.example .env     # skip if you have one
~~~

**2. Fill in `.env`**

| Key | Value |
| --- | --- |
| `DATABASE_URL` | `postgres://<you>@localhost:5432/ensure`, or the Docker one in `.env.example` |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `SEPOLIA_RPC_URL` | Any Sepolia RPC |
| `PUBLISHER_PRIVATE_KEY` | Funded wallet the server sends from. To deploy to an existing protected name, use a wallet that already holds its preview role |
| `PINATA_JWT` | Pinata API key with pinning access |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | From a GitHub OAuth App with callback `http://localhost:3001/auth/github/callback` |
| `BUILD_SANDBOX` | `local` runs builds on your machine with a clean environment but no isolation, so only use repos you trust. `docker` needs `docker build -f server/Dockerfile.builder -t ensure-builder server` |
| `PUSH_POLL_SECONDS` | `20` deploys new commits on connected public repos. GitHub's webhook can't reach a laptop |

**3. Create the quick-name parent, once.** It registers the name if it's free, paying in free test USDC, which takes about two minutes. It signs with `SETUP_PRIVATE_KEY`, or `OWNER_PRIVATE_KEY` if that's unset.

~~~bash
corepack pnpm setup-ens platform <platform>.eth   # copy the printed PLATFORM_* values into .env
~~~

**4. Start it, in two terminals**

~~~bash
corepack pnpm api
corepack pnpm web
~~~

Open http://localhost:5183/deploy, log in, paste a public repo with an `index.html` or a build script, and press Deploy. A quick name goes live. Use **My ENS name** to deploy to `preview.<name>.eth`, signing with the wallet that owns the name. That needs a name set up with `corepack pnpm setup-ens project <name>.eth`, and the server can't write `prod`.

Sites load through path gateways, so build them with relative asset paths (for Vite, `base: "./"`).

**Without any keys,** `corepack pnpm sandbox` runs the whole flow on a local Sepolia fork, with fake Pinata and GitHub. It needs Foundry and Postgres, and prints what to do next.

**From the terminal:** `corepack pnpm ensure login`, `ensure init --repo <url>`, `ensure push`.

## Owner tools and verification

~~~bash
corepack pnpm verify:sepolia prod   # read-only, no wallet key
corepack pnpm owner:prepare         # read-only snapshot and simulation, then rebuilds the signing page
corepack pnpm owner:publish         # dry run; add --publish only after explicit approval
~~~

Promotion normally happens on the web app's `/promote` page.

## Tests

~~~bash
corepack pnpm test                                # unit
corepack pnpm typecheck
ENSURE_LIVE=1 corepack pnpm test                  # adds the read-only live Sepolia check
(cd contracts && forge test)                      # contracts
ANVIL_BIN=$(which anvil) FORGE_BIN=$(which forge) corepack pnpm e2e
~~~

The e2e suite uses real ENSv2 contracts on a local Sepolia fork, real Postgres, git and builds, and the real API and CLI. Pinata, public gateways and GitHub's API are stubbed.
