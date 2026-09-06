// Copies a world save, blanking individual chunks (not whole region files)
// that fall outside --radius chunks of any mine-level chunk POI. Trims
// BlueMap's render input (and therefore its tile output) down to the area
// actually relevant to the dig challenge, without dragging along the rest
// of a region file just because one corner happens to be in range.
//
// Anvil regions (.mca) are a 1024-entry chunk location table (4 bytes each,
// index = localX + localZ*32) followed by the chunk payloads it points to.
// Zeroing a chunk's location (and timestamp) entry is the standard "this
// chunk doesn't exist" trick — BlueMap (and vanilla Minecraft) then just
// skips it, no NBT parsing needed. The now-unreferenced payload bytes stay
// in the file wasting a little space, but nothing points to them anymore.
//
//   node prune-world-save.mjs --input <world save dir> --output <dest dir> --radius 10
import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chunkKeepSet, loadMineChunks } from "./lib/mine-chunks.mjs";

const REGION_CHUNKS = 32; // one .mca region file = 32x32 chunks
const REGION_DIR_SUFFIX = join("dimensions", "minecraft", "overworld", "region");
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

// mutates buf in place: zeroes the location+timestamp entries of every
// chunk outside the keep set. Returns how many chunks were blanked/kept.
function blankChunks(buf, regionX, regionZ, keepSet) {
  let kept = 0;
  let blanked = 0;
  for (let localZ = 0; localZ < REGION_CHUNKS; localZ++) {
    for (let localX = 0; localX < REGION_CHUNKS; localX++) {
      const cx = regionX * REGION_CHUNKS + localX;
      const cz = regionZ * REGION_CHUNKS + localZ;
      const entryOffset = (localX + localZ * REGION_CHUNKS) * 4;
      const hasLocation = buf.readUInt32BE(entryOffset) !== 0;
      if (!hasLocation) continue; // chunk was never generated in the save to begin with
      if (keepSet.isKept(cx, cz)) {
        kept++;
        continue;
      }
      buf.writeUInt32BE(0, entryOffset); // location table
      buf.writeUInt32BE(0, 4096 + entryOffset); // timestamp table
      blanked++;
    }
  }
  return { kept, blanked };
}

function main() {
  const { input, output, radius } = parseArgs(process.argv.slice(2));
  const mineChunks = loadMineChunks();
  const keepSet = chunkKeepSet(mineChunks, radius);

  cpSync(input, output, { recursive: true });

  const regionDir = join(output, REGION_DIR_SUFFIX);
  let totalKept = 0;
  let totalBlanked = 0;
  for (const entry of readdirSync(regionDir)) {
    const match = REGION_FILE_RE.exec(entry);
    if (!match) continue;
    const filePath = join(regionDir, entry);
    const buf = readFileSync(filePath);
    const { kept, blanked } = blankChunks(buf, Number(match[1]), Number(match[2]), keepSet);
    if (blanked > 0) writeFileSync(filePath, buf);
    totalKept += kept;
    totalBlanked += blanked;
  }

  console.log(`pruned world save: kept ${totalKept} chunk(s), blanked ${totalBlanked} chunk(s) (radius ${radius} chunks around ${mineChunks.length} mine chunk POIs)`);
}

main();
