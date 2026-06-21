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
  // Non-placeable items (inventory only). IDs start at 100.
  FOOD: 100,
  SWORD: 101,
  PICKAXE: 102,
  AXE: 103,
  SHOVEL: 104,
} as const;

export interface BlockDef {
  id: number;
  name: string;
  // [top, side, bottom] colors as 0xRRGGBB
  colors: [number, number, number];
  // transparent blocks don't cull neighbor faces and render with alpha
  transparent?: boolean;
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
  [BlockType.TORCH]: { id: 14, name: "Torch", colors: [0xffaa33, 0x8b5a2b, 0x6b4421], solid: false, transparent: true, hardness: 0.1, light: 12 },
  [BlockType.BED]: { id: 15, name: "Bed", colors: [0xcc3333, 0xcc3333, 0x6b4421], solid: false, transparent: true, hardness: 0.5 },
  [BlockType.CRAFTING_TABLE]: { id: 16, name: "Crafting Table", colors: [0x8b5a2b, 0x6b4421, 0x6b4421], solid: true, hardness: 1.5, tool: "axe" },
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
};

export function isSolid(id: number): boolean {
  const def = BLOCKS[id];
  return def ? def.solid : false;
}

export function isAir(id: number): boolean {
  return id === BlockType.AIR;
}

export function getHardness(id: number): number {
  const def = BLOCKS[id];
  return def ? def.hardness : 0;
}

// Returns the effective hardness when the given tool is equipped.
// If the tool matches the block's required tool, hardness is divided by 3.
export function getEffectiveHardness(blockId: number, equippedItemId: number): number {
  const def = BLOCKS[blockId];
  if (!def) return 0;
  const base = def.hardness;
  if (base <= 0) return base;
  const tool = def.tool;
  if (!tool) return base;
  const toolMap: Record<number, "pickaxe" | "axe" | "shovel"> = {
    [BlockType.PICKAXE]: "pickaxe",
    [BlockType.AXE]: "axe",
    [BlockType.SHOVEL]: "shovel",
  };
  const equippedTool = toolMap[equippedItemId];
  if (equippedTool === tool) return base / 3;
  return base;
}
