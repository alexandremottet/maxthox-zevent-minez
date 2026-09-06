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

// exact per-chunk "within radius (circular/Euclidean) of any mine chunk"
// set, precomputed once by expanding every mine chunk's own disc of that
// radius — far cheaper than scanning all mine chunks per candidate when
// there are many candidates to check (every chunk in every region file)
export function chunkKeepSet(mineChunks, radius) {
  const keys = new Set();
  const radiusSquared = radius * radius;
  for (const { cx, cz } of mineChunks) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radiusSquared) continue;
        keys.add(`${cx + dx},${cz + dz}`);
      }
    }
  }
  return { isKept: (cx, cz) => keys.has(`${cx},${cz}`) };
}
