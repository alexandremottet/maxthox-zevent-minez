// Copies the VoxelMap region cache, blanking individual chunks (not whole
// region files) that fall outside --radius chunks of any mine-level chunk
// POI. Feeds a cropped input to the flat-map generator (src/index.ts) so
// its stitched PNG/heights only cover the area relevant to the dig
// challenge, without dragging along a region's other 255 chunks just
// because one of them happens to be in range.
//
// Each "<x>,<z>.zip" is VoxelMap's own format (see src/regions.ts): a flat
// "data" entry of 22 byte-planes covering the whole 256x256-block region,
// height stored as a big-endian signed short split across planes 0/1
// (NO_DATA_HEIGHT = -32768 = 0x8000 means "nothing cached here"). Writing
// that sentinel into a chunk's 16x16 block sub-square is enough — the flat
// map's renderSurfaceImage (src/index.ts) treats NO_DATA_HEIGHT as fully
// transparent regardless of the blockstate plane, so there's no need to
// touch the other 20 planes.
//
//   node prune-voxelmap-cache.mjs --input data/overworld --output <dest dir> --radius 5
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { chunkKeepSet, loadMineChunks } from "./lib/mine-chunks.mjs";

const REGION_SIZE = 256; // blocks per region side
const PLANE_SIZE = REGION_SIZE * REGION_SIZE;
const CHUNK_SIZE = 16;
const REGION_CHUNKS = REGION_SIZE / CHUNK_SIZE; // 16 chunks per region side
const NO_DATA_HIGH = 0x80; // NO_DATA_HEIGHT (-32768) high byte
const NO_DATA_LOW = 0x00; // NO_DATA_HEIGHT (-32768) low byte
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

// mutates data (the region's combined 22-plane buffer) in place: blanks the
// height plane (layers 0-1) for every chunk outside the keep set
function blankChunks(data, regionX, regionZ, keepSet) {
  let kept = 0;
  let blanked = 0;
  const highPlane = data.subarray(0, PLANE_SIZE);
  const lowPlane = data.subarray(PLANE_SIZE, PLANE_SIZE * 2);

  for (let chunkRow = 0; chunkRow < REGION_CHUNKS; chunkRow++) {
    for (let chunkCol = 0; chunkCol < REGION_CHUNKS; chunkCol++) {
      const cx = regionX * REGION_CHUNKS + chunkCol;
      const cz = regionZ * REGION_CHUNKS + chunkRow;
      if (keepSet.isKept(cx, cz)) {
        kept++;
        continue;
      }
      for (let dz = 0; dz < CHUNK_SIZE; dz++) {
        const localZ = chunkRow * CHUNK_SIZE + dz;
        const rowStart = localZ * REGION_SIZE + chunkCol * CHUNK_SIZE;
        highPlane.fill(NO_DATA_HIGH, rowStart, rowStart + CHUNK_SIZE);
        lowPlane.fill(NO_DATA_LOW, rowStart, rowStart + CHUNK_SIZE);
      }
      blanked++;
    }
  }
  return { kept, blanked };
}

function main() {
  const { input, output, radius } = parseArgs(process.argv.slice(2));
  const mineChunks = loadMineChunks();
  const keepSet = chunkKeepSet(mineChunks, radius);

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  let totalKept = 0;
  let totalBlanked = 0;
  for (const entry of readdirSync(input)) {
    const match = REGION_FILE_RE.exec(entry);
    if (!match) continue;

    const zip = new AdmZip(join(input, entry));
    const data = zip.getEntry("data")?.getData();
    if (!data) throw new Error(`${entry}: missing "data" entry`);

    const { kept, blanked } = blankChunks(data, Number(match[1]), Number(match[2]), keepSet);
    totalKept += kept;
    totalBlanked += blanked;
    if (kept === 0) continue; // nothing worth keeping in this region at all

    zip.updateFile("data", data);
    zip.writeZip(join(output, entry));
  }

  console.log(`pruned voxelmap cache: kept ${totalKept} chunk(s), blanked ${totalBlanked} chunk(s) (radius ${radius} chunks around ${mineChunks.length} mine chunk POIs)`);
}

main();
