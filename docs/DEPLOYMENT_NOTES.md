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
