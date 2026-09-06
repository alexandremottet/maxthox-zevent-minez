// Factory for the two ways of computing a per-chunk "how dug is this"
// percentage, used by both blockdata-scanner (writes percent-data.ts) and
// chunk-scanner (classifies chunks against levels.json). Swap which one
// runs via --source/PERCENT_SOURCE without touching either caller.
import { computeDepthPercents } from "voxelmap-to-image";
import { CHUNKS_PER_REGION_SIDE, listRegionFiles, loadChunkNbt } from "./anvil.ts";
import { chunkAirPercent, type ChunkPercent } from "./percent.ts";

export type { ChunkPercent };

export interface PercentSourceOptions {
  input: string;
  depthThreshold?: number;
  minY?: number;
  maxY?: number;
}

export interface PercentSource {
  name: string;
  // used when the caller doesn't pass its own --input
  defaultInput: string;
  compute(options: PercentSourceOptions): ChunkPercent[];
}

// % of a chunk's 256 columns whose recorded VoxelMap surface height reaches
// --depth-threshold. Covers every chunk the player has ever walked through
// (VoxelMap's minimap cache is always-on), so it's the one that matches
// actual exploration — see computeDepthPercents in voxelmap-to-image.
const voxelmapSource: PercentSource = {
  name: "voxelmap",
  defaultInput: "../voxelmap-to-image/data/overworld",
  compute({ input, depthThreshold = -58 }) {
    return computeDepthPercents(input, depthThreshold);
  },
};

// % of air blocks in a chunk's real 3D volume within [--min-y, --max-y],
// read straight from the WDL world save. More precise per-chunk (full block
// data, not just surface height), but only covers whatever region files an
// active World Downloader session actually captured — can undercount real
// exploration if that lagged behind.
const wdlSource: PercentSource = {
  name: "wdl",
  defaultInput: "../voxelmap-to-image/save/minez.mathox1subs.fr/dimensions/minecraft/overworld/region",
  compute({ input, minY = -64, maxY = 20 }) {
    const regionFiles = listRegionFiles(input);
    const results: ChunkPercent[] = [];

    for (const region of regionFiles) {
      for (let localZ = 0; localZ < CHUNKS_PER_REGION_SIDE; localZ++) {
        for (let localX = 0; localX < CHUNKS_PER_REGION_SIDE; localX++) {
          const chunkRoot = loadChunkNbt(region.path, localX, localZ);
          if (!chunkRoot) continue;

          const percent = chunkAirPercent(chunkRoot, minY, maxY);
          if (percent === undefined) continue;

          results.push({
            x: (region.regionX * CHUNKS_PER_REGION_SIDE + localX) * 16,
            z: (region.regionZ * CHUNKS_PER_REGION_SIDE + localZ) * 16,
            percent,
          });
        }
      }
    }

    return results;
  },
};

const SOURCES: Record<string, PercentSource> = {
  voxelmap: voxelmapSource,
  wdl: wdlSource,
};

export function getPercentSource(name: string): PercentSource {
  const source = SOURCES[name];
  if (!source) throw new Error(`unknown percent source "${name}" — expected one of: ${Object.keys(SOURCES).join(", ")}`);
  return source;
}
