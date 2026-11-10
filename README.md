# ENSure

Deploy a website from a Git repo to an ENS name on ENSv2, with separate roles for publishing and approving, and a public check that a name still serves what its owner approved.

Design, protocol and status: [docs/ENSURE.md](./docs/ENSURE.md).

## How it works

```
push or Deploy → build the commit → hash files → pin site, then manifest to IPFS
→ write PREVIEW → owner reviews, signs, promotes → production records change in one transaction
→ anyone verifies: ENS → approval → manifest → every file hash
→ if something goes wrong: owner rolls back to an approved release, no rebuild
```

| | Quick name | Protected name |
| --- | --- | --- |
| Example | `wild-falcon-1932.walunj.eth` | `prod.ritwikm.eth` |
| Deploys go | Straight live | To `preview.<name>`; the owner promotes |
| Verify says | UNPROTECTED, never green | MATCH, MISMATCH or UNAVAILABLE |
| Networks | Sepolia only | Sepolia, Mainnet |

## Roles

| Wallet | Holds | Can | Cannot |
| --- | --- | --- | --- |
| Owner | The name's ERC-1155 tokens, all resolver roles | Promote, roll back, grant or revoke the publisher | Nothing here is outside its control |
| Publisher | Preview contenthash and `ensure.build` only. Its key lives on the server | Publish to preview | Write production, write other records, grant roles, change a resolver |
| Anyone | Nothing | Read and verify | Everything else |

Each role is an ENSv2 Enhanced Access Control bitmap on two separate Permissioned Resolvers. The **Who can change what** panel on `/verify` and `/promote` simulates each write from each wallet against the live contracts, shows which wallet you are connected as, and flags the owner and publisher being the same address.

## Run it (Sepolia)

Needs Node 24, Postgres, and Sepolia ETH in the owner and publisher wallets.

```bash
corepack pnpm install
createdb ensure
cp .env.example .env            # fill in, see below
cp web/.env.example web/.env.local
corepack pnpm setup-ens platform <platform>.eth    # once. Prints PLATFORM_* values for .env
corepack pnpm setup-ens project  <name>.eth        # once per protected project
corepack pnpm api                                  # http://localhost:3001
corepack pnpm web                                  # http://localhost:5183
```

| `.env` | Value |
| --- | --- |
| `DATABASE_URL` | `postgres://<user>@localhost:5432/ensure` |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `SEPOLIA_RPC_URL` | Any Sepolia RPC |
| `PUBLISHER_PRIVATE_KEY` | A funded wallet that is **not** the owner. It gets preview rights only |
| `PINATA_JWT` | Pinata key with pinning access |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | GitHub OAuth App, callback `http://localhost:3001/auth/github/callback` |
| `PLATFORM_NAME`, `PLATFORM_REGISTRY`, `PLATFORM_RESOLVER` | Printed by `setup-ens platform` |
| `BUILD_SANDBOX` | `local` or `docker`, see Security |
| `PUSH_POLL_SECONDS` | `20` auto-deploys new commits on public repos |
| `GITHUB_WEBHOOK_SECRET` | Required for webhooks. Without it every webhook is rejected |

Build sites with relative asset paths (Vite: `base: "./"`).

## Demo with two wallets

Wallet A is the owner. Wallet B is any other MetaMask account. The publisher is the server's key.

1. Connect B. The header says **No role**. `/promote` shows every production write reverting for it.
2. Switch to A. The header says **Owner**.
3. Push a change to the repo, or redeploy from `/deploy` with **My ENS name**. Preview updates, production does not.
4. `/promote`: review, sign, send. `/verify` shows **MATCH**.
5. Push another change. In **Demo drill**, write the new CID to production with no approval. `/verify` shows **MISMATCH** and names the failed check.
6. **Preview access**: revoke the publisher. Its card shows "Can't publish".
7. **Restore**: roll back to the approved release. **MATCH** again. `/releases` lists the unapproved write and the rollback.
8. Grant the publisher back before the next deploy.

Approvals expire after 48 hours. Promote again before a demo.

## Opening a site

Browsers cannot resolve `.eth` names on their own.

- **Mainnet:** `https://prod.<name>.eth.limo` serves the name, and the ENS name stays in the address bar.
- **Sepolia:** no working gateway exists. `/open/<name>` reads the contenthash from the chain and redirects to an IPFS gateway.

## Mainnet

Choose **Mainnet** in the header. Every transaction spends real ETH. ENSure uses ENSv2 only, so a name still on ENSv1 must be migrated in the [ENS app](https://app.ens.domains) first. Migration is one-way and ENSure does not do it.

1. `.env`: set `MAINNET_RPC_URL` and `MAINNET_PUBLISHER_PRIVATE_KEY` (a 32-byte key, never an address, never the owner's).
2. Fund the owner and the publisher. A full setup is 9 transactions, about 0.00005 ETH at 0.05 gwei.
3. `/setup`: enter the name, connect the owner wallet, approve each step.
4. `corepack pnpm sync-deployment mainnet <name.eth> <publisher address>`
5. Deploy to **My ENS name**, or `ENSURE_NETWORK=mainnet COMMIT_SHA=$(git rev-parse HEAD) corepack pnpm ci:publish-preview`.
6. Promote from `/promote`.

## Layout

| Path | Contents |
| --- | --- |
| `web/` | React app: `/`, `/deploy`, `/verify`, `/promote`, `/releases`, `/setup`, `/open` |
| `server/` | Hono API, deploy worker, builder, Telegram bot, Postgres |
| `core/` | Manifest, ENSv2 helpers, setup, pipeline, shared API types |
| `contracts/` | `ENSureReleaseController` (not deployed), `DeployRegistry`, `AccessController` |
| `cli/` | `pnpm ensure login`, `init`, `push`, `status`, `rollback` |
| `tools/ensure-sepolia/` | Verifier, approval tools, tests |
| `arkiv/` | Release-history module. Nothing in `web/` reads it |
| `deployments/` | `sepolia.json`, `mainnet.json` |

## Tests

```bash
corepack pnpm test         # 127 unit tests
corepack pnpm typecheck
(cd contracts && forge test)
ANVIL_BIN=$(which anvil) FORGE_BIN=$(which forge) corepack pnpm e2e
```

`e2e` runs the real ENSv2 contracts on a local Sepolia fork with real Postgres, git, builds, API and CLI. Pinata, gateways and GitHub are stubbed. `corepack pnpm sandbox` runs the same stack with no keys.

## Security

- `.env` is gitignored. Nothing sensitive may go in a `VITE_` variable: the browser receives all of them, including any RPC provider key. Restrict that key by domain.
- The owner's key belongs in the owner's wallet, never on the server or in CI.
- The publisher key is separate from the owner's. If it leaks, an attacker can change previews and quick names, not protected production.
- **`BUILD_SANDBOX=local` runs a repo's build script as an ordinary process on your machine.** It gets a clean environment but no isolation. Only deploy repos you trust. `docker` isolates builds, but has not been exercised here.
- The API listens on all network interfaces. Run it on a network you trust, or behind a firewall.
- Quick names are written by the server's key with no owner approval, which is why Verify marks them UNPROTECTED.

## Not done

- The v2 release controller is written, tested in Foundry, and not deployed. The owner promotes by writing the production resolver directly.
- Not run for real: Mainnet, MetaMask signing against a live project, Docker builds, GitHub App and webhooks, Google login, Telegram.
- Verify proves the release matches what the owner approved. It does not prove the code is safe.
- Rollback does not survive a compromised owner. Files live with one pin provider.
