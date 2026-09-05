import { requireEnv } from "./env.ts";

// POIs live in MongoDB now (see poi-db.ts); the viewer fetches them at build
// time (packages/map-render/scripts/fetch-pois.mjs), so publishing a new POI
// just needs to re-run that build — no file to commit
export async function triggerDeploy(): Promise<void> {
  const repo = requireEnv("GITHUB_REPO");
  const token = requireEnv("GITHUB_TOKEN");

  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error triggering deploy: ${res.status} ${await res.text()}`);
  }
}
