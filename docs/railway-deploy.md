# Deploying to Railway

This repo is a **pnpm workspace + Turbo monorepo**. It deploys as three Railway
services in a single project (workspace: **Musashi's Projects**):

| Service    | Type                 | Source             | Config file            |
| ---------- | -------------------- | ------------------ | ---------------------- |
| `Postgres` | Railway Postgres     | managed            | —                      |
| `api`      | `@cardmkt/api`       | this repo, root `/`| `apps/api/railway.json`|
| `web`      | `@cardmkt/web`       | this repo, root `/`| `apps/web/railway.json`|

> **Monorepo rule:** both app services keep **Root Directory = `/`** (the repo
> root). The pnpm workspace install resolves the cross-package `workspace:*`
> deps and applies the patched `@stellar/stellar-sdk`; building from a sub-dir
> would break that. Each service is scoped to its app via the Turbo `--filter`
> in its `railway.json` build command.

The `railway.json` files are already committed. You only need to create the
services, point each at its config file, and set environment variables.

---

## 1. Create the project + services

In the Railway dashboard (workspace **Musashi's Projects**):

1. **New Project → Deploy from GitHub repo** → select this repo. This creates
   the first service from the repo.
2. Add a **Postgres** database: **New → Database → Add PostgreSQL**.
3. You'll end up with two repo-backed services (rename them `api` and `web`).
   If only one was created, **New → GitHub Repo** (same repo) for the second.

For **each** repo service, open **Settings**:

- **Root Directory:** `/`
- **Config-as-code file path:**
  - `api` → `apps/api/railway.json`
  - `web` → `apps/web/railway.json`
- (Optional) Set **Watch Paths** so a push only redeploys the affected app:
  - `api` → `apps/api/**`, `packages/**`
  - `web` → `apps/web/**`, `packages/shared/**`

> Node version: `package.json` declares `engines.node >= 20`, which Nixpacks
> honors. To pin explicitly, set `NIXPACKS_NODE_VERSION=22` on each service.

---

## 2. Generate domains

For **both** `api` and `web`: **Settings → Networking → Generate Domain**.
You need the API domain before building `web` (it's baked into the bundle), so
generate domains first. The reference-variable wiring below avoids hardcoding.

---

## 3. Environment variables — `api` service

The API **fails to boot** unless `CONTRACT_ID`, `USDC_ISSUER`, and
`PLATFORM_ISSUER` are set. Pull values from your local (git-ignored) files:
`deploy.json`, `.env`, and `stellar-accounts.json`.

**Required**

```
DATABASE_URL=${{Postgres.DATABASE_URL}}      # Railway reference variable
CONTRACT_ID=<deploy.json → contractId>
USDC_ISSUER=<.env → USDC_ISSUER>
PLATFORM_ISSUER=<.env → PLATFORM_ISSUER>
WEB_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}   # CORS allow-list
```

**Stellar network (testnet)**

```
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
USDC_ASSET_CODE=USDC
```

**Secrets (testnet dev/mint + arbitration)** — copy from `.env`:

```
PLATFORM_ISSUER_SECRET=<.env>     # enables /api/dev mint + /api/cards on testnet
ARBITER_SECRET=<.env>             # optional; /api/tx/resolve returns 501 if empty
```

**Optional tuning** (defaults shown; only set to override):

```
FEE_BPS=200
PATH_PAYMENT_SLIPPAGE_BPS=50
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
```

**Optional passkey relay** (only if using passkey checkout):

```
PASSKEY_RELAY_PROVIDER=channels
CHANNELS_URL=https://channels.openzeppelin.com/testnet
CHANNELS_API_KEY=<key>
PASSKEY_WALLET_WASM_HASH=<hash>
PASSKEY_RP_ID=${{web.RAILWAY_PUBLIC_DOMAIN}}   # must equal the web host for WebAuthn
# Legacy fallback:
LAUNCHTUBE_URL=
LAUNCHTUBE_JWT=
```

> `PORT` is injected by Railway automatically — the API reads it (`env.port`)
> and `trust proxy` is already set to `1` for Railway's proxy.

---

## 4. Environment variables — `web` service

All `NEXT_PUBLIC_*` values are **baked at build time**, so the API domain must
exist (step 2) before the web build runs.

```
NEXT_PUBLIC_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_EXPLORER_URL=https://stellar.expert/explorer/testnet
NEXT_PUBLIC_MAINTENANCE_MODE=false
```

---

## 5. Deploy

Trigger a deploy on each service (push to the connected branch, or **Deploy**
in the dashboard). On the `api` service the lifecycle is:

1. **Build:** `pnpm exec turbo run build --filter=@cardmkt/api`
   (also builds `@cardmkt/db` and `@cardmkt/shared`).
2. **Pre-deploy:** `pnpm --filter @cardmkt/db migrate` runs Drizzle migrations
   against `DATABASE_URL` once, before the new version goes live.
3. **Start:** `pnpm --filter @cardmkt/api start` → `node dist/index.js`.
4. **Health check:** Railway polls `/health` until it returns `{ "ok": true }`.

Verify:

```
curl https://<api-domain>/health      # -> {"ok":true}
```

Then open the `web` domain. If the frontend can't reach the API, re-check
`NEXT_PUBLIC_API_URL` (web) and `WEB_ORIGIN` (api) — a `WEB_ORIGIN` mismatch
shows up as a browser CORS error.

---

## Notes

- **Migrations need `drizzle-kit`** (a `devDependency` of `@cardmkt/db`).
  Nixpacks keeps dev dependencies in the image, so the pre-deploy step works.
- **Seeding** is not automatic. To seed once: `railway run --service api pnpm db:seed`
  (or run it as a one-off from the dashboard shell).
- **Mainnet:** the dev/mint routes (`/api/dev`, `/api/cards`) are disabled when
  `STELLAR_NETWORK=mainnet`. Keep `testnet` for the demo.
