// Scans VoxelMap region data for chunks being dug out (a mining-event
// challenge). For each chunk, computes the average recorded height across its
// surveyed columns and matches it against the depth bands in
// ../map-render/src/levels.json, then syncs the result into the "pois"
// MongoDB collection as type:"chunk" POIs, so dig progress shows up on the
// map with the colors defined there.
//
//   MONGODB_URI=... tsx src/index.ts --input <dir containing x,z.zip region files>

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MongoClient, type Document } from "mongodb";
// type-only: map-render's barrel also pulls in Leaflet (browser-only), which
// crashes in this Node CLI context, so import just the types (erased at
// compile time, no runtime import) — real values (levels.json) are read
// straight off disk below instead, bypassing that barrel entirely
import type { PointOfInterest, PointPointOfInterest } from "map-render";
import { HEIGHTPOS, NO_DATA_HEIGHT, REGION_SIZE, listRegionFiles, loadRegion, shortPlane } from "voxelmap-to-image";

// one Minecraft chunk = 16x16 blocks
const CHUNK_SIZE = 16;
const CHUNKS_PER_REGION_SIDE = REGION_SIZE / CHUNK_SIZE;

interface ChunkLevel {
  name: string;
  // a chunk is assigned to whichever level's range contains the average
  // height of its surveyed columns
  heightMin: number;
  heightMax: number;
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

function parseInputDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") return argv[i + 1];
  }
  throw new Error("missing --input <directory containing x,z.zip region files>");
}

function findDugChunks(inputDir: string, levels: ChunkLevel[]): ScannedChunk[] {
  const files = listRegionFiles(inputDir);
  const found: ScannedChunk[] = [];

  for (const file of files) {
    const region = loadRegion(file.path);
    const heights = shortPlane(region.data, HEIGHTPOS, true);

    for (let chunkRow = 0; chunkRow < CHUNKS_PER_REGION_SIDE; chunkRow++) {
      for (let chunkCol = 0; chunkCol < CHUNKS_PER_REGION_SIDE; chunkCol++) {
        let surveyed = 0;
        let heightSum = 0;
        for (let dz = 0; dz < CHUNK_SIZE; dz++) {
          for (let dx = 0; dx < CHUNK_SIZE; dx++) {
            const localX = chunkCol * CHUNK_SIZE + dx;
            const localZ = chunkRow * CHUNK_SIZE + dz;
            const height = heights[localZ * REGION_SIZE + localX];
            if (height === NO_DATA_HEIGHT) continue;
            surveyed++;
            heightSum += height;
          }
        }
        if (surveyed === 0) continue;

        const averageHeight = heightSum / surveyed;
        const matched = levels.find((level) => averageHeight >= level.heightMin && averageHeight <= level.heightMax);
        if (!matched) continue;

        found.push({
          worldX: file.x * REGION_SIZE + chunkCol * CHUNK_SIZE,
          worldZ: file.z * REGION_SIZE + chunkRow * CHUNK_SIZE,
          level: matched.name,
        });
      }
    }
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
  const inputDir = parseInputDir(process.argv.slice(2));
  const dugChunks = findDugChunks(inputDir, levels);

  const byLevel = new Map<string, number>();
  for (const { level } of dugChunks) byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  const summary = levels.map((l) => `${l.name}=${byLevel.get(l.name) ?? 0}`).join(", ");
  console.log(`found ${dugChunks.length} chunk(s): ${summary}`);

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

  await client.close();
  const alreadyExact = dugChunks.length - created - corrected;
  console.log(`${created} created, ${corrected} corrected, ${alreadyExact} already exact`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
