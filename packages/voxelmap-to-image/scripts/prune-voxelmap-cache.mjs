// Copies the VoxelMap region cache, dropping whole "<x>,<z>.zip" region
// files (16x16 chunks each, REGION_SIZE=256 in regions.ts) that don't
// contain any chunk within --radius chunks of a mine-level chunk POI. Feeds
// a cropped input to the flat-map generator (src/index.ts) so its stitched
// PNG/heights only cover the area relevant to the dig challenge.
//
//   node prune-voxelmap-cache.mjs --input data/overworld --output <dest dir> --radius 5
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadMineChunks, regionKeepSet } from "./lib/mine-chunks.mjs";

const REGION_CHUNKS = 16; // one VoxelMap region zip = 16x16 chunks (REGION_SIZE 256 / CHUNK_SIZE 16)
const REGION_FILE_RE = /^(-?\d+),(-?\d+)\.zip$/;

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const input = get("--input");
  const output = get("--output");
  if (!input) throw new Error("missing --input <directory containing x,z.zip region files>");
  if (!output) throw new Error("missing --output <dest dir>");
  return { input, output, radius: Number(get("--radius") ?? 5) };
}

function main() {
  const { input, output, radius } = parseArgs(process.argv.slice(2));
  const mineChunks = loadMineChunks();
  const regionSet = regionKeepSet(mineChunks, radius, REGION_CHUNKS);

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  for (const entry of readdirSync(input)) {
    const match = REGION_FILE_RE.exec(entry);
    if (!match) continue;
    if (!regionSet.shouldKeep(Number(match[1]), Number(match[2]))) continue;
    copyFileSync(join(input, entry), join(output, entry));
  }

  const { kept, dropped } = regionSet.counts();
  console.log(`pruned voxelmap cache: kept ${kept} region(s), dropped ${dropped} region(s) (radius ${radius} chunks around ${mineChunks.length} mine chunk POIs)`);
}

main();
