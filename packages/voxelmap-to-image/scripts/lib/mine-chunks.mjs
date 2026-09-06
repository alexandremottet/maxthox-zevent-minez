// Shared by prune-world-save.mjs and prune-voxelmap-cache.mjs: reads the
// mine-level chunk POIs (already-generated map-render/src/poi-data.ts, no
// MongoDB call) that both region-pruning scripts crop their input around.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHUNK_SIZE = 16;

// same "already-generated file" reading approach as generate-bluemap-markers.mjs
function readGeneratedArray(path) {
  const content = readFileSync(path, "utf8");
  const start = content.indexOf("= [") + 2;
  const end = content.lastIndexOf("]") + 1;
  return JSON.parse(content.slice(start, end));
}

export function loadMineChunks() {
  const mapRenderSrc = join(__dirname, "..", "..", "..", "map-render", "src");
  const pois = readGeneratedArray(join(mapRenderSrc, "poi-data.ts"));
  const chunks = pois.filter((poi) => poi.type === "chunk").map((poi) => ({ cx: poi.x / CHUNK_SIZE, cz: poi.y / CHUNK_SIZE }));
  if (chunks.length === 0) throw new Error("no chunk POIs found in poi-data.ts — refusing to prune against an empty set");
  return chunks;
}

// regionChunks = chunks per region side (32 for Anvil .mca, 16 for VoxelMap's .zip)
export function regionKeepSet(mineChunks, radius, regionChunks) {
  const keep = new Set();
  const drop = new Set();
  return {
    shouldKeep(rx, rz) {
      const key = `${rx},${rz}`;
      if (keep.has(key)) return true;
      if (drop.has(key)) return false;
      const minCx = rx * regionChunks - radius;
      const maxCx = rx * regionChunks + regionChunks - 1 + radius;
      const minCz = rz * regionChunks - radius;
      const maxCz = rz * regionChunks + regionChunks - 1 + radius;
      const hit = mineChunks.some(({ cx, cz }) => cx >= minCx && cx <= maxCx && cz >= minCz && cz <= maxCz);
      (hit ? keep : drop).add(key);
      return hit;
    },
    counts: () => ({ kept: keep.size, dropped: drop.size }),
  };
}
