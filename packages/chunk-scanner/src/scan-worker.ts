// Worker thread: scans one slice of region files for findDugChunks.
// Decompressing + parsing NBT for thousands of chunks is CPU-bound (region
// files are already read once per file — see anvil.ts's one-slot cache), so
// splitting the (fully independent) region list across worker_threads is
// what actually cuts wall time here, on top of that read caching.
import { parentPort, workerData } from "node:worker_threads";
import { loadChunkNbt, CHUNKS_PER_REGION_SIDE, type RegionFile } from "blockdata-scanner/src/anvil.ts";
import { chunkAirPercent } from "blockdata-scanner/src/percent.ts";

const CHUNK_SIZE = 16;

interface ChunkLevel {
  name: string;
  percentMin: number;
  percentMax: number;
}

interface ScannedChunk {
  worldX: number;
  worldZ: number;
  level: string;
}

interface WorkerInput {
  regions: RegionFile[];
  levels: ChunkLevel[];
  minY: number;
  maxY: number;
}

function scan({ regions, levels, minY, maxY }: WorkerInput): ScannedChunk[] {
  const found: ScannedChunk[] = [];

  for (const region of regions) {
    for (let localZ = 0; localZ < CHUNKS_PER_REGION_SIDE; localZ++) {
      for (let localX = 0; localX < CHUNKS_PER_REGION_SIDE; localX++) {
        const chunkRoot = loadChunkNbt(region.path, localX, localZ);
        if (!chunkRoot) continue;

        const percent = chunkAirPercent(chunkRoot, minY, maxY);
        if (percent === undefined) continue;

        const matched = levels.find((level) => percent >= level.percentMin && percent <= level.percentMax);
        if (!matched) continue;

        found.push({
          worldX: (region.regionX * CHUNKS_PER_REGION_SIDE + localX) * CHUNK_SIZE,
          worldZ: (region.regionZ * CHUNKS_PER_REGION_SIDE + localZ) * CHUNK_SIZE,
          level: matched.name,
        });
      }
    }
  }

  return found;
}

parentPort!.postMessage(scan(workerData as WorkerInput));
