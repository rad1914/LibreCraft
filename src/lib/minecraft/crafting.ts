// Crafting system: recipes split into "basic" (craftable in the
// inventory 2x2 grid, no table needed) and "advanced" (require a
// crafting table). Each recipe has a `requiresTable` flag.
//
// To craft: call craft(recipeId) — removes ingredients, adds output.
//
// Recipe categories:
//   - Wood processing (planks, table, torches)
//   - Stone & mineral processing (cobble, brick, glass, coal)
//   - Tools (sword, pickaxe, axe, shovel)
//   - Decorative (bed, wool blocks, mossy cobble)
//   - Food prep (cooked food)

import { BlockType } from "./blocks";
import { Inventory } from "./inventory";

interface Ingredient {
  id: number;
  count: number;
}

export interface Recipe {
  id: string;
  name: string;
  ingredients: Ingredient[];
  output: Ingredient;
  requiresTable: boolean; // true = needs a crafting table; false = basic (inventory only)
}

export const RECIPES: Recipe[] = [
  // --- Basic recipes (no crafting table needed) ---
  {
    id: "planks_from_wood",
    name: "4 Planks from 1 Wood",
    ingredients: [{ id: BlockType.WOOD, count: 1 }],
    output: { id: BlockType.PLANKS, count: 4 },
    requiresTable: false,
  },
  {
    id: "crafting_table_from_wood",
    name: "1 Crafting Table from 4 Wood",
    ingredients: [{ id: BlockType.WOOD, count: 4 }],
    output: { id: BlockType.CRAFTING_TABLE, count: 1 },
    requiresTable: false,
  },
  {
    id: "torch_from_wood_coal",
    name: "4 Torches from 1 Wood + 1 Coal",
    ingredients: [
      { id: BlockType.WOOD, count: 1 },
      { id: BlockType.COAL, count: 1 },
    ],
    output: { id: BlockType.TORCH, count: 4 },
    requiresTable: false,
  },
  // Legacy torch recipe still works with planks (less efficient — 2 torches).
  {
    id: "torch_from_wood_planks",
    name: "2 Torches from 1 Wood + 1 Planks",
    ingredients: [
      { id: BlockType.WOOD, count: 1 },
      { id: BlockType.PLANKS, count: 1 },
    ],
    output: { id: BlockType.TORCH, count: 2 },
    requiresTable: false,
  },
  {
    id: "cobble_from_stone",
    name: "1 Cobblestone from 1 Stone",
    ingredients: [{ id: BlockType.STONE, count: 1 }],
    output: { id: BlockType.COBBLE, count: 1 },
    requiresTable: false,
  },
  // Refine cobble back to stone (handy for builds).
  {
    id: "stone_from_cobble",
    name: "1 Stone from 1 Cobblestone",
    ingredients: [{ id: BlockType.COBBLE, count: 1 }],
    output: { id: BlockType.STONE, count: 1 },
    requiresTable: false,
  },

  // --- Advanced recipes (require crafting table) ---
  // Tools
  {
    id: "sword_from_wood",
    name: "1 Sword from 2 Wood",
    ingredients: [{ id: BlockType.WOOD, count: 2 }],
    output: { id: BlockType.SWORD, count: 1 },
    requiresTable: true,
  },
  {
    id: "pickaxe_from_wood",
    name: "1 Pickaxe from 2 Wood",
    ingredients: [{ id: BlockType.WOOD, count: 2 }],
    output: { id: BlockType.PICKAXE, count: 1 },
    requiresTable: true,
  },
  {
    id: "axe_from_wood",
    name: "1 Axe from 2 Wood",
    ingredients: [{ id: BlockType.WOOD, count: 2 }],
    output: { id: BlockType.AXE, count: 1 },
    requiresTable: true,
  },
  {
    id: "shovel_from_wood",
    name: "1 Shovel from 1 Wood",
    ingredients: [{ id: BlockType.WOOD, count: 1 }],
    output: { id: BlockType.SHOVEL, count: 1 },
    requiresTable: true,
  },
  // Iron pickaxe: mines 5x faster than wood. Requires iron ore + wood.
  {
    id: "iron_pickaxe",
    name: "1 Iron Pickaxe from 3 Iron Ore + 2 Wood",
    ingredients: [
      { id: BlockType.IRON_ORE, count: 3 },
      { id: BlockType.WOOD, count: 2 },
    ],
    output: { id: BlockType.IRON_PICKAXE, count: 1 },
    requiresTable: true,
  },
  // Diamond pickaxe: mines 10x faster, required for ruby ore. Very expensive.
  {
    id: "diamond_pickaxe",
    name: "1 Diamond Pickaxe from 3 Diamond Ore + 2 Wood",
    ingredients: [
      { id: BlockType.DIAMOND_ORE, count: 3 },
      { id: BlockType.WOOD, count: 2 },
    ],
    output: { id: BlockType.DIAMOND_PICKAXE, count: 1 },
    requiresTable: true,
  },

  // Wool / bedding — sheep's wool makes beds (no longer require wood).
  {
    id: "bed_from_wool_planks",
    name: "1 Bed from 3 Wool + 3 Planks",
    ingredients: [
      { id: BlockType.WOOL, count: 3 },
      { id: BlockType.PLANKS, count: 3 },
    ],
    output: { id: BlockType.BED, count: 1 },
    requiresTable: true,
  },
  // Legacy bed recipe still works for players without sheep.
  {
    id: "bed_from_planks_wood",
    name: "1 Bed from 3 Planks + 1 Wood",
    ingredients: [
      { id: BlockType.PLANKS, count: 3 },
      { id: BlockType.WOOD, count: 1 },
    ],
    output: { id: BlockType.BED, count: 1 },
    requiresTable: true,
  },

  // Building blocks
  {
    id: "brick_from_stone_sand",
    name: "2 Bricks from 2 Stone + 1 Sand",
    ingredients: [
      { id: BlockType.STONE, count: 2 },
      { id: BlockType.SAND, count: 1 },
    ],
    output: { id: BlockType.BRICK, count: 2 },
    requiresTable: true,
  },
  {
    id: "glass_from_sand",
    name: "1 Glass from 2 Sand",
    ingredients: [{ id: BlockType.SAND, count: 2 }],
    output: { id: BlockType.GLASS, count: 1 },
    requiresTable: true,
  },
  {
    id: "mossy_cobble_from_cobble_leaves",
    name: "2 Mossy Cobble from 2 Cobble + 2 Leaves",
    ingredients: [
      { id: BlockType.COBBLE, count: 2 },
      { id: BlockType.LEAVES, count: 2 },
    ],
    output: { id: BlockType.MOSSY_COBBLE, count: 2 },
    requiresTable: true,
  },
  {
    id: "leaves_from_wood_grass",
    name: "2 Leaves from 1 Wood + 1 Grass",
    ingredients: [
      { id: BlockType.WOOD, count: 1 },
      { id: BlockType.GRASS, count: 1 },
    ],
    output: { id: BlockType.LEAVES, count: 2 },
    requiresTable: true,
  },
  {
    id: "snow_from_sand_dirt",
    name: "1 Snow from 1 Sand + 1 Dirt",
    ingredients: [
      { id: BlockType.SAND, count: 1 },
      { id: BlockType.DIRT, count: 1 },
    ],
    output: { id: BlockType.SNOW, count: 1 },
    requiresTable: true,
  },

  // Decorative — flowers and tall grass from natural blocks
  {
    id: "flower_from_grass_leaves",
    name: "2 Flowers from 1 Grass + 1 Leaves",
    ingredients: [
      { id: BlockType.GRASS, count: 1 },
      { id: BlockType.LEAVES, count: 1 },
    ],
    output: { id: BlockType.FLOWER, count: 2 },
    requiresTable: true,
  },
  {
    id: "tall_grass_from_grass",
    name: "4 Tall Grass from 1 Grass",
    ingredients: [{ id: BlockType.GRASS, count: 1 }],
    output: { id: BlockType.TALL_GRASS, count: 4 },
    requiresTable: true,
  },

  // Door: a placeable wooden door that opens/closes on tap. Used in
  // villager houses and player builds.
  {
    id: "door_from_planks",
    name: "1 Door from 6 Planks",
    ingredients: [{ id: BlockType.PLANKS, count: 6 }],
    output: { id: BlockType.DOOR, count: 1 },
    requiresTable: true,
  },
  // Hay bale: compact wheat-equivalent (tall grass) for decoration/farms.
  {
    id: "hay_from_grass",
    name: "1 Hay Bale from 4 Tall Grass",
    ingredients: [{ id: BlockType.TALL_GRASS, count: 4 }],
    output: { id: BlockType.HAY, count: 1 },
    requiresTable: true,
  },
];

// Basic recipes (craftable without a table)
export const BASIC_RECIPES = RECIPES.filter((r) => !r.requiresTable);

export function canCraft(inv: Inventory, recipe: Recipe): boolean {
  return recipe.ingredients.every((ing) => inv.has(ing.id, ing.count));
}

// Returns true if crafting succeeded (ingredients removed, output added).
export function craft(inv: Inventory, recipe: Recipe): boolean {
  if (!canCraft(inv, recipe)) return false;
  for (const ing of recipe.ingredients) {
    inv.remove(ing.id, ing.count);
  }
  inv.add(recipe.output.id, recipe.output.count);
  return true;
}
