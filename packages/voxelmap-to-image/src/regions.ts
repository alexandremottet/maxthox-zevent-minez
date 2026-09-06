import { readdirSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";

// Format: com.mamiyaotaru.voxelmap.persistent.CompressibleMapData (VoxelMap Updated, DATA_VERSION 4)
// data entry = 22 byte-planes of REGION_SIZE*REGION_SIZE bytes each, plane index = "layer":
//   0-1 height (signed short, Short.MIN_VALUE = no data)
//   2-3 blockstate id (unsigned short, index into `key` file, 0 = none)
//   4   light
//   5-9 ocean floor: height(2) blockstate(2) light(1)
//   10-14 transparent layer: height(2) blockstate(2) light(1)
//   15-19 foliage layer: height(2) blockstate(2) light(1)
//   20-21 biome id (unsigned short, index into `biomes` file, 0 = none)
export const REGION_SIZE = 256;
export const LAYERS = 22;
export const PLANE_SIZE = REGION_SIZE * REGION_SIZE;
export const HEIGHTPOS = 0;
export const BLOCKSTATEPOS = 2;
export const NO_DATA_HEIGHT = -32768; // Short.MIN_VALUE sentinel for "no cached data"
const REGION_FILENAME = /^(-?\d+),(-?\d+)\.zip$/;

function parseIndexedTable(text: string): Map<number, string> {
  const table = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const spaceIndex = line.indexOf(" ");
    const id = Number(line.slice(0, spaceIndex));
    const value = line.slice(spaceIndex + 1);
    table.set(id, value);
  }
  return table;
}

export interface Region {
  data: Buffer;
  key: Map<number, string>;
  biomes: Map<number, string>;
}

export function loadRegion(inputPath: string): Region {
  const zip = new AdmZip(inputPath);
  const data = zip.getEntry("data")?.getData();
  const keyText = zip.getEntry("key")?.getData().toString("utf8") ?? "";
  const biomesText = zip.getEntry("biomes")?.getData().toString("utf8") ?? "";
  const controlText = zip.getEntry("control")?.getData().toString("utf8") ?? "version:1";
  if (!data) throw new Error(`${inputPath}: missing "data" entry`);

  const versionMatch = controlText.match(/version:(\d+)/);
  const version = versionMatch ? Number(versionMatch[1]) : 1;
  if (version !== 4) {
    throw new Error(`${inputPath}: unsupported cache version ${version}, only version 4 is supported`);
  }
  if (data.length !== PLANE_SIZE * LAYERS) {
    throw new Error(
      `${inputPath}: unexpected data length ${data.length}, expected ${PLANE_SIZE * LAYERS} for version 4`,
    );
  }

  return { data, key: parseIndexedTable(keyText), biomes: parseIndexedTable(biomesText) };
}

export function plane(data: Buffer, layer: number): Buffer {
  return data.subarray(layer * PLANE_SIZE, (layer + 1) * PLANE_SIZE);
}

export function shortPlane(data: Buffer, layer: number, signed: boolean): Int32Array {
  const high = plane(data, layer);
  const low = plane(data, layer + 1);
  const out = new Int32Array(PLANE_SIZE);
  for (let i = 0; i < PLANE_SIZE; i++) {
    const value = (high[i] << 8) | low[i];
    out[i] = signed ? (value << 16) >> 16 : value & 0xffff;
  }
  return out;
}

export interface RegionFile {
  x: number;
  z: number;
  path: string;
}

export function listRegionFiles(dir: string): RegionFile[] {
  const files: RegionFile[] = [];
  for (const entry of readdirSync(dir)) {
    const match = entry.match(REGION_FILENAME);
    if (match) {
      files.push({ x: Number(match[1]), z: Number(match[2]), path: join(dir, entry) });
    }
  }
  if (files.length === 0) {
    throw new Error(`no "x,z.zip" region files found in ${dir}`);
  }
  return files;
}

// VoxelMap sometimes caches a column as height=-64 (world floor) with the
// recorded surface block still "air" — never real terrain (a genuine surface
// reading is never air), just a not-yet-scanned placeholder that happens to
// slip past the NO_DATA_HEIGHT check and would otherwise falsely count as
// "reached the depth threshold".
const AIR_BLOCK_NAME = /:(air|cave_air|void_air)\}$/;
const CHUNK_SIZE = 16;
const CHUNKS_PER_REGION_SIDE = REGION_SIZE / CHUNK_SIZE;
const COLUMNS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE; // 256

export interface ChunkDepthPercent {
  x: number;
  z: number;
  percent: number;
}

// percentage of a chunk's 256 columns whose recorded VoxelMap height is at
// or below depthThreshold (i.e. dug down close to bedrock). An unsurveyed
// column counts against the chunk, not toward it. Chunks with zero surveyed
// columns (never actually visited, even though their region file exists
// because a neighboring chunk was) are omitted entirely.
export function computeDepthPercents(inputDir: string, depthThreshold: number): ChunkDepthPercent[] {
  const files = listRegionFiles(inputDir);
  const results: ChunkDepthPercent[] = [];

  for (const file of files) {
    const region = loadRegion(file.path);
    const heights = shortPlane(region.data, HEIGHTPOS, true);
    const blockstates = shortPlane(region.data, BLOCKSTATEPOS, false);

    for (let chunkRow = 0; chunkRow < CHUNKS_PER_REGION_SIDE; chunkRow++) {
      for (let chunkCol = 0; chunkCol < CHUNKS_PER_REGION_SIDE; chunkCol++) {
        let reachedDepth = 0;
        let surveyed = 0;
        for (let dz = 0; dz < CHUNK_SIZE; dz++) {
          for (let dx = 0; dx < CHUNK_SIZE; dx++) {
            const localX = chunkCol * CHUNK_SIZE + dx;
            const localZ = chunkRow * CHUNK_SIZE + dz;
            const index = localZ * REGION_SIZE + localX;
            const height = heights[index];
            if (height === NO_DATA_HEIGHT) continue;
            const blockName = region.key.get(blockstates[index]) ?? "";
            if (AIR_BLOCK_NAME.test(blockName)) continue;
            surveyed++;
            if (height <= depthThreshold) reachedDepth++;
          }
        }
        if (surveyed === 0) continue;

        results.push({
          x: file.x * REGION_SIZE + chunkCol * CHUNK_SIZE,
          z: file.z * REGION_SIZE + chunkRow * CHUNK_SIZE,
          percent: (reachedDepth / COLUMNS_PER_CHUNK) * 100,
        });
      }
    }
  }

  return results;
}
