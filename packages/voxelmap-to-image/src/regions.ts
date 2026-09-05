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
