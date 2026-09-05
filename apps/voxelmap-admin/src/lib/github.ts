import type { PointOfInterest } from "map-render";

const GITHUB_API = "https://api.github.com";
const POI_PATH = "apps/voxelmap-viewer/src/data/poi.json";

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${import.meta.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };
}

export interface PoiFile {
  pois: PointOfInterest[];
  sha: string;
}

export async function getPoiFile(): Promise<PoiFile> {
  const repo = import.meta.env.GITHUB_REPO;
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${POI_PATH}`, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub API error fetching poi.json: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { content: string; sha: string };
  const pois = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8")) as PointOfInterest[];
  return { pois, sha: data.sha };
}

export async function addPoi(poi: PointOfInterest): Promise<{ commitUrl: string }> {
  const repo = import.meta.env.GITHUB_REPO;
  const { pois, sha } = await getPoiFile();
  const updated = [...pois, poi];
  const content = Buffer.from(JSON.stringify(updated, null, 2) + "\n", "utf-8").toString("base64");

  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${POI_PATH}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({
      message: `poi: add "${poi.title ?? "untitled"}"`,
      content,
      sha,
      branch: "main",
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API error updating poi.json: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { commit: { html_url: string } };
  return { commitUrl: data.commit.html_url };
}
