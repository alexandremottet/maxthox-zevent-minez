// Scans the real WDL world save for chunks being dug out (a mining-event
// challenge). For each chunk, computes the percentage of air blocks between
// --min-y and --max-y and matches it against the emptiness bands in
// ../map-render/src/levels.json, then syncs the result into the "pois"
// MongoDB collection as type:"chunk" POIs, so dig progress shows up on the
// map with the colors defined there.
//
//   MONGODB_URI=... tsx src/index.ts --input <dir containing r.X.Z.mca region files> [--min-y -59] [--max-y 20]
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { listRegionFiles, type RegionFile } from "blockdata-scanner/src/anvil.ts";
import { MongoClient, type Document } from "mongodb";
// type-only: map-render's barrel also pulls in Leaflet (browser-only), which
// crashes in this Node CLI context, so import just the types (erased at
// compile time, no runtime import) — real values (levels.json) are read
// straight off disk below instead, bypassing that barrel entirely
import type { PointOfInterest, PointPointOfInterest } from "map-render";

// one Minecraft chunk = 16x16 blocks
const CHUNK_SIZE = 16;

interface ChunkLevel {
  name: string;
  // a chunk is assigned to whichever level's range contains its emptiness
  // percentage (air blocks / total blocks) in [--min-y, --max-y]
  percentMin: number;
  percentMax: number;
  color: string;
}

function loadLevels(): ChunkLevel[] {
  const levelsPath = fileURLToPath(new URL("../../map-render/src/levels.json", import.meta.url));
  return JSON.parse(readFileSync(levelsPath, "utf8"));
}

interface ScannedChunk {
  worldX: number;
  worldZ: number;
  level: string;
}

function parseArgs(argv: string[]): { inputDir: string; minY: number; maxY: number } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const inputDir = get("--input");
  if (!inputDir) throw new Error("missing --input <directory containing r.X.Z.mca region files>");

  return { inputDir, minY: Number(get("--min-y") ?? -59), maxY: Number(get("--max-y") ?? 20) };
}

function scanRegionsInWorker(regions: RegionFile[], levels: ChunkLevel[], minY: number, maxY: number): Promise<ScannedChunk[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(new URL("./scan-worker.ts", import.meta.url)), {
      workerData: { regions, levels, minY, maxY },
    });
    worker.once("message", (result: ScannedChunk[]) => resolve(result));
    worker.once("error", reject);
  });
}

// regions are fully independent of each other, so scanning is split across
// one worker_thread per CPU core — decompressing+parsing NBT for thousands
// of chunks is CPU-bound, this is where the real time goes (see scan-worker.ts)
async function findDugChunks(inputDir: string, minY: number, maxY: number, levels: ChunkLevel[]): Promise<ScannedChunk[]> {
  const regions = listRegionFiles(inputDir);
  const workerCount = Math.max(1, Math.min(availableParallelism(), regions.length));
  const slices: RegionFile[][] = Array.from({ length: workerCount }, () => []);
  regions.forEach((region, i) => slices[i % workerCount].push(region));

  const results = await Promise.all(slices.filter((slice) => slice.length > 0).map((slice) => scanRegionsInWorker(slice, levels, minY, maxY)));
  return results.flat();
}

// an existing chunk POI "notes" this chunk if its recorded origin falls
// anywhere within the same 16x16 cell, even if not placed exactly on it
function isSameChunk(poi: PointOfInterest, worldX: number, worldZ: number): poi is PointPointOfInterest {
  if ("x1" in poi) return false;
  return (
    Math.floor(poi.x / CHUNK_SIZE) === Math.floor(worldX / CHUNK_SIZE) &&
    Math.floor(poi.y / CHUNK_SIZE) === Math.floor(worldZ / CHUNK_SIZE)
  );
}

async function main(): Promise<void> {
  const { MONGODB_URI } = process.env;
  if (!MONGODB_URI) throw new Error("missing required env var: MONGODB_URI");

  const levels = loadLevels();
  const { inputDir, minY, maxY } = parseArgs(process.argv.slice(2));
  const dugChunks = await findDugChunks(inputDir, minY, maxY, levels);

  const byLevel = new Map<string, number>();
  for (const { level } of dugChunks) byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  const summary = levels.map((l) => `${l.name}=${byLevel.get(l.name) ?? 0}`).join(", ");
  console.log(`found ${dugChunks.length} chunk(s) in Y[${minY}, ${maxY}]: ${summary}`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const collection = client.db().collection("pois");
  const existingChunkPois = await collection.find({ type: "chunk" }).toArray();

  let created = 0;
  let corrected = 0;

  for (const { worldX, worldZ, level } of dugChunks) {
    const match = existingChunkPois.find((poi: Document) => isSameChunk(poi as unknown as PointOfInterest, worldX, worldZ));
    if (match) {
      const needsUpdate = match.x !== worldX || match.y !== worldZ || match.level !== level;
      if (needsUpdate) {
        // $unset clears the old ongoing:boolean field this used to write, if present
        await collection.updateOne({ _id: match._id }, { $set: { x: worldX, y: worldZ, level }, $unset: { ongoing: "" } });
        corrected++;
      }
    } else {
      const poi: PointPointOfInterest = { x: worldX, y: worldZ, type: "chunk", level };
      await collection.insertOne(poi);
      created++;
    }
  }

  // remove chunk POIs from a previous scan that no longer match any currently
  // dug chunk — e.g. ones misclassified by a since-fixed bug in findDugChunks
  const stalePois = existingChunkPois.filter(
    (poi: Document) => !dugChunks.some(({ worldX, worldZ }) => isSameChunk(poi as unknown as PointOfInterest, worldX, worldZ)),
  );
  if (stalePois.length > 0) {
    await collection.deleteMany({ _id: { $in: stalePois.map((poi: Document) => poi._id) } });
  }

  await client.close();
  const alreadyExact = dugChunks.length - created - corrected;
  console.log(`${created} created, ${corrected} corrected, ${alreadyExact} already exact, ${stalePois.length} removed as stale`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
