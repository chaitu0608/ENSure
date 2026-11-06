# ENS Lifeboat build spec

How to build the product in [LIFEBOAT_CONTEXT.md](./LIFEBOAT_CONTEXT.md).

| Tag | Meaning |
| --- | --- |
| `[SOURCE]` | Read in `ensdomains/contracts-v2` at `07e55a056f5b6a9c90119f501bdd05714e67dddd`, the commit the ENS docs give for Sepolia |
| `[DOCS]` | Official ENS or Pinata docs, read 2026-11-06 |
| `[CHAIN]` | Checked on Sepolia, 2026-11-06 |
| `[DESIGN]` | A choice made here |
| `[TEST]` | Unconfirmed. Must be settled by a live run |

`contracts/src/ENSureReleaseController.sol` compiles with solc 0.8.24 but has no tests yet. TypeScript in this file is an unrun draft.

---

## 1. Decisions

**1. Name entries are ERC-1155 tokens.** `preview` and `prod` are registered to the owner, with role bitmaps. They aren't reserved entries, because a reserved entry has no owner, no token and no per-name roles, and `setResolver` checks token roles. `[SOURCE]`

**2. Pinata SDK v2 first, legacy endpoint as fallback.** See [component 4](#8-component-4-pin).

**3. Tamper in the demo with a direct contenthash write, not a pointer change.** The controller checks the pointer before every write, so `recover` reverts while the pointer is wrong, and only the owner can repair it.

**4. The site builds in a job with no secrets.** Dependency scripts can't steal keys that aren't there.

**5. Verify isn't hosted on the site it checks, and has a CLI.** A compromised site could show a fake green result.

**Limits to state openly:**
- Revoking CI doesn't protect production. CI never had production rights. The separate resolver is what contains a CI compromise.
- Recovery doesn't survive an owner compromise. The owner can revoke the controller or repoint `prod`.
- `recover` can re-select any approved release, including one later found to be bad.
- File hashes don't cover code a page loads from elsewhere. Verify warns about this.

---

## 2. ENSv2: tokens and roles

Network: Sepolia. Mainnet isn't an option yet: *"Until the launch completes, resolution and registrations on Mainnet continue through the ENSv1 contracts."* `[DOCS]`

### Standards used

| Standard | Where | What you do with it |
| --- | --- | --- |
| ERC-1155 | `PermissionedRegistry is ERC1155Singleton` `[SOURCE]` | Parent, `preview` and `prod` are tokens. Each ID has one owner |
| ENSv2 EAC | `EnhancedAccessControl` on registries and resolvers `[SOURCE]` | All permissions: bitmaps per resource |
| ERC-165 | Resolver and registry `supportsInterface` `[SOURCE]` | Sanity check in setup |
| UUPS proxy | Resolver and registry instances via VerifiableFactory `[DOCS]` | One proxy per resolver, upgrade gated by `ROLE_UPGRADE` |
| ENSIP-7 | Contenthash | `0xe301` + CID bytes |

### Token rules `[SOURCE]` `[DOCS]`

- **Token IDs change** on role changes and re-registration (`TokenRegenerated`). Store the **labelhash**, and pass it as `anyId`.
- Regeneration mints a new ID to the owner, so the owner must accept ERC-1155. A Safe's default fallback handler should. `[TEST]`
- Roles move with the token on transfer.
- Transfer requires `ROLE_CAN_TRANSFER_ADMIN`, or it reverts with `TransferDisallowed`. **Leave this bit out of `preview` and `prod`**, so they can't be moved. `[DESIGN]`
- `getResolver` returns `address(0)` once a label expires. Use long expiries.

### Roles `[SOURCE]`

A role is a nybble in a `uint256` bitmap. Its admin is `role << 128`. You need the admin role to grant or revoke the role. Up to 15 accounts per role per resource.

| Registry role | Value | Scope |
| --- | --- | --- |
| `ROLE_REGISTRAR` | `1 << 0` | root |
| `ROLE_SET_PARENT` | `1 << 8` | root |
| `ROLE_UNREGISTER` | `1 << 12` | root or name |
| `ROLE_RENEW` | `1 << 16` | root or name |
| `ROLE_SET_SUBREGISTRY` | `1 << 20` | root or name |
| `ROLE_SET_RESOLVER` | `1 << 24` | root or name |
| `ROLE_CAN_TRANSFER_ADMIN` | `(1 << 28) << 128` | name |
| `ROLE_UPGRADE` | `1 << 124` | root |

| Resolver role | Value | Scope |
| --- | --- | --- |
| `ROLE_SET_TEXT` | `1 << 4` | root or text key |
| `ROLE_SET_CONTENTHASH` | `1 << 8` | root only |
| `ROLE_LINK` | `1 << 28` | root |
| `ROLE_UPGRADE` | `1 << 124` | root |

Resolver text resource: `uint256(keccak256(bytes(key)))`. `[SOURCE]`

### Who holds what

| Holder | Contract | Scope | Roles |
| --- | --- | --- | --- |
| Owner | ETHRegistry | parent token | `SET_SUBREGISTRY`, `SET_RESOLVER`, their admins, `CAN_TRANSFER_ADMIN` (from registration) `[SOURCE]` |
| Owner | Child registry | root | `REGISTRAR`, `SET_PARENT`, `UPGRADE`, and each admin |
| Owner | Child registry | `preview`, `prod` tokens | `SET_RESOLVER`, `RENEW`, and each admin |
| Owner | Both resolvers | root | `SET_CONTENTHASH`, `SET_TEXT`, `LINK`, `UPGRADE`, and each admin |
| CI key | Preview resolver | root | `SET_CONTENTHASH` |
| CI key | Preview resolver | key `ensure.manifest` | `SET_TEXT` |
| Controller | Prod resolver | root | `SET_CONTENTHASH` |
| Controller | Prod resolver | keys `ensure.manifest`, `ensure.release` | `SET_TEXT` |
| Recovery | none | | Authority comes only from the controller's `msg.sender` check |
| Deployer | none | | Sends setup transactions, keeps nothing |

The owner keeps `SET_CONTENTHASH` on prod so it can repair records. That's also how the demo tamper works.

### Role calls `[SOURCE]`

~~~solidity
// Resolver. Generic grantRoles reverts with EACCannotGrantRoles.
grantRootRoles(uint256 roleBitmap, address account)
revokeRootRoles(uint256 roleBitmap, address account)
grantSetterRoles(bytes setter, address account)        // setter = encoded setText(name, key, "")
revokeRoles(uint256 resource, uint256 roleBitmap, address account)

// Reads
hasRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)  // also checks root
hasRootRoles(uint256 roleBitmap, address account) returns (bool)
roles(uint256 resource, address account) returns (uint256)
getAssigneeCount(uint256 resource, uint256 roleBitmap) returns (uint256 counts, uint256 mask)
event EACRolesChanged(resource, account, oldRoleBitmap, newRoleBitmap)
~~~

Don't revoke a role *and* its admin in the demo. That's permanent. `[DOCS]`

### Contract calls `[SOURCE]`

~~~solidity
// Registry
register(string label, address owner, IRegistry registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)
setSubregistry(uint256 anyId, IRegistry registry)
setResolver(uint256 anyId, address resolver)
setParent(IRegistry parent, string label)
renew(uint256 anyId, uint64 newExpiry)
getResolver(string label) view returns (address)

// Resolver. Names are DNS-encoded bytes, not namehashes.
setContenthash(bytes name, bytes hash)
setText(bytes name, string key, string value)
multicall(bytes[] calls) returns (bytes[])      // atomic; delegatecalls itself, so msg.sender stays the caller
initialize(Grant[] grants, bytes[] calls)       // Grant = (address account, uint256 roleBitmap), root scope

// Factory
deployProxy(address implementation, uint256 salt, bytes data) returns (address)
event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)

// Reads
UniversalResolver.resolve(bytes name, bytes data) view returns (bytes, address)
UniversalHelper.findParentRegistry(bytes name) view returns (IRegistry)

// ETHRegistrar
commit(bytes32 commitment)
makeCommitment(string label, address owner, bytes32 secret, IRegistry subregistry, address resolver, uint64 duration, bytes32 referrer)
register(string label, address owner, bytes32 secret, IRegistry subregistry, address resolver, uint64 duration, IERC20 paymentToken, bytes32 referrer)
getRegisterPrice(string label, uint64 duration, IERC20 paymentToken)
~~~

### Sepolia addresses

All returned contract code on 2026-11-06. `[CHAIN]`

| Contract | Address |
| --- | --- |
| Universal Resolver proxy | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |
| UniversalHelper | `0xd453e5bdb62cc3bea84341b1e306319c8ffd7dfe` |
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` |
| ETHRegistrar | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` |
| PermissionedResolverImpl | `0x115eb53f0c60696633855f90b138178fb40b2b2c` |
| UserRegistryImpl | `0x9bd8a88719068d09ecee662f36c0e3856708366a` |

Test payment tokens `[DOCS]`: MockUSDC `0x240b0316df57887dbbe58b586508b19e633a14aa`, MockDAI `0xf6fac8a58a0be13b9197f27c41b73162fe32572b`.

ABIs: `contracts/deployments/sepolia/<Name>.json` in `ensdomains/contracts-v2`. Keep only the fragments you call, in `core/src/ens.ts`.

---

## 3. Project structure

~~~text
ENSure/
├── contracts/
│   ├── foundry.toml
│   ├── src/ENSureReleaseController.sol
│   ├── test/ENSureReleaseController.t.sol
│   └── script/Deploy.s.sol
├── core/                 shared by CI, CLI and web
│   └── src/
│       ├── manifest.ts   canonical form, hashes
│       ├── ens.ts        ABIs, roles, contenthash, reads
│       └── verify.ts     the verifier
├── scripts/
│   ├── setup-ens.ts      one-time: names, resolvers, roles
│   ├── release.ts        CI: hash, pin, update preview, write receipt
│   └── verify.ts         CLI verifier
├── site/                 the static site being released
├── web/                  Verify, Owner, Recover
├── deployments/sepolia.json
├── docs/
├── .github/workflows/release.yml
├── .env.example
├── package.json
└── pnpm-workspace.yaml
~~~

Three TS modules, three scripts, one contract, two apps. No database, no server. There's nothing to add until something breaks without it.

**Setup:**
~~~bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
pnpm add -w -D typescript tsx vitest
pnpm --filter @ensure/core add viem multiformats
pnpm add -w pinata
pnpm create vite site --template vanilla-ts
pnpm create vite web --template react-ts
~~~

Check `https://docs.ens.domains/web/ensv2-readiness` for the viem version before installing. That page hasn't been read yet.

`site/vite.config.ts` must set `base: "./"`, since absolute asset paths break under an IPFS path and an external asset escapes verification.

**Accounts, all separate:** Owner (Safe), Recovery (separate Safe, or an EOA for the demo), CI key (new EOA, in GitHub only), Deployer (local EOA).

---

## 4. Build plan

One component at a time, in product-flow order: build output → pin → preview → promote → verify → recover. Finish and test each before starting the next. Detail for each is in the section named in its row.

| # | Component | What it does | Code | Needs | Done when |
| --- | --- | --- | --- | --- | --- |
| 1 | [Manifest](#5-component-1-manifest) | Build output → canonical manifest and digests | `core/src/manifest.ts` | none | Unit tests pass |
| 2 | [ENS library](#6-component-2-ens-library) | Encoding, role constants, ABIs, record reads | `core/src/ens.ts` | none | ENSIP-7 vector and role values match |
| 3 | [ENS setup](#7-component-3-ens-setup) | Create names, resolvers and roles on Sepolia | `scripts/setup-ens.ts` | 2 | Gate table passes |
| 4 | [Pin](#8-component-4-pin) | Validate, hash, pin site and manifest, fetch back | `scripts/release.ts` | 1 | Fixture fetched by CID, paths intact |
| 5 | [Preview publish](#9-component-5-preview-publish) | Write CIDs to preview ENS, read back, receipt | `scripts/release.ts` | 2, 3, 4 | Preview records match; CI key can't write prod |
| 6 | [CI](#10-component-6-ci) | Run 4 and 5 on every push to `main` | `.github/workflows/release.yml` | 5 | Push updates preview; fork PR gets no secrets |
| 7 | [Controller](#11-component-7-controller) | Promote, rollback, recover | `contracts/` | 3 | Tests and fork test pass; deployed; roles checked |
| 8 | [Verifier](#12-component-8-verifier) | The 13 checks → MATCH / MISMATCH / UNAVAILABLE | `core/src/verify.ts`, `scripts/verify.ts` | 1, 2, 7 | Every check row tested; CLI gives MATCH on the live name |
| 9 | [Verify page](#13-components-9-11-web) | Verifier in the browser | `web/` at `/` | 8 | Fresh browser shows all three states |
| 10 | [Owner page](#13-components-9-11-web) | Review candidate, Promote, Rollback | `web/` at `/owner` | 7 | Promote and rollback work from the UI |
| 11 | [Recover page](#13-components-9-11-web) | Restore an approved release with a reason | `web/` at `/recover` | 7 | Recover from the UI; Verify returns MATCH |
| 12 | [Demo and submit](#14-component-12-demo-and-submit) | Rescue drill, README, public repo | `docs/` | all | Drill runs live; checklist done |

**Order notes**
- 1 and 2 are pure code with no network. Start here.
- 3 is the first live step and the one most likely to change assumptions (tokens, roles, reads). Don't deploy 7 or run 5 until its gate passes.
- 4's live test settles the open Pinata questions.
- 7's unit tests need only mock resolvers, so they can run any time after 2. Only the fork test and deployment need 3.
- 8's first live run needs a release: pin a fixture (4), promote it from the owner account with a script (7), run the CLI. The Owner page doesn't have to exist yet.
- 9, 10 and 11 don't depend on each other.
- Arkiv, if attempted, comes after 10.

---

## 5. Component 1: Manifest

**Exports:** `hashFiles`, `buildManifest`, `canonicalize`, `manifestBytes`, `manifestDigest`, `commitDigest`, `parseManifest` (bytes → manifest, rejects non-canonical input).

Browser-safe: no `fs`.

**Canonical form:**
- Keys sorted by code unit, recursively. No whitespace. UTF-8, no trailing newline.
- Numbers: non-negative safe integers only.
- `files` sorted by `path`. No duplicates.
- Paths: relative, `/` separators. No `.`, `..`, leading `/` or backslash. NFC only.
- `sha256`: 64 lowercase hex. `commitSha`: 40 lowercase hex.
- MIME from a fixed extension table, never the OS.

~~~ts
export function canonicalize(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error("bad number");
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(",")}}`;
  }
  throw new Error("bad value");
}
export const manifestBytes = (m: Manifest) => new TextEncoder().encode(canonicalize(m));
export const manifestDigest = (b: Uint8Array) => keccak256(b);
export const commitDigest = (sha: string) => keccak256(toBytes(sha));
~~~

"Repeatable digest" means the same inputs give the same bytes. The manifest includes the run URL, so a re-run of CI gives a new digest. That's correct.

**Tests:** key order, repeat runs, each bad path, unicode, floats.

---

## 6. Component 2: ENS library

**Exports:** `dnsEncode`, `encodeContenthash`, `decodeContenthash`, role constants, ABI fragments, `loadDeployment()`, `readRecords(client, name)` → `{contenthash, manifestCid, releaseId, resolver}`.

~~~ts
export const dnsEncode = (name: string) => toHex(packetToBytes(normalize(name)));   // viem/ens

export const encodeContenthash = (cid: string): Hex =>
  concat(["0xe301", toHex(CID.parse(cid).toV1().bytes)]);

export function decodeContenthash(hex: Hex): CID {
  if (!hex.toLowerCase().startsWith("0xe301")) throw new Error("not ipfs");
  return CID.decode(hexToBytes(`0x${hex.slice(6)}`));
}
~~~

Compare CIDs as v1 bytes, never as strings.

**First unit test, ENSIP-7 vector** `[DOCS]`: `ipfs://QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4` ↔ `0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f`.

**Read records** through the Universal Resolver:
~~~ts
const data = encodeFunctionData({ abi: resolverAbi, functionName: "contenthash", args: [namehash(name)] });
const [result, resolver] = await client.readContract({
  address: UNIVERSAL_RESOLVER, abi: urAbi, functionName: "resolve", args: [dnsEncode(name), data],
});
~~~
Pass `multicall(bytes[])` as `data` to read all three records in one call. `[DOCS]`

---

## 7. Component 3: ENS setup

Goal: prove permission isolation live. Write it as `scripts/setup-ens.ts`. Run it first with an EOA owner on a throwaway name, then with the Safe on the real one.

`lifeboat.eth` is a placeholder.

**1. Register the parent to the owner.** Through the Sepolia ENS app, or `commit` → wait `MIN_COMMITMENT_AGE` → `register`, with `owner` set to the owner. Read the age and price from the contract.

**2. Deploy two resolvers** with `deployProxy(PermissionedResolverImpl, salt, initialize(grants, []))`:
~~~text
salt   = keccak256(abi.encode(keccak256("OwnedResolver"), owner, version))   // version 0 preview, 1 prod
grants = [(owner, SET_CONTENTHASH | SET_TEXT | LINK | UPGRADE + each admin)]
~~~
The salt must differ, so use a different `version` for each.

**3. Deploy the child registry** with `deployProxy(UserRegistryImpl, salt, initialize(grants))`:
~~~text
salt   = keccak256("UserRegistry", namehash, version)                        // [DOCS]; check encoding against the docs example
grants = [(owner, REGISTRAR | SET_PARENT | UPGRADE + each admin)]
~~~

**4. Attach it** (owner):
~~~text
ETHRegistry.setSubregistry(uint256(labelhash("lifeboat")), child)
child.setParent(ETHRegistry, "lifeboat")
~~~

**5. Register the tokens** (owner):
~~~text
bitmap = SET_RESOLVER | SET_RESOLVER_ADMIN | RENEW | RENEW_ADMIN    // no CAN_TRANSFER_ADMIN
child.register("preview", owner, address(0), previewResolver, bitmap, expiry)
child.register("prod",    owner, address(0), prodResolver,    bitmap, expiry)
~~~

**6. Grant CI preview rights** (owner):
~~~text
previewResolver.grantRootRoles(ROLE_SET_CONTENTHASH, ci)
previewResolver.grantSetterRoles(encode setText(previewDns, "ensure.manifest", ""), ci)
~~~

**7. Gate.** All must hold, with tx hashes saved:

| Caller | Call | Expected |
| --- | --- | --- |
| CI | preview `multicall([setContenthash, setText("ensure.manifest")])` | Succeeds |
| Anyone | Read preview through the Universal Resolver | Returns the values, and the `address` returned is the preview resolver `[TEST]` |
| CI | `prodResolver.setContenthash` | Reverts `EACUnauthorizedAccountRoles` |
| CI | `previewResolver.setText("ensure.release")` | Reverts |
| CI | `previewResolver.grantRootRoles` | Reverts `EACCannotGrantRoles` |
| CI | `child.setResolver` | Reverts |
| Owner | `child.setResolver(labelhash("prod"), x)`, then restore | Succeeds, and works by labelhash after the token ID changes |
| Owner | `safeTransferFrom` on the `prod` token | Reverts |

Write all addresses and the deployment block to `deployments/sepolia.json`.

---

## 8. Component 4: Pin

**Does:** build output directory in; two CIDs and digests out. First half of `scripts/release.ts`.

1. Reject: empty output, no `index.html`, symlinks, paths outside the root, `.env*`, `*.pem`, `*.key`, `.git/`, `.npmrc`, content matching key patterns.
2. `hashFiles`, then pin the site → `siteCid`.
3. `buildManifest` with `siteCid`, then pin the manifest → `manifestCid`.
4. Fetch the manifest and `index.html` by CID and compare bytes. Retry with backoff. Fail the job if still different.

**Output:** `{siteCid, manifestCid, manifestDigest, commitDigest, contenthash}`.

Use the current SDK: `pinata` (v2), which uses the v3 API. `pinata-web3` is the old package. `[DOCS]` Don't use `@pinata/sdk`.

~~~ts
import { PinataSDK } from "pinata";
const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_JWT! });

// Site: one root CID
const files = paths.map(p => new File([readFileSync(join(dir, p))], p, { type: mime(p) }));
const site = await pinata.upload.public.fileArray(files).keyvalues({ commit: sha, kind: "site" });

// Manifest: upload as a file so the bytes are exactly yours
const bytes = manifestBytes(manifest);
const m = await pinata.upload.public
  .file(new File([bytes], "manifest.json", { type: "application/json" }))
  .keyvalues({ commit: sha, kind: "manifest" });
~~~

**Live test, run first.** The docs don't settle these for `fileArray`: `[TEST]`
1. Does the returned `cid` identify the folder root?
2. Are nested paths kept, given that Node's `File` has no `webkitRelativePath`?
3. Are files at `<cid>/index.html`, or under a wrapper folder?
4. Do `.keyvalues()` chain on `fileArray`?

Upload a three-file fixture with one nested file, then fetch each path by CID.

**Fallback, if the test fails:** `POST https://api.pinata.cloud/pinning/pinFileToIPFS`. The docs still direct folder uploads here: *"At this time folder uploads must go through /pinFileToIPFS."* `[DOCS]` Send one `file` part per file with a path filename such as `release/assets/app.js`, plus `pinataOptions: {"cidVersion":1}`. Read `IpfsHash` from the response. It has no deprecation notice.

**Rules** `[DOCS]`:

| Rule | Why |
| --- | --- |
| Always go through `upload.public` | The API defaults `network` to private, which isn't retrievable from public gateways |
| Don't use `.json()` or `pinJSONToIPFS` for the manifest | Neither promises byte-exactness, and the digest depends on it |
| Never set an expiry, never unpin an approved release | *"Once the expiration time is reached, the file will be automatically deleted"*, and recovery needs old files |
| Keep the default `cid_version` (`v1`) | `unixfs-v1-2025` isn't available through the SDK and adds nothing here |
| Scoped key: `org:files:write` | The docs give no scope for legacy endpoints, and legacy-scoped keys don't carry over. Test the fallback with this key `[TEST]` |

**Gateways** `[DOCS]`:
- Dedicated gateways serve only your own pins by default.
- *"HTML files can be uploaded on any plan, but can only be retrieved through a Dedicated Gateway with a Custom Domain."*

So read back and verify through public gateways: `https://ipfs.io`, `https://dweb.link`. Add a custom-domain Pinata gateway if you have one. Allow retries, since new content takes time to spread. CORS isn't documented, so test in a browser. `[TEST]`

**Not used:**

| Feature | Why not |
| --- | --- |
| CAR uploads | Paid plans only, result arrives by webhook |
| Presigned URLs | For browser uploads. CI holds its own key |
| Groups | Nothing queries them |
| x402 pinning | Pays per pin. Not needed |
| Private IPFS | Enterprise, and visitors must be able to fetch |

Free plan limit: 60 API requests per minute.

---

## 9. Component 5: Preview publish

**Does:** CIDs in; preview ENS updated and read back. Second half of `scripts/release.ts`.

1. `git ls-remote origin refs/heads/main`. If it isn't `$GITHUB_SHA`, exit as superseded.
2. Send preview `multicall([setContenthash, setText("ensure.manifest", cid)])` with the CI key.
3. Read back through the Universal Resolver. Fail on any difference.
4. Write `receipt.json`: commit, repo ID, run URL, both CIDs, manifest digest, commit digest, contenthash, tx hash.

A small race remains between steps 1 and 2. The CI concurrency group reduces it.

**Test locally** with a funded preview key, a fixture and `PINATA_JWT`, before any workflow exists. Also confirm the same key's production write reverts.

---

## 10. Component 6: CI

`.github/workflows/release.yml`. Pin actions to full commit SHAs.

~~~yaml
name: release
on:
  pull_request:          # never pull_request_target
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: publish-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:                 # no secrets
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
        with: { ref: "${{ github.sha }}", persist-credentials: false }
      - uses: pnpm/action-setup@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm --filter site build
      - uses: actions/upload-artifact@<sha>
        with: { name: site, path: site/dist, if-no-files-found: error }

  publish:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: build
    runs-on: ubuntu-latest
    environment: preview-publish
    steps:
      - uses: actions/checkout@<sha>
        with: { ref: "${{ github.sha }}", persist-credentials: false }
      - uses: pnpm/action-setup@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - uses: actions/download-artifact@<sha>
        with: { name: site, path: release }
      - run: pnpm tsx scripts/release.ts release
        env:
          PINATA_JWT: ${{ secrets.PINATA_JWT }}
          PREVIEW_PRIVATE_KEY: ${{ secrets.PREVIEW_PRIVATE_KEY }}
          SEPOLIA_RPC_URL: ${{ secrets.SEPOLIA_RPC_URL }}
      - uses: actions/upload-artifact@<sha>
        with: { name: receipt, path: receipt.json }
~~~

**Repo settings:** protect `main`, restrict the `preview-publish` environment to `main`, `CODEOWNERS` on `.github/` and `scripts/`.

**Test:** push to `main` and watch preview update. Open a PR from a fork and confirm no secrets reach any job.

---

## 11. Component 7: Controller

Code: [`contracts/src/ENSureReleaseController.sol`](../contracts/src/ENSureReleaseController.sol). Local interfaces match the ENS signatures, so the ENS repo isn't a dependency. A fork test proves they match.

- `rollback` and `recover` accept the current release, so re-asserting it repairs a direct write.
- `ensure.release` is lowercase `0x` hex. Verify compares it exactly.
- Promoting the same artifact twice reverts `ReleaseExists`. Use `rollback`.
- A contract can't read its own tx hash, so approval txs come from event logs. Page from the deployment block.
- `string` and `bytes` can't be `immutable`, so the label is a `constant` and the DNS name has no setter.

**Deploy:**
~~~bash
forge script script/Deploy.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --verify --interactive
~~~

**Then grant, from the owner:**
~~~text
prodResolver.grantRootRoles(ROLE_SET_CONTENTHASH, controller)
prodResolver.grantSetterRoles(encode setText(prodDns, "ensure.manifest", ""), controller)
prodResolver.grantSetterRoles(encode setText(prodDns, "ensure.release",  ""), controller)
~~~

**Then check:** `roles(ROOT_RESOURCE, controller)` equals exactly `ROLE_SET_CONTENTHASH`, and the controller holds nothing on either registry or the preview resolver.

**Tests:**

| Test | Assert |
| --- | --- |
| `promote`, `rollback` by anyone but owner | `NotOwner` |
| `recover` by anyone but recovery | `NotRecoveryAuthority` |
| Empty arguments, empty reason | `EmptyValue` |
| Promote | Three records, current ID, stored fields, event |
| Same artifact twice | `ReleaseExists` |
| Second promote | `previousReleaseId` correct |
| Unknown ID on rollback or recover | `UnknownRelease` |
| Pointer changed | All three functions revert `ResolverMismatch` |
| Mock resolver fails third setter | Full revert |
| Recover to current after a direct write | Records restored |
| Bad constructor config | `InvalidConfig` |
| **Sepolia fork** | Real resolver and roles. Works with roles, reverts without |

---

## 12. Component 8: Verifier

`core/src/verify.ts` takes `{name, config, fetchers}` and emits one result per check. Web and CLI share it.

| # | Check | Expected | On failure |
| --- | --- | --- | --- |
| 1 | Read contenthash and both text records | Returned | UNAVAILABLE |
| 2 | Resolver returned by `resolve` | `controller.productionResolver()` | MISMATCH |
| 3 | `productionRegistry.getResolver("prod")` | Same resolver | MISMATCH |
| 4 | `UniversalHelper.findParentRegistry(name)` | `controller.productionRegistry()` | MISMATCH |
| 5 | `currentReleaseId` | Non-zero, equals `ensure.release` | MISMATCH |
| 6 | `getRelease(id).contenthash` | ENS contenthash, byte-equal | MISMATCH |
| 7 | `getRelease(id).manifestCid` | `ensure.manifest` | MISMATCH |
| 8 | Fetch manifest by CID | Retrieved | UNAVAILABLE |
| 9 | keccak256 of raw bytes | `manifestDigest` | MISMATCH |
| 10 | Bytes re-canonicalize to themselves | Equal | MISMATCH |
| 11 | keccak256 of `commitSha` | `commitDigest` | MISMATCH |
| 12 | Contenthash CID | `manifest.siteCid`, as v1 bytes | MISMATCH |
| 13 | Each file by `siteCid` + path | SHA-256 and size equal | Differs: MISMATCH. Can't fetch: UNAVAILABLE |

**Result:**
~~~text
any MISMATCH          → MISMATCH (name each failure, show the last approved release)
else any unfinished   → UNAVAILABLE
else                  → MATCH
~~~

Show expected and observed values, commit, run, both CIDs, approval tx, previous release, recovery events and reasons.

**Warnings beside the result, not states:**
- HTML loads external `script` or stylesheet URLs: *"This page loads code these checks don't cover."*
- Writer count differs from `deployments/sepolia.json`, using `getAssigneeCount` on root `SET_CONTENTHASH`, `SET_TEXT`, `LINK`, `UPGRADE`, and on both text keys: *"The set of accounts able to write this name has changed."* Each role's count is the nybble at that role's position in `counts`. `[TEST]`

**Fetching:** try gateways in order, with timeouts. Hash the raw `arrayBuffer`. Encode each path segment. Limit to about 6 concurrent fetches. If one gateway returns wrong bytes and another returns correct ones, report that gateway and continue.

**CLI exit codes:** `0` MATCH, `1` MISMATCH, `2` UNAVAILABLE.

**Tests, with injected fetchers:** one per row, RPC down, one gateway down, all gateways down, one changed byte, extra whitespace in the manifest, reordered keys.

---

## 13. Components 9-11: Web

Static Vite and React with wagmi and viem. No backend. Config comes from `deployments/sepolia.json`. Use viem `fallback` across several RPCs, small batches, paged logs.

**Copy rule:** say "verified release", never "safe". Every result carries: *"This checks the release matches what the owner approved. It doesn't mean the code is safe."*

### Component 9: Verify page (`/`)

**Does:** runs the verifier in the browser. Shows the check list, the result, a release timeline and the live role table. No wallet. Host it separately from `site/`.

- Timeline: controller events plus `EACRolesChanged` from both resolvers.
- UNAVAILABLE demo: a marked test toggle that points at a dead RPC or gateway.

**Done when:** a fresh browser shows MATCH, then MISMATCH after a direct write, then UNAVAILABLE with the toggle.

### Component 10: Owner page (`/owner`)

**Does:** shows a candidate's evidence, then Promote, Rollback and revoke CI.

- Candidate: read the current preview records, fetch the manifest, compute digests in the browser.
- After Promote, re-read production and the controller. Show **Live** only when they agree.
- Safe owner: show calldata for Safe Transaction Builder, or connect via WalletConnect. Use a 1-of-2 Safe so one signer can execute live. Poll chain state, since a Safe executes later.

**Done when:** Promote and Rollback work on Sepolia from the UI, and Live appears only after read-back agrees.

### Component 11: Recover page (`/recover`)

**Does:** lists approved releases from controller events. The recovery authority picks one, enters a reason and calls `recover`. Other wallets see a disabled form.

**Done when:** `recover` from the UI emits an event with the reason, and Verify returns MATCH.

---

## 14. Component 12: Demo and submit

### Demo run

Prepare: two approved releases, funded accounts, a recording of a full run, and a banner reading "Controlled demo on a test name."

| # | Action | Who | Shows |
| --- | --- | --- | --- |
| 1 | Push a visible change | Dev | Commit, run, both CIDs |
| 2 | Preview updates | CI | Preview name, tx |
| 3 | Same key writes production | CI key | **Revert**, `EACUnauthorizedAccountRoles` |
| 4 | Promote | Owner | Three records in one tx |
| 5 | Verify, fresh browser, no wallet | Anyone | **MATCH** |
| 6 | Direct `setContenthash` on prod | Owner, as a test | Write bypassing the controller |
| 7 | Verify | Anyone | **MISMATCH** at check 6 |
| 8 | `revokeRootRoles(ROLE_SET_CONTENTHASH, ci)` and `revokeRoles(keccak256("ensure.manifest"), ROLE_SET_TEXT, ci)` on preview | Owner | Publishing path off, role table updates |
| 9 | `recover(previous, "drill: restoring last approved release")` | Recovery | Event with reason |
| 10 | Verify | Anyone | **MATCH**, timeline shows the incident |

Describe step 6 as a write that bypasses the controller, not as an attacker.

**UNAVAILABLE:** point Verify at a dead RPC or gateway with a marked test toggle. Don't fake results.

---

### Submit checklist

- [ ] Repo public, full history scanned for secrets.
- [ ] Live demo works in a fresh browser.
- [ ] README: setup, addresses, explorer links, verified source, ENS commit, limitations.
- [ ] Note for ENS: which ENSv2 features the flow uses, with real tx hashes.
- [ ] Check ETHGlobal's rules on prior work and reused code.

---

## 15. Done means

- [ ] CI writes preview. Its production write reverts on a real tx.
- [ ] `preview` and `prod` are ERC-1155 tokens the owner holds, and they can't be transferred.
- [ ] One Promote updates all three records in one tx.
- [ ] Rollback and recover restore records with no rebuild.
- [ ] Recovery can't add a release. Only `promote` stores one.
- [ ] Verify works with no wallet and no backend.
- [ ] Changed resolver, record, manifest or file each gives MISMATCH.
- [ ] Dead RPC or gateway gives UNAVAILABLE, never green.
- [ ] Site build job holds no secrets.
- [ ] No hard-coded success values.

---

## 16. Questions for the ENS team

1. Any objection to registered tokens for `preview` and `prod`, rather than reserved entries?
2. Which viem version is right for ENSv2 on Sepolia?
3. Is `07e55a05…` still the Sepolia deployment on submission day?
