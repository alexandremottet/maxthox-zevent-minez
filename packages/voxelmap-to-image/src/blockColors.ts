// Real Minecraft map colors, sourced from the vanilla map-item base color palette
// (https://minecraft.wiki/w/Map_item_format#Base_colors). These are the same colors
// the in-game map item renders each block as, not the block's actual block texture.

type RGB = [number, number, number];

// dye-family blocks share one color per dye name across wool/bed/carpet/banner/
// stained_glass/glazed_terracotta/concrete/concrete_powder/candle/shulker_box
const DYE_COLORS: Record<string, RGB> = {
  white: [255, 255, 255],
  orange: [216, 127, 51],
  magenta: [178, 76, 216],
  light_blue: [102, 153, 216],
  yellow: [229, 229, 51],
  lime: [127, 204, 25],
  pink: [242, 127, 165],
  gray: [76, 76, 76],
  light_gray: [153, 153, 153],
  cyan: [76, 127, 153],
  purple: [127, 63, 178],
  blue: [51, 76, 178],
  brown: [102, 76, 51],
  green: [102, 127, 51],
  red: [153, 51, 51],
  black: [25, 25, 25],
};

// undyed terracotta uses a different, muted palette per color
const TERRACOTTA_DYE_COLORS: Record<string, RGB> = {
  white: [209, 177, 161],
  orange: [159, 82, 36],
  magenta: [149, 87, 108],
  light_blue: [112, 108, 138],
  yellow: [186, 133, 36],
  lime: [103, 117, 53],
  pink: [160, 77, 78],
  gray: [57, 41, 35],
  light_gray: [135, 107, 98],
  cyan: [87, 92, 92],
  purple: [122, 73, 88],
  blue: [76, 62, 92],
  brown: [76, 50, 35],
  green: [76, 82, 42],
  red: [142, 60, 46],
  black: [37, 22, 16],
};

const DYE_SUFFIXES = [
  "wool",
  "bed",
  "carpet",
  "banner",
  "wall_banner",
  "stained_glass",
  "stained_glass_pane",
  "glazed_terracotta",
  "concrete",
  "concrete_powder",
  "candle",
  "shulker_box",
];

// per wood species: color for structural parts (planks/log/wood/furniture) and leaves
const WOOD_COLORS: Record<string, { wood: RGB; leaves: RGB }> = {
  oak: { wood: [143, 119, 72], leaves: [0, 124, 0] },
  spruce: { wood: [129, 86, 49], leaves: [0, 124, 0] },
  birch: { wood: [247, 233, 163], leaves: [0, 124, 0] },
  jungle: { wood: [151, 109, 77], leaves: [0, 124, 0] },
  acacia: { wood: [216, 127, 51], leaves: [0, 124, 0] },
  dark_oak: { wood: [102, 76, 51], leaves: [0, 124, 0] },
  mangrove: { wood: [153, 51, 51], leaves: [0, 124, 0] },
  cherry: { wood: [209, 177, 161], leaves: [242, 127, 165] },
  bamboo: { wood: [229, 229, 51], leaves: [0, 124, 0] },
  crimson: { wood: [148, 63, 97], leaves: [148, 63, 97] },
  warped: { wood: [58, 142, 140], leaves: [58, 142, 140] },
  pale_oak: { wood: [255, 252, 245], leaves: [167, 167, 167] },
};

// everything that isn't a dye/wood family member
const BASE_BLOCK_COLORS: Record<string, RGB> = {
  grass_block: [127, 178, 56],
  slime_block: [127, 178, 56],
  short_grass: [0, 124, 0],
  tall_grass: [0, 124, 0],
  fern: [0, 124, 0],
  large_fern: [0, 124, 0],
  vine: [0, 124, 0],
  glow_lichen: [127, 167, 150],
  moss_carpet: [102, 127, 51],
  moss_block: [102, 127, 51],
  bush: [0, 124, 0],
  leaf_litter: [102, 76, 51],
  azalea: [0, 124, 0],
  azalea_leaves: [0, 124, 0],
  flowering_azalea: [0, 124, 0],
  flowering_azalea_leaves: [0, 124, 0],
  kelp: [64, 64, 255],
  seagrass: [64, 64, 255],
  tall_seagrass: [64, 64, 255],
  water: [64, 64, 255],
  lava: [255, 0, 0],
  fire: [255, 0, 0],
  soul_fire: [102, 153, 216],
  tnt: [255, 0, 0],
  redstone_block: [255, 0, 0],
  redstone_wire: [255, 0, 0],

  dandelion: [0, 124, 0],
  poppy: [0, 124, 0],
  azure_bluet: [0, 124, 0],
  oxeye_daisy: [0, 124, 0],
  cornflower: [0, 124, 0],
  rose_bush: [0, 124, 0],
  sugar_cane: [0, 124, 0],
  bamboo_sapling: [143, 119, 72],
  wheat: [0, 124, 0],
  carrots: [0, 124, 0],
  potatoes: [0, 124, 0],
  melon: [127, 204, 25],
  melon_stem: [0, 124, 0],
  attached_melon_stem: [0, 124, 0],
  pumpkin_stem: [0, 124, 0],
  attached_pumpkin_stem: [0, 124, 0],
  pumpkin: [216, 127, 51],
  nether_wart: [153, 51, 51],
  warped_roots: [76, 127, 153],
  warped_fungus: [76, 127, 153],
  crimson_roots: [112, 2, 0],
  crimson_fungus: [112, 2, 0],
  small_amethyst_bud: [127, 63, 178],
  firefly_bush: [0, 124, 0],

  sand: [247, 233, 163],
  red_sand: [216, 127, 51],
  sandstone: [247, 233, 163],
  gravel: [112, 112, 112],
  glowstone: [247, 233, 163],
  end_stone: [247, 233, 163],
  bone_block: [247, 233, 163],
  scaffolding: [247, 233, 163],
  turtle_egg: [247, 233, 163],
  sulfur_bricks: [186, 133, 36],

  dirt: [151, 109, 77],
  coarse_dirt: [151, 109, 77],
  rooted_dirt: [151, 109, 77],
  farmland: [151, 109, 77],
  dirt_path: [151, 109, 77],
  granite: [151, 109, 77],
  polished_granite: [151, 109, 77],
  jukebox: [151, 109, 77],

  stone: [112, 112, 112],
  cobblestone: [112, 112, 112],
  cobblestone_slab: [112, 112, 112],
  cobblestone_stairs: [112, 112, 112],
  cobblestone_wall: [112, 112, 112],
  mossy_cobblestone: [112, 112, 112],
  smooth_stone: [112, 112, 112],
  smooth_stone_slab: [112, 112, 112],
  stone_pressure_plate: [112, 112, 112],
  stone_bricks: [112, 112, 112],
  bedrock: [112, 112, 112],
  monster_spawner: [112, 112, 112],
  furnace: [112, 112, 112],
  ender_chest: [112, 112, 112],
  dispenser: [112, 112, 112],
  dropper: [112, 112, 112],
  observer: [112, 112, 112],
  smoker: [112, 112, 112],
  blast_furnace: [112, 112, 112],
  stonecutter: [112, 112, 112],
  piston: [112, 112, 112],
  hopper: [112, 112, 112],
  crafter: [112, 112, 112],
  vault: [112, 112, 112],
  andesite: [112, 112, 112],
  polished_andesite: [112, 112, 112],
  cauldron: [112, 112, 112],

  coal_ore: [112, 112, 112],
  coal_block: [25, 25, 25],
  iron_ore: [112, 112, 112],
  iron_block: [167, 167, 167],
  gold_ore: [112, 112, 112],
  gold_block: [250, 238, 77],
  emerald_ore: [112, 112, 112],
  emerald_block: [0, 217, 58],
  lapis_ore: [112, 112, 112],
  lapis_block: [74, 128, 255],
  redstone_ore: [112, 112, 112],
  copper_ore: [112, 112, 112],
  copper_block: [216, 127, 51],
  raw_iron_block: [216, 175, 147],
  raw_gold_block: [250, 238, 77],
  raw_copper_block: [216, 127, 51],
  diamond_ore: [112, 112, 112],
  diamond_block: [92, 219, 213],
  netherite_block: [25, 25, 25],
  ancient_debris: [25, 25, 25],

  deepslate: [100, 100, 100],
  cobbled_deepslate: [100, 100, 100],
  cobbled_deepslate_stairs: [100, 100, 100],
  cobbled_deepslate_wall: [100, 100, 100],
  polished_deepslate: [100, 100, 100],
  deepslate_bricks: [100, 100, 100],
  deepslate_coal_ore: [100, 100, 100],
  deepslate_iron_ore: [100, 100, 100],
  deepslate_gold_ore: [100, 100, 100],
  deepslate_copper_ore: [100, 100, 100],
  deepslate_lapis_ore: [100, 100, 100],
  deepslate_redstone_ore: [100, 100, 100],
  deepslate_diamond_ore: [100, 100, 100],
  deepslate_emerald_ore: [100, 100, 100],
  infested_deepslate: [100, 100, 100],
  reinforced_deepslate: [100, 100, 100],
  tuff: [57, 41, 35],

  ice: [160, 160, 255],
  frosted_ice: [160, 160, 255],
  packed_ice: [160, 160, 255],
  blue_ice: [160, 160, 255],
  snow: [255, 255, 255],
  snow_block: [255, 255, 255],
  powder_snow: [255, 255, 255],
  clay: [164, 168, 184],

  obsidian: [25, 25, 25],
  crying_obsidian: [25, 25, 25],
  respawn_anchor: [25, 25, 25],
  netherrack: [112, 2, 0],
  nether_bricks: [112, 2, 0],
  nether_brick_fence: [112, 2, 0],
  nether_gold_ore: [112, 2, 0],
  nether_quartz_ore: [112, 2, 0],
  magma_block: [112, 2, 0],
  red_nether_bricks: [112, 2, 0],
  soul_sand: [102, 76, 51],
  soul_soil: [102, 76, 51],
  basalt: [112, 112, 112],
  smooth_basalt: [112, 112, 112],
  blackstone: [25, 25, 25],
  gilded_blackstone: [25, 25, 25],
  warped_nylium: [22, 126, 134],
  warped_planks: [58, 142, 140],
  crimson_nylium: [189, 48, 49],

  podzol: [129, 86, 49],
  campfire: [129, 86, 49],
  mycelium: [127, 63, 178],
  mud: [87, 92, 92],
  mud_bricks: [135, 107, 98],
  packed_mud: [151, 109, 77],
  honey_block: [216, 127, 51],
  honeycomb_block: [216, 127, 51],
  amethyst_block: [127, 63, 178],
  calcite: [209, 177, 161],
  dripstone_block: [142, 60, 46],
  pointed_dripstone: [142, 60, 46],

  glass: [0, 0, 0],
  glass_pane: [0, 0, 0],
  sea_lantern: [255, 252, 245],
  target: [255, 252, 245],
  quartz_block: [255, 252, 245],
  diorite: [255, 252, 245],
  polished_diorite: [255, 252, 245],

  prismarine: [87, 92, 92],
  prismarine_bricks: [92, 219, 213],
  dark_prismarine: [92, 219, 213],
  beacon: [92, 219, 213],

  bookshelf: [143, 119, 72],
  crafting_table: [143, 119, 72],
  chest: [143, 119, 72],
  trapped_chest: [143, 119, 72],
  barrel: [143, 119, 72],
  cartography_table: [143, 119, 72],
  fletching_table: [143, 119, 72],
  lectern: [143, 119, 72],
  smithing_table: [143, 119, 72],
  composter: [143, 119, 72],
  beehive: [143, 119, 72],
  ladder: [143, 119, 72],
  note_block: [143, 119, 72],
  hay_block: [229, 229, 51],
  bee_nest: [229, 229, 51],
  sponge: [229, 229, 51],
  wet_sponge: [229, 229, 51],

  anvil: [167, 167, 167],
  chipped_anvil: [167, 167, 167],
  damaged_anvil: [167, 167, 167],
  grindstone: [167, 167, 167],
  lantern: [167, 167, 167],
  lodestone: [167, 167, 167],
  brewing_stand: [167, 167, 167],
  bell: [250, 238, 77],
  enchanting_table: [153, 51, 51],
  end_stone_bricks: [247, 233, 163],
  ender_chest_air: [0, 0, 0],

  air: [0, 0, 0],
  cave_air: [0, 0, 0],
  void_air: [0, 0, 0],

  torch: [0, 0, 0],
  wall_torch: [0, 0, 0],
  lever: [0, 0, 0],
  rail: [0, 0, 0],
  activator_rail: [0, 0, 0],
  detector_rail: [0, 0, 0],
  powered_rail: [0, 0, 0],
  tripwire: [0, 0, 0],
  tripwire_hook: [0, 0, 0],
  cobweb: [199, 199, 199],
};

const AIR_BLOCKS = new Set(["air", "cave_air", "void_air"]);

export function extractBlockId(blockstate: string): string {
  const match = blockstate.match(/minecraft:([a-z0-9_]+)/);
  return match ? match[1] : blockstate;
}

export function isAirBlock(blockId: string): boolean {
  return AIR_BLOCKS.has(blockId);
}

export function getRealBlockColor(blockId: string): RGB | undefined {
  const direct = BASE_BLOCK_COLORS[blockId];
  if (direct) return direct;

  for (const suffix of DYE_SUFFIXES) {
    if (blockId.endsWith(`_${suffix}`)) {
      const colorName = blockId.slice(0, -(suffix.length + 1));
      if (DYE_COLORS[colorName]) return DYE_COLORS[colorName];
    }
  }

  if (blockId.endsWith("_terracotta")) {
    const colorName = blockId.slice(0, -"_terracotta".length);
    if (TERRACOTTA_DYE_COLORS[colorName]) return TERRACOTTA_DYE_COLORS[colorName];
  }

  for (const [species, colors] of Object.entries(WOOD_COLORS)) {
    if (blockId.startsWith(`${species}_`) || blockId === species) {
      return blockId.includes("leaves") ? colors.leaves : colors.wood;
    }
  }

  return undefined;
}
