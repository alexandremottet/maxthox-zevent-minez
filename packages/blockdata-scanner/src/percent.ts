// Computes what fraction of a chunk's volume (within a given Y range) is air,
// by reading the block-state palette out of each 16x16x16 section's raw NBT.
//
// Palette index bit-packing: uses the post-1.16 (MC-166810) scheme where a
// packed index never spans across a `long` boundary — correct for this
// world's version (26.2). The pre-1.16 continuous-packing scheme is not
// implemented since it doesn't apply here.

export interface ChunkPercent {
  x: number;
  z: number;
  percent: number;
}

const AIR_NAMES = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);

// prismarine-nbt tags are untyped `{type, value}` wrappers all the way down;
// modeling that precisely isn't worth it for this internal-only module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tag = any;

function fields(compoundTag: Tag): Record<string, Tag> {
  return compoundTag.value;
}

function listItems(listTag: Tag): Tag[] {
  return listTag.value.value ?? [];
}

// a NBT `long`/longArray entry is a signed [high32, low32] pair; reassemble
// as an unsigned 64-bit BigInt for correct bitwise extraction
function longToBigInt([high, low]: [number, number]): bigint {
  return (BigInt(high) & 0xffffffffn) << 32n | (BigInt(low) & 0xffffffffn);
}

function bitsForPaletteSize(size: number): number {
  return Math.max(4, Math.ceil(Math.log2(size)));
}

// returns one palette index per block in section order (index = (y*16+z)*16+x)
function decodeSectionPaletteIndices(blockStates: Tag): number[] {
  const paletteTag = fields(blockStates).palette;
  const paletteSize = listItems(paletteTag).length;

  if (paletteSize <= 1) return new Array(4096).fill(0);

  const dataTag = fields(blockStates).data;
  const longs: Array<[number, number]> = dataTag.value;
  const bitsPerEntry = bitsForPaletteSize(paletteSize);
  const entriesPerLong = Math.floor(64 / bitsPerEntry);
  const mask = (1n << BigInt(bitsPerEntry)) - 1n;

  const indices = new Array<number>(4096);
  for (let i = 0; i < 4096; i++) {
    const longIndex = Math.floor(i / entriesPerLong);
    const bitOffset = (i % entriesPerLong) * bitsPerEntry;
    const longValue = longToBigInt(longs[longIndex]);
    indices[i] = Number((longValue >> BigInt(bitOffset)) & mask);
  }
  return indices;
}

// one air/not-air flag per palette entry, computed once per section.
// `listItems` returns list-of-compound elements already unwrapped to their
// bare field-map (unlike a compound *tag*, which still needs `fields()`) —
// so `entry.Name` here, not `fields(entry).Name`.
function decodePaletteAirFlags(blockStates: Tag): boolean[] {
  return listItems(fields(blockStates).palette).map((entry) => AIR_NAMES.has(entry.Name.value));
}

// tallies air/solid blocks across every section that overlaps [minY, maxY]
export function chunkAirCounts(chunkRoot: Tag, minY: number, maxY: number): { air: number; total: number } {
  const sectionsTag = fields(chunkRoot).sections;
  if (!sectionsTag) return { air: 0, total: 0 };

  let air = 0;
  let total = 0;

  for (const section of listItems(sectionsTag)) {
    const blockStates = section.block_states;
    if (!blockStates) continue; // sections with no blocks (e.g. above build height) omit this

    const sectionBaseY = section.Y.value * 16;
    if (sectionBaseY + 15 < minY || sectionBaseY > maxY) continue;

    const indices = decodeSectionPaletteIndices(blockStates);
    const airFlags = decodePaletteAirFlags(blockStates);
    for (let localY = 0; localY < 16; localY++) {
      const globalY = sectionBaseY + localY;
      if (globalY < minY || globalY > maxY) continue;
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const blockIndex = (localY * 16 + z) * 16 + x;
          total++;
          if (airFlags[indices[blockIndex]]) air++;
        }
      }
    }
  }

  return { air, total };
}

export function chunkAirPercent(chunkRoot: Tag, minY: number, maxY: number): number | undefined {
  const { air, total } = chunkAirCounts(chunkRoot, minY, maxY);
  if (total === 0) return undefined;
  return (air / total) * 100;
}
