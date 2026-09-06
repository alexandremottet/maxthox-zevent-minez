// Scans for chunks being dug out (a mining-event challenge). Computes a
// per-chunk "how dug is this" percentage via blockdata-scanner's percent
// source factory (--source voxelmap|wdl, see percent-sources.ts), matches it
// against the bands in ../map-render/src/levels.json, then syncs the result
// into the "pois" MongoDB collection as type:"chunk" POIs, so dig progress
// shows up on the map with the colors defined there.
//
//   MONGODB_URI=... tsx src/index.ts [--source voxelmap|wdl] [--input <dir>]
//     [--depth-threshold -58] [--min-y -64] [--max-y 20]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPercentSource, type ChunkPercent } from "blockdata-scanner/src/percent-sources.ts";
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
  // a chunk is assigned to whichever level's range contains its "how dug"
  // percentage, computed by whichever percent source is selected
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

function parseArgs(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const source = getPercentSource(get("--source") ?? process.env.PERCENT_SOURCE ?? "voxelmap");
  const input = get("--input") ?? source.defaultInput;
  const depthThreshold = get("--depth-threshold");
  const minY = get("--min-y");
  const maxY = get("--max-y");

  return {
    source,
    input,
    depthThreshold: depthThreshold === undefined ? undefined : Number(depthThreshold),
    minY: minY === undefined ? undefined : Number(minY),
    maxY: maxY === undefined ? undefined : Number(maxY),
  };
}

function classifyChunks(percents: ChunkPercent[], levels: ChunkLevel[]): ScannedChunk[] {
  const found: ScannedChunk[] = [];
  for (const { x, z, percent } of percents) {
    const matched = levels.find((level) => percent >= level.percentMin && percent <= level.percentMax);
    if (!matched) continue;
    found.push({ worldX: x, worldZ: z, level: matched.name });
  }
  return found;
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
  const { source, input, depthThreshold, minY, maxY } = parseArgs(process.argv.slice(2));
  const percents = source.compute({ input, depthThreshold, minY, maxY });
  const dugChunks = classifyChunks(percents, levels);

  const byLevel = new Map<string, number>();
  for (const { level } of dugChunks) byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  const summary = levels.map((l) => `${l.name}=${byLevel.get(l.name) ?? 0}`).join(", ");
  console.log(`found ${dugChunks.length} chunk(s) via "${source.name}": ${summary}`);

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
