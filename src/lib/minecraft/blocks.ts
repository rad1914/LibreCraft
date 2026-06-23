// Block type registry. Each block has an id, name, and per-face color.
// The "pixel-perfect" look comes from flat-shaded vertex colors rather
// than textures; we apply directional shading (top brightest, bottom
// darkest) so cubes still read as 3D.

export const BlockType = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  WATER: 7,
  SNOW: 8,
  BEDROCK: 9,
  PLANKS: 10,
  COBBLE: 11,
  BRICK: 12,
  GLASS: 13,
  TORCH: 14,
  BED: 15,
  CRAFTING_TABLE: 16,
  WOOL: 17,           // dropped by sheep; used for beds / decoration
  FLOWER: 18,         // decorative flower (passable, breaks in one tap)
  TALL_GRASS: 19,     // decorative grass tuft (passable)
  MOSSY_COBBLE: 20,   // mossy cobblestone variant — found in boulders
  COAL_ORE: 21,       // coal ore — drops coal (food substitute for torches)
  IRON_ORE: 22,       // iron ore — smelted into iron tools (placeholder)
  GRAVE: 23,          // headstone placed at death location; stores dropped inventory
  DIAMOND_ORE: 24,    // diamond ore — rare, only found deep underground
  PORTAL: 25,         // portal block — purple swirling vortex; forms when a 4x4 stone ring is built
  PORTAL_SKY: 26,     // sky portal variant — aqua swirling vortex
  RUBY_ORE: 27,       // ruby ore — extra rare, found very deep, drops ruby gem
  HAY: 28,            // hay bale — decorative block found around farms
  DOOR: 29,           // wooden door — placeable, open/close, used in villager houses
  // Non-placeable items (inventory only). IDs start at 100.
  FOOD: 100,
  SWORD: 101,
  PICKAXE: 102,
  AXE: 103,
  SHOVEL: 104,
  COAL: 105,          // smelted from coal ore; fuel & torch ingredient
  RUBY: 106,          // ruby gem — dropped from ruby ore, used as trading currency
  IRON_PICKAXE: 107,  // iron pickaxe — mines 5x faster than wood
  DIAMOND_PICKAXE: 108, // diamond pickaxe — mines 10x faster, can mine ruby ore
} as const;

interface BlockDef {
  id: number;
  name: string;
  // [top, side, bottom] colors as 0xRRGGBB
  colors: [number, number, number];
  // transparent blocks don't cull neighbor faces and render with alpha
  transparent?: boolean;
  // sprite blocks render as two crossed transparent quads (X-shape)
  // instead of a full cube — used for flowers, tall grass, saplings.
  sprite?: boolean;
  // solid blocks stop the player
  solid: boolean;
  // hardness in seconds — how long the player must hold BREAK to mine
  // this block. 0 = instant (creative). Bedrock is unbreakable (-1).
  hardness: number;
  // if set, this block emits light (a PointLight is attached at placement)
  light?: number;
  // which tool type breaks this block 3x faster
  tool?: "pickaxe" | "axe" | "shovel";
}

export const BLOCKS: Record<number, BlockDef> = {
  [BlockType.AIR]: { id: 0, name: "Air", colors: [0x000000, 0x000000, 0x000000], solid: false, hardness: 0 },
  [BlockType.GRASS]: { id: 1, name: "Grass", colors: [0x6aa84f, 0x8b6b3a, 0x6b4d2a], solid: true, hardness: 0.8, tool: "shovel" },
  [BlockType.DIRT]: { id: 2, name: "Dirt", colors: [0x8b5a2b, 0x8b5a2b, 0x6b4421], solid: true, hardness: 0.8, tool: "shovel" },
  [BlockType.STONE]: { id: 3, name: "Stone", colors: [0x888888, 0x7a7a7a, 0x666666], solid: true, hardness: 2.5, tool: "pickaxe" },
  [BlockType.SAND]: { id: 4, name: "Sand", colors: [0xeed9a1, 0xe0c886, 0xc9b36a], solid: true, hardness: 0.8, tool: "shovel" },
  [BlockType.WOOD]: { id: 5, name: "Wood", colors: [0xb5894a, 0x6e4f2a, 0xb5894a], solid: true, hardness: 2.0, tool: "axe" },
  [BlockType.LEAVES]: { id: 6, name: "Leaves", colors: [0x3f7a32, 0x356b2b, 0x2c5a23], solid: true, transparent: true, hardness: 0.4 },
  [BlockType.WATER]: { id: 7, name: "Water", colors: [0x3a6fd8, 0x3a6fd8, 0x2a5fc0], solid: false, transparent: true, hardness: 0 },
  [BlockType.SNOW]: { id: 8, name: "Snow", colors: [0xf5f7fa, 0xeef2f7, 0xd8dde6], solid: true, hardness: 0.5, tool: "shovel" },
  [BlockType.BEDROCK]: { id: 9, name: "Bedrock", colors: [0x333333, 0x2a2a2a, 0x222222], solid: true, hardness: -1 },
  [BlockType.PLANKS]: { id: 10, name: "Planks", colors: [0xb88b4a, 0xa67a3f, 0x8a6630], solid: true, hardness: 1.5, tool: "axe" },
  [BlockType.COBBLE]: { id: 11, name: "Cobblestone", colors: [0x7d7d7d, 0x6f6f6f, 0x5c5c5c], solid: true, hardness: 3.0, tool: "pickaxe" },
  [BlockType.BRICK]: { id: 12, name: "Brick", colors: [0x9c4a32, 0x8a3f2a, 0x703322], solid: true, hardness: 3.5, tool: "pickaxe" },
  [BlockType.GLASS]: { id: 13, name: "Glass", colors: [0xbfe3ee, 0xbfe3ee, 0xbfe3ee], solid: true, transparent: true, hardness: 0.5 },
  [BlockType.TORCH]: { id: 14, name: "Torch", colors: [0xffaa33, 0x8b5a2b, 0x6b4421], solid: false, transparent: true, sprite: true, hardness: 0.1, light: 12 },
  [BlockType.BED]: { id: 15, name: "Bed", colors: [0xcc3333, 0xcc3333, 0x6b4421], solid: false, transparent: true, hardness: 0.5 },
  [BlockType.CRAFTING_TABLE]: { id: 16, name: "Crafting Table", colors: [0x8b5a2b, 0x6b4421, 0x6b4421], solid: true, hardness: 1.5, tool: "axe" },
  [BlockType.WOOL]: { id: 17, name: "Wool", colors: [0xeeeeee, 0xdddddd, 0xcccccc], solid: true, hardness: 0.4, tool: "axe" },
  [BlockType.FLOWER]: { id: 18, name: "Flower", colors: [0xcc4444, 0x2ecc71, 0x2ecc71], solid: false, transparent: true, sprite: true, hardness: 0.1 },
  [BlockType.TALL_GRASS]: { id: 19, name: "Tall Grass", colors: [0x5b9245, 0x5b9245, 0x5b9245], solid: false, transparent: true, sprite: true, hardness: 0.1 },
  [BlockType.MOSSY_COBBLE]: { id: 20, name: "Mossy Cobblestone", colors: [0x6a7a55, 0x5a6a4a, 0x4a5a3a], solid: true, hardness: 3.0, tool: "pickaxe" },
  [BlockType.COAL_ORE]: { id: 21, name: "Coal Ore", colors: [0x444444, 0x3a3a3a, 0x2e2e2e], solid: true, hardness: 3.5, tool: "pickaxe" },
  [BlockType.IRON_ORE]: { id: 22, name: "Iron Ore", colors: [0xa09080, 0x908074, 0x807064], solid: true, hardness: 4.0, tool: "pickaxe" },
  [BlockType.GRAVE]: { id: 23, name: "Grave", colors: [0x4a4a4a, 0x3a3a3a, 0x2a2a2a], solid: true, hardness: 1.0, tool: "pickaxe" },
  [BlockType.DIAMOND_ORE]: { id: 24, name: "Diamond Ore", colors: [0x3a5a6a, 0x2a4a5a, 0x1a3a4a], solid: true, hardness: 5.0, tool: "pickaxe" },
  [BlockType.PORTAL]: { id: 25, name: "Portal", colors: [0x6a3a8a, 0x5a2a7a, 0x4a1a6a], solid: false, transparent: true, hardness: -1 }, // unbreakable, pass-through
  [BlockType.PORTAL_SKY]: { id: 26, name: "Sky Portal", colors: [0x2a8a9a, 0x1a7a8a, 0x0a6a7a], solid: false, transparent: true, hardness: -1 }, // aqua variant
  [BlockType.RUBY_ORE]: { id: 27, name: "Ruby Ore", colors: [0x5a1a1a, 0x4a0a0a, 0x3a0000], solid: true, hardness: 6.0, tool: "pickaxe" },
  [BlockType.HAY]: { id: 28, name: "Hay Bale", colors: [0xc9a04a, 0xb08a3a, 0x8a6a28], solid: true, hardness: 0.6, tool: "axe" },
  [BlockType.DOOR]: { id: 29, name: "Door", colors: [0xa67a3f, 0x8a6630, 0x6b4421], solid: true, transparent: true, hardness: 1.0, tool: "axe" },
  // Food is an inventory-only item — not placeable in the world.
  // It heals 6 HP when eaten.
  [BlockType.FOOD]: { id: 100, name: "Food", colors: [0xcc4444, 0xcc4444, 0xcc4444], solid: false, hardness: 0 },
  // Sword is an inventory-only item — not placeable. Equipping it
  // (selecting in hotbar) increases attack damage against mobs.
  [BlockType.SWORD]: { id: 101, name: "Sword", colors: [0xc0c0c0, 0x8b5a2b, 0x6b4421], solid: false, hardness: 0 },
  // Pickaxe: breaks stone/cobble/brick 3x faster when equipped.
  [BlockType.PICKAXE]: { id: 102, name: "Pickaxe", colors: [0xc0c0c0, 0x8b5a2b, 0x6b4421], solid: false, hardness: 0 },
  // Axe: breaks wood/planks 3x faster when equipped.
  [BlockType.AXE]: { id: 103, name: "Axe", colors: [0xc0c0c0, 0x8b5a2b, 0x6b4421], solid: false, hardness: 0 },
  // Shovel: breaks dirt/sand/snow 3x faster when equipped.
  [BlockType.SHOVEL]: { id: 104, name: "Shovel", colors: [0xc0c0c0, 0x8b5a2b, 0x6b4421], solid: false, hardness: 0 },
  // Coal: smelted from coal ore in a furnace (or directly dropped).
  // Used as fuel and as an ingredient for torches.
  [BlockType.COAL]: { id: 105, name: "Coal", colors: [0x1a1a1a, 0x111111, 0x0a0a0a], solid: false, hardness: 0 },
  // Ruby: extra-rare gem dropped from ruby ore. Used as currency for
  // trading with villagers.
  [BlockType.RUBY]: { id: 106, name: "Ruby", colors: [0xe02020, 0xa01010, 0x700808], solid: false, hardness: 0 },
  // Iron pickaxe: mines stone/ore 5x faster than wood.
  [BlockType.IRON_PICKAXE]: { id: 107, name: "Iron Pickaxe", colors: [0xd0d0d0, 0x8b5a2b, 0x6b4421], solid: false, hardness: 0 },
  // Diamond pickaxe: mines 10x faster, and can mine ruby ore (which
  // requires a diamond-tier pickaxe — anything slower won't drop the ruby).
  [BlockType.DIAMOND_PICKAXE]: { id: 108, name: "Diamond Pickaxe", colors: [0x60e0e0, 0x8b5a2b, 0x6b4421], solid: false, hardness: 0 },
};

export function isSolid(id: number): boolean {
  const def = BLOCKS[id];
  return def ? def.solid : false;
}

export function isAir(id: number): boolean {
  return id === BlockType.AIR;
}

// Returns the effective hardness when the given tool is equipped.
// Tool tiers multiply mining speed: wood pickaxe = 3x, iron pickaxe = 5x,
// diamond pickaxe = 10x. Non-matching tools get no bonus.
export function getEffectiveHardness(blockId: number, equippedItemId: number): number {
  const def = BLOCKS[blockId];
  if (!def) return 0;
  const base = def.hardness;
  if (base <= 0) return base;
  const tool = def.tool;
  if (!tool) return base;
  // Tool tier mapping: each pickaxe/axe/shovel type maps to its tool class
  // and a mining-speed multiplier.
  const toolMap: Record<number, { type: "pickaxe" | "axe" | "shovel"; tier: number }> = {
    [BlockType.PICKAXE]: { type: "pickaxe", tier: 1 },        // wood: 3x
    [BlockType.AXE]: { type: "axe", tier: 1 },
    [BlockType.SHOVEL]: { type: "shovel", tier: 1 },
    [BlockType.IRON_PICKAXE]: { type: "pickaxe", tier: 2 },   // iron: 5x
    [BlockType.DIAMOND_PICKAXE]: { type: "pickaxe", tier: 3 }, // diamond: 10x
  };
  const equipped = toolMap[equippedItemId];
  if (!equipped || equipped.type !== tool) return base;
  // Tier multiplier: tier 1 = /3, tier 2 = /5, tier 3 = /10.
  const mult = equipped.tier === 3 ? 10 : equipped.tier === 2 ? 5 : 3;
  return base / mult;
}
