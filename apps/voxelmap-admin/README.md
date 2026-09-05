# voxelmap-admin

Password-protected admin UI to add POIs. POIs live in the `pois` MongoDB
collection (same database as the auth store). Adding one writes to that
collection, then triggers `.github/workflows/deploy.yml` via the GitHub Actions
API — that workflow fetches the current POIs from MongoDB at build time
(`packages/map-render/scripts/fetch-pois.mjs`) and bakes them into the viewer's
build, so the deployed viewer stays a purely static site with no runtime
database calls.

Hosted on Vercel (SSR, `@astrojs/vercel`), auth via `better-auth` + MongoDB.

## Environment variables (set in the Vercel project)

| Var | Purpose |
|---|---|
| `MONGODB_URI` | connection string; used for both the better-auth store and the `pois` collection |
| `BETTER_AUTH_URL` | the deployed admin app's public URL |
| `BETTER_AUTH_SECRET` | random 32+ char secret for session signing |
| `GITHUB_TOKEN` | fine-grained PAT, **Actions: write** on this one repo (used to trigger the deploy workflow — no repo content access needed) |
| `GITHUB_REPO` | `owner/repo`, e.g. `alexandremottet/maxthox-zevent-minez` |

Also add `MONGODB_URI` as a **GitHub Actions repo secret** (Settings → Secrets
and variables → Actions) — `deploy.yml` needs it to fetch POIs at build time.

## One-time setup

1. Create the Vercel project (Root Directory = `apps/voxelmap-admin`; Vercel
   auto-detects the pnpm workspace from the root `pnpm-lock.yaml`). Set the env
   vars above.
2. Add `MONGODB_URI` as a GitHub Actions secret (see above).
3. Create the single admin account (public sign-up is disabled — this is the only
   way to create a login). Reads `MONGODB_URI`/`BETTER_AUTH_SECRET` from
   `.env.local` if present (see Local dev below); `ADMIN_EMAIL`/`ADMIN_PASSWORD`
   are one-off, pass them inline:

   ```bash
   ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm --filter voxelmap-admin run seed-admin
   ```

## Local dev

Copy `.env.example` to `.env.local` and fill in real values — Astro/Vite loads
`.env.local` automatically, no need to prefix every command with env vars.

```bash
cp .env.example .env.local
# edit .env.local, then:
pnpm --filter voxelmap-admin dev
```

`.env.local` is gitignored; never commit it.
