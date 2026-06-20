# Deployment Notes (read this before "clone & deploy")

The "clone, `yarn install`, `yarn build`, deploy" flow does **not** work out of the box
because of toolchain/network version drift since the project was written. This file
records the exact fixes and a migration checklist so it works today and can be moved to
the current network later.

## TL;DR

- The pinned SDK stack (`@midnight-ntwrk/compact-runtime@0.8.1`, `midnight-js@2.0.2`,
  `proof-server:4.0.0`) is the **testnet-02** stack.
- **testnet-02 was retired in Feb 2026** — its indexer/node endpoints are dead, so you
  cannot fund a wallet or deploy there anymore (`Timed out trying to connect`).
- Two ways forward: **(A) deploy to a local standalone chain today**, or
  **(B) migrate the whole stack to `preprod`** (heavy; see checklist).

---

## A. What was broken at build time (fixed in this branch)

### 1. Compact compiler version mismatch
The new Compact installer gives you the **latest** compiler (e.g. `0.31.0`), which emits
ESM `index.js` + a `checkRuntimeVersion('0.16.0')` call. The pinned
`compact-runtime@0.8.1` has **no** `checkRuntimeVersion` and the source imports
`index.cjs`. Symptoms: `Cannot find module ./managed/.../index.cjs`, then at runtime
`__compactRuntime.checkRuntimeVersion is not a function`.

**Fix:** pin the compiler to `0.24.0`, which emits CommonJS `index.cjs` targeting
`compact-runtime 0.8.1` (no `checkRuntimeVersion` call).

```bash
compact update 0.24.0   # install the matching compiler once
```
`packages/contracts/kitties/package.json` `compact` script pins it via `+0.24.0`.

### 2. Proof server is a local Docker container
`yarn kitties-cli-remote-ps` and the local configs all expect a proof server at
`127.0.0.1:6300`. You need **Docker Desktop running** (`open -a Docker`).

### 3. testcontainers startup timeout (standalone)
The proof server downloads ~tens of MB of proving parameters on every fresh container
start before it binds `:6300` (~90s+), which blew past testcontainers' default 60s wait.
**Fix:** `packages/cli/kitties/src/standalone.ts` now waits on listening ports with a
240s startup timeout.

---

## B. Deploy to a local standalone chain (works today)

No faucet / no live network needed — the local dev node pre-mints funds to a known
genesis seed, and `StandaloneConfig` auto-uses it.

```bash
compact update 0.24.0          # once
open -a Docker                 # Docker Desktop must be running
yarn install && yarn build
yarn --cwd packages/cli/kitties run standalone
# menu: choose "1. Deploy a new kitties contract"
# -> logs "Contract Address: 0200..."
```

> The resulting contract address lives only on your local chain (not on any public
> explorer). Fine for "deploy a contract and share the address" style checks; not
> visible to anyone verifying against a public network.

---

## C. Migrate to `preprod` (the current network) — checklist

Heavier: a major SDK bump with breaking API changes, plus a contract recompile. Also note
`preprod` was reset on 2026-03-21 and is "intermittently unavailable until a stable
compatibility matrix is published" — confirm it's up before spending time here.

Required versions (per Midnight "State of the Network", Feb 2026):

| Component | testnet-02 (now) | preprod (target) |
|---|---|---|
| `@midnight-ntwrk/midnight-js-*` | 2.0.2 | **3.0.0** |
| wallet | `@midnight-ntwrk/wallet@5.0.0` | **wallet-sdk 1.0.0** |
| Compact compiler | 0.24.0 | **0.28.0** |
| Proof server image | `4.0.0` | **`7.0.0`** |
| Ledger | v4 | **v7** |

Endpoints (`packages/api/kitties/src/common/config.ts`):

```
indexer    = https://indexer.preprod.midnight.network/api/v4/graphql
indexerWS  = wss://indexer.preprod.midnight.network/api/v4/graphql/ws
node       = https://rpc.preprod.midnight.network
proofServer= http://127.0.0.1:6300   (local proof-server:7.0.0)
```

Files to touch:
- `package.json` (root + `packages/*`) — bump all `@midnight-ntwrk/*` deps.
- `packages/contracts/kitties/package.json` — change the `+0.24.0` compiler pin to
  `+0.28.0` and recompile (`compact update 0.28.0`).
- `packages/api/kitties/src/common/config.ts` — preprod endpoints + indexer `api/v4`.
- `packages/cli/proof-server-testnet.yml` / `standalone.yml` — `proof-server:7.0.0`.
- API/CLI source — fix breaking changes from midnight-js 2.x → 3.x and wallet 5 →
  wallet-sdk 1.0.0.
- Fund via the preprod faucet: https://midnight.network/test-faucet

References:
- State of the Network (Feb 2026): https://midnight.network/blog/state-of-the-network-february-2026
- Preprod/Preview status: https://forum.midnight.network/t/preprod-preview-network-status/1094

---

## D. Preprod migration — DONE (2026-06-21, branch `feat/preprod-migration`)

The frontend has been migrated to the live **preprod** stack so it works with a
modern Lace (Midnight) wallet. `yarn build:app` is green and the app serves.

### Versions now used (authoritative preprod support matrix)
| Component | Version |
|---|---|
| Compact compiler (`compact compile +0.31.0`) | **0.31.0** |
| `@midnight-ntwrk/compact-runtime` | **0.16.0** |
| `@midnight-ntwrk/midnight-js-*` | **4.1.1** |
| `@midnight-ntwrk/dapp-connector-api` | **4.0.1** |
| `@midnight-ntwrk/ledger-v8` (replaces `ledger`/`zswap`) | **8.1.0** |
| Proof server image (`midnightntwrk/proof-server`, no "e") | **8.0.3** |
| Indexer API path | **/api/v4** |

### What changed (high level)
- Root + ui/contract `package.json` deps bumped; `ledger@4`/`zswap` → `ledger-v8`;
  ui's phantom `@midnight-ntwrk/kitties-cli` dep removed.
- Contract recompiled with 0.31.0 (emits **ESM `index.js`**, not `index.cjs`); the
  wrapper `src/index.ts`/`src/witnesses.ts` import `index.js` via `import * as`.
- NFT lib `Nft.compact` used the now-reserved word `from` as a param — patched to
  `fromOwner` (saved as `patches/midnight-contracts-nft-from-keyword.patch`). It is
  a **git dependency**, so after any reinstall re-apply the patch before
  recompiling (`git apply patches/midnight-contracts-nft-from-keyword.patch` from
  the package dir, or re-run the sed). The committed `src/managed/` already has the
  compiled output, so a normal build does NOT need a recompile.
- Contract package now exports `CompiledKittiesContract`
  (`CompiledContract.make("Kitties", Contract).pipe(withWitnesses, withCompiledFileAssets("./managed/kitties"))`)
  — this is what midnight-js 4.x `deployContract`/`findDeployedContract` need under
  the `compiledContract` option (the old `new Contract(witnesses)` is wrong for 4.x).
- Browser code rewritten for dapp-connector 4.0.1 + midnight-js 4.1.1: wallet
  discovery by `apiVersion` 4.x, `connect('preprod')`, `getShieldedAddresses()`,
  `getConfiguration()`, `balanceUnsealedTransaction` (hex round-trip) +
  `Transaction.deserialize('signature','proof','binding', …)` from `ledger-v8`,
  `submitTransaction` + `tx.identifiers()[0]`. NetworkId is now a plain string
  (`'preprod'`); `getLedgerNetworkId()`/`getZswapNetworkId()` removed.
- The CLI / node headless-wallet path (`packages/cli`, `packages/api/.../node`) was
  left on the OLD APIs and EXCLUDED from the web build (api tsconfig `exclude:
  src/node/**`, `./node-api` export removed, src/test excluded from contract
  typecheck). The frontend does not need them.

### How to run it (what you, the user, do)
1. **Docker Desktop running.** Start the proof server (already prepared):
   `docker compose -f packages/cli/proof-server-preprod.yml up -d`
   (image `midnightntwrk/proof-server:8.0.3`, binds `:6300`; first start downloads
   proving params). Health: `curl 127.0.0.1:6300` → `{"status":"ok"}`.
2. **Lace (Midnight) on the preprod network**, funded (you already funded
   `mn_addr_preprod1...`). Generate tDUST from tNIGHT for fees.
3. `yarn start` → open http://127.0.0.1:8080 (hard-reload; cache is disabled).
4. **Connect Wallet** → Lace approves on preprod.
5. Click **"Deploy new Kitties contract"** (new button; Lace signs the deploy) →
   it shows + auto-loads the contract address. (Or paste an existing preprod
   address.)
6. Click **"New Kittie"** → Lace signs → your kitty renders.

### Known risks / things to verify at runtime (need a funded Lace; couldn't be
### verified headlessly)
- **End-to-end deploy/mint signing** is unverified — it needs Lace popups. The
  build is green and follows the official example-bboard patterns, but the first
  real deploy is the true test. If deploy fails with a `tag`/`pipe`/`CompiledContract`
  error, the `CompiledKittiesContract` construction (contract `src/index.ts`) is the
  place to revisit.
- `levelPrivateStateProvider` uses a dev password `"midnight-kitties-dev-password"`
  and accountId = wallet shielded coin public key (see `MidnightWallet.tsx` /
  `browser/api.ts`). Local-only encryption, not a funds secret.
- Proof server health response changed from `"We're alive 🎉!"` to
  `{"status":"ok"}`; the UI "proof server online" indicator may read false even
  when it's up — cosmetic only, does not block minting.
- preprod can be intermittently unavailable; if connect/deploy hangs, check
  https://forum.midnight.network/t/preprod-preview-network-status/1094 .
