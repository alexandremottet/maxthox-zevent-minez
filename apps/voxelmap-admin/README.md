# voxelmap-admin

Password-protected admin UI to add POIs. Adding one commits straight to
`apps/voxelmap-viewer/src/data/poi.json` on `main` via the GitHub API, which
re-triggers `.github/workflows/deploy.yml` and republishes the viewer.

Hosted on Vercel (SSR, `@astrojs/vercel`), auth via `better-auth` + MongoDB.

## Environment variables (set in the Vercel project)

| Var | Purpose |
|---|---|
| `MONGODB_URI` | connection string for the better-auth session/user store |
| `BETTER_AUTH_URL` | the deployed admin app's public URL |
| `BETTER_AUTH_SECRET` | random 32+ char secret for session signing |
| `GITHUB_TOKEN` | fine-grained PAT, Contents: read/write, scoped to this one repo |
| `GITHUB_REPO` | `owner/repo`, e.g. `alexandremottet/maxthox-zevent-minez` |

## One-time setup

1. Create the Vercel project (Root Directory = `apps/voxelmap-admin`; Vercel
   auto-detects the pnpm workspace from the root `pnpm-lock.yaml`). Set the env
   vars above.
2. Create the single admin account (public sign-up is disabled — this is the only
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
