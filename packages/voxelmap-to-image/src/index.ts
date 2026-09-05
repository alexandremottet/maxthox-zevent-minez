import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { PNG } from "pngjs";
import { extractBlockId, getRealBlockColor, isAirBlock } from "./blockColors.js";

// Format: com.mamiyaotaru.voxelmap.persistent.CompressibleMapData (VoxelMap Updated, DATA_VERSION 4)
// data entry = 22 byte-planes of REGION_SIZE*REGION_SIZE bytes each, plane index = "layer":
//   0-1 height (signed short, Short.MIN_VALUE = no data)
//   2-3 blockstate id (unsigned short, index into `key` file, 0 = none)
//   4   light
//   5-9 ocean floor: height(2) blockstate(2) light(1)
//   10-14 transparent layer: height(2) blockstate(2) light(1)
//   15-19 foliage layer: height(2) blockstate(2) light(1)
//   20-21 biome id (unsigned short, index into `biomes` file, 0 = none)
const REGION_SIZE = (256);
const LAYERS = 22;
const PLANE_SIZE = REGION_SIZE * REGION_SIZE;
const HEIGHTPOS = 0;
const BLOCKSTATEPOS = 2;
const REGION_FILENAME = /^(-?\d+),(-?\d+)\.zip$/;
const DEFAULT_SCALE = 4;

interface Options {
  inputDir: string;
  output: string;
  scale: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Partial<Options> = { output: "map.png", scale: DEFAULT_SCALE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--input":
        opts.inputDir = value;
        i++;
        break;
      case "--output":
        opts.output = value;
        i++;
        break;
      case "--scale":
        opts.scale = Number(value);
        i++;
        break;
    }
  }
  if (!opts.inputDir) {
    throw new Error("missing --input <directory containing x,z.zip region files>");
  }
  if (!opts.scale || opts.scale < 1) {
    throw new Error("--scale must be a positive integer");
  }
  return opts as Options;
}

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

interface Region {
  data: Buffer;
  key: Map<number, string>;
  biomes: Map<number, string>;
}

function loadRegion(inputPath: string): Region {
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

function plane(data: Buffer, layer: number): Buffer {
  return data.subarray(layer * PLANE_SIZE, (layer + 1) * PLANE_SIZE);
}

function shortPlane(data: Buffer, layer: number, signed: boolean): Int32Array {
  const high = plane(data, layer);
  const low = plane(data, layer + 1);
  const out = new Int32Array(PLANE_SIZE);
  for (let i = 0; i < PLANE_SIZE; i++) {
    const value = (high[i] << 8) | low[i];
    out[i] = signed ? (value << 16) >> 16 : value & 0xffff;
  }
  return out;
}

// deterministic, textureless color per blockstate string (not the real in-game color)
function colorForBlockstate(blockstate: string): [number, number, number] {
  let hash = 2166136261;
  for (let i = 0; i < blockstate.length; i++) {
    hash ^= blockstate.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return hslToRgb(hue, 0.55, 0.45);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function renderSurfaceImage(region: Region): Buffer {
  const heights = shortPlane(region.data, HEIGHTPOS, true);
  const blockstateIds = shortPlane(region.data, BLOCKSTATEPOS, false);
  const rgba = Buffer.alloc(PLANE_SIZE * 4);
  const colorCache = new Map<number, [number, number, number]>();
  const airCache = new Map<number, boolean>();

  for (let i = 0; i < PLANE_SIZE; i++) {
    const noData = heights[i] === -32768;
    let color: [number, number, number] = [0, 0, 0];
    let alpha = 0;
    if (!noData) {
      const id = blockstateIds[i];
      if (id !== 0) {
        let cached = colorCache.get(id);
        let air = airCache.get(id);
        if (!cached || air === undefined) {
          const name = region.key.get(id) ?? `unknown-${id}`;
          const blockId = extractBlockId(name);
          cached = getRealBlockColor(blockId) ?? colorForBlockstate(name);
          air = isAirBlock(blockId);
          colorCache.set(id, cached);
          airCache.set(id, air);
        }
        color = cached;
        alpha = air ? 0 : 255;
      } else {
        alpha = 255;
      }
    }
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = alpha;
  }
  return rgba;
}

interface RegionFile {
  x: number;
  z: number;
  path: string;
}

function listRegionFiles(dir: string): RegionFile[] {
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

function stitchRegions(files: RegionFile[]): { width: number; height: number; rgba: Buffer } {
  const minX = Math.min(...files.map((f) => f.x));
  const maxX = Math.max(...files.map((f) => f.x));
  const minZ = Math.min(...files.map((f) => f.z));
  const maxZ = Math.max(...files.map((f) => f.z));
  const width = (maxX - minX + 1) * REGION_SIZE;
  const height = (maxZ - minZ + 1) * REGION_SIZE;
  const rgba = Buffer.alloc(width * height * 4);

  for (const file of files) {
    const region = loadRegion(file.path);
    const tile = renderSurfaceImage(region);
    const originX = (file.x - minX) * REGION_SIZE;
    const originZ = (file.z - minZ) * REGION_SIZE;
    for (let row = 0; row < REGION_SIZE; row++) {
      const srcStart = row * REGION_SIZE * 4;
      const destStart = ((originZ + row) * width + originX) * 4;
      tile.copy(rgba, destStart, srcStart, srcStart + REGION_SIZE * 4);
    }
  }

  return { width, height, rgba };
}

function upscale(width: number, height: number, rgba: Buffer, factor: number): { width: number; height: number; rgba: Buffer } {
  const newWidth = width * factor;
  const newHeight = height * factor;
  const out = Buffer.alloc(newWidth * newHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcOffset = (y * width + x) * 4;
      for (let dy = 0; dy < factor; dy++) {
        const destRow = y * factor + dy;
        for (let dx = 0; dx < factor; dx++) {
          const destOffset = (destRow * newWidth + (x * factor + dx)) * 4;
          rgba.copy(out, destOffset, srcOffset, srcOffset + 4);
        }
      }
    }
  }

  return { width: newWidth, height: newHeight, rgba: out };
}

function writePng(width: number, height: number, rgba: Buffer, outputPath: string): void {
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  writeFileSync(outputPath, PNG.sync.write(png));
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const files = listRegionFiles(opts.inputDir);
  const stitched = stitchRegions(files);
  const { width, height, rgba } = upscale(stitched.width, stitched.height, stitched.rgba, opts.scale);
  writePng(width, height, rgba, opts.output);
  console.log(`wrote ${opts.output} (${width}x${height}, ${files.length} regions, x${opts.scale})`);
}

main();
