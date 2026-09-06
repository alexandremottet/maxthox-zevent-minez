// Copies a world save, dropping whole overworld region files (.mca, 32x32
// chunks each) that don't contain any chunk within --radius chunks of a
// mine-level chunk POI. Trims BlueMap's render input (and therefore its
// tile output) down to the area that's actually relevant to the dig
// challenge, cutting the far surface terrain a WDL capture otherwise drags
// along.
//
//   node prune-world-save.mjs --input <world save dir> --output <dest dir> --radius 10
import { cpSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { loadMineChunks, regionKeepSet } from "./lib/mine-chunks.mjs";

const REGION_CHUNKS = 32; // one .mca region file = 32x32 chunks
const REGION_FILE_RE = /^r\.(-?\d+)\.(-?\d+)\.mca$/;

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const input = get("--input");
  const output = get("--output");
  if (!input) throw new Error("missing --input <world save dir>");
  if (!output) throw new Error("missing --output <dest dir>");
  return { input, output, radius: Number(get("--radius") ?? 10) };
}

function main() {
  const { input, output, radius } = parseArgs(process.argv.slice(2));
  const mineChunks = loadMineChunks();
  const regionSet = regionKeepSet(mineChunks, radius, REGION_CHUNKS);

  rmSync(output, { recursive: true, force: true });
  cpSync(input, output, {
    recursive: true,
    filter: (src) => {
      const match = REGION_FILE_RE.exec(basename(src));
      if (!match || !src.includes(join("dimensions", "minecraft", "overworld", "region"))) return true;
      return regionSet.shouldKeep(Number(match[1]), Number(match[2]));
    },
  });

  const { kept, dropped } = regionSet.counts();
  console.log(`pruned world save: kept ${kept} region(s), dropped ${dropped} region(s) (radius ${radius} chunks around ${mineChunks.length} mine chunk POIs)`);
}

main();
