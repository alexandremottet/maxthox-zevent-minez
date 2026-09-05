import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { extractBlockId, getRealBlockColor, isAirBlock } from "./blockColors.js";
import { BLOCKSTATEPOS, HEIGHTPOS, NO_DATA_HEIGHT, PLANE_SIZE, REGION_SIZE, type Region, type RegionFile, listRegionFiles, loadRegion, shortPlane } from "./regions.js";

const DEFAULT_SCALE = 4;

interface Options {
  inputDir: string;
  outputDir: string;
  scale: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Partial<Options> = { outputDir: "out", scale: DEFAULT_SCALE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--input":
        opts.inputDir = value;
        i++;
        break;
      case "--output":
        opts.outputDir = value;
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

function renderSurfaceImage(region: Region, heights: Int32Array): Buffer {
  const blockstateIds = shortPlane(region.data, BLOCKSTATEPOS, false);
  const rgba = Buffer.alloc(PLANE_SIZE * 4);
  const colorCache = new Map<number, [number, number, number]>();
  const airCache = new Map<number, boolean>();

  for (let i = 0; i < PLANE_SIZE; i++) {
    const noData = heights[i] === NO_DATA_HEIGHT;
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

type QuadrantKey = "pxpy" | "nxpy" | "pxny" | "nxny";

const QUADRANTS: { key: QuadrantKey; positiveX: boolean; positiveZ: boolean }[] = [
  { key: "pxpy", positiveX: true, positiveZ: true },
  { key: "nxpy", positiveX: false, positiveZ: true },
  { key: "pxny", positiveX: true, positiveZ: false },
  { key: "nxny", positiveX: false, positiveZ: false },
];

function quadrantOf(x: number, z: number): QuadrantKey {
  if (x >= 0 && z >= 0) return "pxpy";
  if (x < 0 && z >= 0) return "nxpy";
  if (x >= 0 && z < 0) return "pxny";
  return "nxny";
}

// the near edge (region 0, or -1 on the negative side) is forced rather than
// taken from the data, so world (0, 0) always lands at a fixed, known pixel —
// no origin constant needed by the consumers of the generated image
function stitchQuadrant(
  files: RegionFile[],
  positiveX: boolean,
  positiveZ: boolean,
): { width: number; height: number; rgba: Buffer; heights: Int16Array } {
  const minX = positiveX ? 0 : Math.min(...files.map((f) => f.x));
  const maxX = positiveX ? Math.max(...files.map((f) => f.x)) : -1;
  const minZ = positiveZ ? 0 : Math.min(...files.map((f) => f.z));
  const maxZ = positiveZ ? Math.max(...files.map((f) => f.z)) : -1;
  const width = (maxX - minX + 1) * REGION_SIZE;
  const height = (maxZ - minZ + 1) * REGION_SIZE;
  const rgba = Buffer.alloc(width * height * 4);
  // one entry per block, no upscale — a heightmap doesn't benefit from it
  const heights = new Int16Array(width * height).fill(NO_DATA_HEIGHT);

  for (const file of files) {
    const region = loadRegion(file.path);
    const tileHeights = shortPlane(region.data, HEIGHTPOS, true);
    const tile = renderSurfaceImage(region, tileHeights);
    const originX = (file.x - minX) * REGION_SIZE;
    const originZ = (file.z - minZ) * REGION_SIZE;
    for (let row = 0; row < REGION_SIZE; row++) {
      const srcStart = row * REGION_SIZE * 4;
      const destStart = ((originZ + row) * width + originX) * 4;
      tile.copy(rgba, destStart, srcStart, srcStart + REGION_SIZE * 4);
      heights.set(tileHeights.subarray(row * REGION_SIZE, (row + 1) * REGION_SIZE), (originZ + row) * width + originX);
    }
  }

  return { width, height, rgba, heights };
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

function writeHeights(heights: Int16Array, outputPath: string): void {
  writeFileSync(outputPath, Buffer.from(heights.buffer, heights.byteOffset, heights.byteLength));
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const files = listRegionFiles(opts.inputDir);
  mkdirSync(opts.outputDir, { recursive: true });

  for (const { key, positiveX, positiveZ } of QUADRANTS) {
    const quadrantFiles = files.filter((f) => quadrantOf(f.x, f.z) === key);
    if (quadrantFiles.length === 0) {
      console.log(`skipping ${key}: no region files`);
      continue;
    }
    const stitched = stitchQuadrant(quadrantFiles, positiveX, positiveZ);
    const { width, height, rgba } = upscale(stitched.width, stitched.height, stitched.rgba, opts.scale);
    const outPath = join(opts.outputDir, `map-${key}.png`);
    writePng(width, height, rgba, outPath);
    console.log(`wrote ${outPath} (${width}x${height}, ${quadrantFiles.length} regions, x${opts.scale})`);

    const heightsPath = join(opts.outputDir, `heights-${key}.bin`);
    writeHeights(stitched.heights, heightsPath);
    console.log(`wrote ${heightsPath} (${stitched.width}x${stitched.height} blocks)`);
  }
}

main();
