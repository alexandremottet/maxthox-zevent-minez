// Minimal hand-rolled reader for the Minecraft "Anvil" region file format
// (.mca) — deliberately not using prismarine-provider-anvil/prismarine-chunk,
// which need an exact Minecraft-version registry to construct their chunk
// class; this world reports version "26.2" (read straight from level.dat),
// far past what those packages advertise support for. The Anvil container
// format itself (4KiB header of chunk offsets, per-chunk zlib payload) has
// been stable for years, so we read just that, then hand the decompressed
// bytes to prismarine-nbt (NBT itself is a version-independent format).
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateSync, gunzipSync } from "node:zlib";
import nbt from "prismarine-nbt";

export interface RegionFile {
  path: string;
  regionX: number;
  regionZ: number;
}

const REGION_FILE_PATTERN = /^r\.(-?\d+)\.(-?\d+)\.mca$/;

export function listRegionFiles(dir: string): RegionFile[] {
  return readdirSync(dir)
    .map((name) => ({ name, match: REGION_FILE_PATTERN.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .map(({ name, match }) => ({
      path: join(dir, name),
      regionX: Number(match[1]),
      regionZ: Number(match[2]),
    }));
}

const HEADER_SIZE = 4096;
const CHUNKS_PER_REGION_SIDE = 32;

// tag ids 1 (gzip) and 3 (uncompressed) exist in the spec but have never been
// observed in practice — vanilla always writes 2 (zlib); handled for
// completeness, not because we expect to hit them
function decompress(payload: Buffer, compressionType: number): Buffer {
  switch (compressionType) {
    case 1:
      return gunzipSync(payload);
    case 2:
      return inflateSync(payload);
    case 3:
      return payload;
    default:
      throw new Error(`unsupported chunk compression type: ${compressionType}`);
  }
}

// callers (chunk-scanner, blockdata-scanner) call this 1024 times in a row
// for the same regionPath (once per local chunk) before moving to the next
// region — a one-slot cache turns that into one disk read per region instead
// of one per chunk, which is where nearly all of the scan time was going
let cachedPath: string | undefined;
let cachedBuffer: Buffer | undefined;

// returns the root NBT compound for the chunk at region-local coordinates
// (0-31, 0-31), or undefined if that chunk was never generated/saved
export function loadChunkNbt(regionPath: string, localX: number, localZ: number): nbt.NBT | undefined {
  if (cachedPath !== regionPath) {
    cachedPath = regionPath;
    cachedBuffer = readFileSync(regionPath);
  }
  const region = cachedBuffer!;
  if (region.length < HEADER_SIZE) return undefined;

  const entryOffset = 4 * (localX + localZ * CHUNKS_PER_REGION_SIDE);
  const sectorOffset = region.readUIntBE(entryOffset, 3);
  const sectorCount = region.readUInt8(entryOffset + 3);
  if (sectorOffset === 0 || sectorCount === 0) return undefined;

  const byteOffset = sectorOffset * HEADER_SIZE;
  const length = region.readUInt32BE(byteOffset);
  const compressionType = region.readUInt8(byteOffset + 4);
  const payload = region.subarray(byteOffset + 5, byteOffset + 4 + length);

  const decompressed = decompress(payload, compressionType);
  return nbt.parseUncompressed(decompressed, "big");
}

export { CHUNKS_PER_REGION_SIDE };
