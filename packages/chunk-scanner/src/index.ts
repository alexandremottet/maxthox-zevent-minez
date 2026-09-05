// Scans VoxelMap region data for chunks that have been mostly dug out (a
// mining-event challenge: most of the chunk's 256 columns bottom out near
// bedrock) and syncs them into the "pois" MongoDB collection as type:"chunk"
// POIs, so dug-out chunks show up on the map.
//
//   MONGODB_URI=... tsx src/index.ts --input <dir containing x,z.zip region files>

import { MongoClient, type Document } from "mongodb";
// type-only: map-render's barrel also pulls in Leaflet (browser-only), which
// crashes in this Node CLI context, so import just the types (erased at
// compile time, no runtime import) and keep the one stable constant local
import type { PointOfInterest, PointPointOfInterest } from "map-render";
import { HEIGHTPOS, NO_DATA_HEIGHT, REGION_SIZE, listRegionFiles, loadRegion, shortPlane } from "voxelmap-to-image";

// one Minecraft chunk = 16x16 blocks
const CHUNK_SIZE = 16;

// a column counts as "empty" once its recorded surface sits in this range —
// around Minecraft's world floor (Y=-64 in 1.18+), meaning no real terrain
// ever generated there (still void/bedrock-only)
const EMPTY_HEIGHT_MIN = -65;
const EMPTY_HEIGHT_MAX = -55;
// a chunk is flagged once this fraction of its *surveyed* columns are empty
// (columns VoxelMap never recorded at all are excluded, not counted as empty)
const EMPTY_FRACTION_THRESHOLD = 0.9;
const CHUNKS_PER_REGION_SIDE = REGION_SIZE / CHUNK_SIZE;

interface EmptyChunk {
  worldX: number;
  worldZ: number;
}

function parseInputDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") return argv[i + 1];
  }
  throw new Error("missing --input <directory containing x,z.zip region files>");
}

function findEmptyChunks(inputDir: string): EmptyChunk[] {
  const files = listRegionFiles(inputDir);
  const empty: EmptyChunk[] = [];

  for (const file of files) {
    const region = loadRegion(file.path);
    const heights = shortPlane(region.data, HEIGHTPOS, true);

    for (let chunkRow = 0; chunkRow < CHUNKS_PER_REGION_SIDE; chunkRow++) {
      for (let chunkCol = 0; chunkCol < CHUNKS_PER_REGION_SIDE; chunkCol++) {
        let surveyed = 0;
        let low = 0;
        for (let dz = 0; dz < CHUNK_SIZE; dz++) {
          for (let dx = 0; dx < CHUNK_SIZE; dx++) {
            const localX = chunkCol * CHUNK_SIZE + dx;
            const localZ = chunkRow * CHUNK_SIZE + dz;
            const height = heights[localZ * REGION_SIZE + localX];
            if (height === NO_DATA_HEIGHT) continue;
            surveyed++;
            if (height >= EMPTY_HEIGHT_MIN && height <= EMPTY_HEIGHT_MAX) low++;
          }
        }
        if (surveyed === 0) continue;
        if (low / surveyed >= EMPTY_FRACTION_THRESHOLD) {
          empty.push({
            worldX: file.x * REGION_SIZE + chunkCol * CHUNK_SIZE,
            worldZ: file.z * REGION_SIZE + chunkRow * CHUNK_SIZE,
          });
        }
      }
    }
  }

  return empty;
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

  const inputDir = parseInputDir(process.argv.slice(2));
  const emptyChunks = findEmptyChunks(inputDir);
  console.log(
    `found ${emptyChunks.length} chunk(s) >= ${EMPTY_FRACTION_THRESHOLD * 100}% between y=${EMPTY_HEIGHT_MIN} and y=${EMPTY_HEIGHT_MAX}`,
  );

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const collection = client.db().collection("pois");
  const existingChunkPois = await collection.find({ type: "chunk" }).toArray();

  let created = 0;
  let corrected = 0;

  for (const { worldX, worldZ } of emptyChunks) {
    const match = existingChunkPois.find((poi: Document) => isSameChunk(poi as unknown as PointOfInterest, worldX, worldZ));
    if (match) {
      if (match.x !== worldX || match.y !== worldZ) {
        await collection.updateOne({ _id: match._id }, { $set: { x: worldX, y: worldZ } });
        corrected++;
      }
    } else {
      const poi: PointPointOfInterest = { x: worldX, y: worldZ, type: "chunk" };
      await collection.insertOne(poi);
      created++;
    }
  }

  await client.close();
  const alreadyExact = emptyChunks.length - created - corrected;
  console.log(`${created} created, ${corrected} corrected, ${alreadyExact} already exact`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
