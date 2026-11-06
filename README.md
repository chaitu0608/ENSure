# ENSure

ENSure deploys a website from a repo to an ENS name in one click, then lets a project protect it: separate publishing roles, owner approval, public verification, and recovery.

It builds in a sandbox, pins to IPFS through Pinata, and publishes through ENSv2 on Sepolia.

**Status:** the deploy backend works on a local Sepolia fork. It hasn't run live yet. The website and the Lifeboat layer are next. Docs start at [docs/INDEX.md](./docs/INDEX.md).

## Run it

You need Node 24, Docker, a Pinata JWT, a Sepolia RPC URL and funded Sepolia accounts.

~~~bash
corepack pnpm install
docker compose up -d
docker build -f server/Dockerfile.builder -t ensure-builder server
cp .env.example .env     # fill it in
~~~

Create the quick-name parent, once. Register `<platform>.eth` in the Sepolia ENS app first, to the account in `SETUP_PRIVATE_KEY`.

~~~bash
corepack pnpm setup-ens platform <platform>.eth   # copy the printed PLATFORM_* values into .env
corepack pnpm server
~~~

Then, with the server running:

~~~bash
corepack pnpm ensure login
corepack pnpm ensure init --repo https://github.com/you/site
corepack pnpm ensure push
~~~

For a protected name, register it, run `corepack pnpm setup-ens project <name>.eth`, prove ownership through the API, and pass `--name <name>.eth` to `ensure init`. Deploys then go to `preview.<name>.eth`, and the server can't write `prod`.

**Without Docker,** set `BUILD_SANDBOX=local` for development. Builds then run on your machine with a clean environment but no isolation, so only use repos you trust. It's refused when `NODE_ENV=production`.

## Tests

~~~bash
corepack pnpm test                                # unit
corepack pnpm typecheck
(cd contracts && forge test)                      # contracts
ANVIL_BIN=$(which anvil) FORGE_BIN=$(which forge) corepack pnpm e2e
~~~

The e2e suite uses real ENSv2 contracts on a local Sepolia fork, real Postgres, git and builds, and the real API and CLI. Pinata, public gateways and GitHub's API are stubbed.

## Before it's live

These haven't been run for real yet:

- Pinata: the first real deploy shows whether files land at `<cid>/index.html`. If not, it fails safely at fetch-back.
- Docker builds. They ran only in `local` mode so far.
- A GitHub App, including webhooks and private repos.
- Google login, and the Telegram bot's live connection.
- Transactions on live Sepolia, and an owner Safe receiving the ERC-1155 name tokens.
