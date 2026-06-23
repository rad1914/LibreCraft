// Procedurally generates a 16x16 pixel-art texture atlas for all blocks
// using a canvas. Each block gets 3 textures (top, side, bottom) packed
// into a single atlas image so the chunk mesher can use one shared
// material with nearest-neighbor sampling for the pixel-perfect look.
//
// Atlas layout: each row holds textures for one block; columns are
// top/side/bottom. With 14 blocks at 16x16 each, the atlas is 48x224.
// We bump tile size to 16 with no padding to keep UV math simple.

import * as THREE from "three";
import { BlockType } from "./blocks";
import { mulberry32, hashStr } from "./rng";

export const TILE = 16; // pixels per tile
export const TILES_PER_ROW = 3; // top, side, bottom

interface TextureSpec {
  base: string; // base fill color (hex)
  noise: string; // noise speckle color (hex)
  noiseAmount: number; // 0..1 fraction of pixels to speckle
  pattern?: "grass_top" | "grass_side" | "wood_side" | "wood_top" | "leaves" | "brick" | "cobble" | "stone" | "sand" | "water" | "snow" | "glass" | "planks" | "dirt" | "bedrock" | "wool" | "flower_top" | "flower_side" | "tall_grass" | "mossy_cobble" | "coal_ore" | "iron_ore" | "diamond_ore" | "ruby_ore" | "coal" | "grave_top" | "grave_side" | "portal" | "portal_sky" | "ruby" | "iron_pickaxe" | "diamond_pickaxe" | "hay" | "door_top" | "door_side";
}

// Per-block, per-face texture specs. Patterns draw extra details on top
// of the base+noise fill to evoke Minecraft's iconic look.
const SPECS: Record<number, [TextureSpec, TextureSpec, TextureSpec]> = {
  [BlockType.GRASS]: [
    { base: "#6aa84f", noise: "#5b9245", noiseAmount: 0.4, pattern: "grass_top" },
    { base: "#8b6b3a", noise: "#6e5430", noiseAmount: 0.3, pattern: "grass_side" },
    { base: "#8b5a2b", noise: "#6e4521", noiseAmount: 0.3, pattern: "dirt" },
  ],
  [BlockType.DIRT]: [
    { base: "#8b5a2b", noise: "#6e4521", noiseAmount: 0.35, pattern: "dirt" },
    { base: "#8b5a2b", noise: "#6e4521", noiseAmount: 0.35, pattern: "dirt" },
    { base: "#6b4421", noise: "#553619", noiseAmount: 0.35, pattern: "dirt" },
  ],
  [BlockType.STONE]: [
    { base: "#888888", noise: "#6f6f6f", noiseAmount: 0.45, pattern: "stone" },
    { base: "#7a7a7a", noise: "#656565", noiseAmount: 0.45, pattern: "stone" },
    { base: "#666666", noise: "#525252", noiseAmount: 0.45, pattern: "stone" },
  ],
  [BlockType.SAND]: [
    { base: "#eed9a1", noise: "#dcc285", noiseAmount: 0.35, pattern: "sand" },
    { base: "#e0c886", noise: "#c9b36a", noiseAmount: 0.35, pattern: "sand" },
    { base: "#c9b36a", noise: "#b39a55", noiseAmount: 0.35, pattern: "sand" },
  ],
  [BlockType.WOOD]: [
    { base: "#b5894a", noise: "#a07938", noiseAmount: 0.25, pattern: "wood_top" },
    { base: "#6e4f2a", noise: "#553a1f", noiseAmount: 0.3, pattern: "wood_side" },
    { base: "#b5894a", noise: "#a07938", noiseAmount: 0.25, pattern: "wood_top" },
  ],
  [BlockType.LEAVES]: [
    { base: "#3f7a32", noise: "#2e5a23", noiseAmount: 0.55, pattern: "leaves" },
    { base: "#356b2b", noise: "#264a1f", noiseAmount: 0.55, pattern: "leaves" },
    { base: "#2c5a23", noise: "#1f3f1a", noiseAmount: 0.55, pattern: "leaves" },
  ],
  [BlockType.WATER]: [
    { base: "#3a6fd8", noise: "#2f5fc0", noiseAmount: 0.3, pattern: "water" },
    { base: "#3a6fd8", noise: "#2f5fc0", noiseAmount: 0.3, pattern: "water" },
    { base: "#2a5fc0", noise: "#214fa0", noiseAmount: 0.3, pattern: "water" },
  ],
  [BlockType.SNOW]: [
    { base: "#f5f7fa", noise: "#e0e6ee", noiseAmount: 0.25, pattern: "snow" },
    { base: "#eef2f7", noise: "#d8dde6", noiseAmount: 0.25, pattern: "snow" },
    { base: "#d8dde6", noise: "#c0c6d0", noiseAmount: 0.25, pattern: "snow" },
  ],
  [BlockType.BEDROCK]: [
    { base: "#333333", noise: "#1a1a1a", noiseAmount: 0.55, pattern: "bedrock" },
    { base: "#2a2a2a", noise: "#141414", noiseAmount: 0.55, pattern: "bedrock" },
    { base: "#222222", noise: "#0f0f0f", noiseAmount: 0.55, pattern: "bedrock" },
  ],
  [BlockType.PLANKS]: [
    { base: "#b88b4a", noise: "#a07938", noiseAmount: 0.25, pattern: "planks" },
    { base: "#a67a3f", noise: "#8a6630", noiseAmount: 0.25, pattern: "planks" },
    { base: "#8a6630", noise: "#735224", noiseAmount: 0.25, pattern: "planks" },
  ],
  [BlockType.COBBLE]: [
    { base: "#7d7d7d", noise: "#5c5c5c", noiseAmount: 0.5, pattern: "cobble" },
    { base: "#6f6f6f", noise: "#4f4f4f", noiseAmount: 0.5, pattern: "cobble" },
    { base: "#5c5c5c", noise: "#3f3f3f", noiseAmount: 0.5, pattern: "cobble" },
  ],
  [BlockType.BRICK]: [
    { base: "#9c4a32", noise: "#7d3825", noiseAmount: 0.3, pattern: "brick" },
    { base: "#8a3f2a", noise: "#6d2f1f", noiseAmount: 0.3, pattern: "brick" },
    { base: "#703322", noise: "#532516", noiseAmount: 0.3, pattern: "brick" },
  ],
  [BlockType.GLASS]: [
    { base: "#bfe3ee", noise: "#9cc8d6", noiseAmount: 0.1, pattern: "glass" },
    { base: "#bfe3ee", noise: "#9cc8d6", noiseAmount: 0.1, pattern: "glass" },
    { base: "#bfe3ee", noise: "#9cc8d6", noiseAmount: 0.1, pattern: "glass" },
  ],
  [BlockType.TORCH]: [
    { base: "#ffaa33", noise: "#ff8800", noiseAmount: 0.5, pattern: "torch_top" },
    { base: "#8b5a2b", noise: "#6b4421", noiseAmount: 0.3, pattern: "torch_side" },
    { base: "#6b4421", noise: "#553619", noiseAmount: 0.3, pattern: "dirt" },
  ],
  [BlockType.BED]: [
    { base: "#cc3333", noise: "#aa2222", noiseAmount: 0.2, pattern: "bed_top" },
    { base: "#cc3333", noise: "#aa2222", noiseAmount: 0.2, pattern: "bed_side" },
    { base: "#6b4421", noise: "#553619", noiseAmount: 0.3, pattern: "planks" },
  ],
  [BlockType.CRAFTING_TABLE]: [
    { base: "#8b5a2b", noise: "#6b4421", noiseAmount: 0.2, pattern: "crafting_top" },
    { base: "#6b4421", noise: "#553619", noiseAmount: 0.2, pattern: "planks" },
    { base: "#6b4421", noise: "#553619", noiseAmount: 0.2, pattern: "planks" },
  ],
  [BlockType.WOOL]: [
    { base: "#eeeeee", noise: "#dddddd", noiseAmount: 0.45, pattern: "wool" },
    { base: "#dddddd", noise: "#cccccc", noiseAmount: 0.45, pattern: "wool" },
    { base: "#cccccc", noise: "#bbbbbb", noiseAmount: 0.45, pattern: "wool" },
  ],
  [BlockType.FLOWER]: [
    { base: "#2ecc71", noise: "#25a358", noiseAmount: 0.2, pattern: "flower_top" },
    { base: "#cc4444", noise: "#993333", noiseAmount: 0.2, pattern: "flower_side" },
    { base: "#2ecc71", noise: "#25a358", noiseAmount: 0.2, pattern: "flower_top" },
  ],
  [BlockType.TALL_GRASS]: [
    { base: "#5b9245", noise: "#4a7d3a", noiseAmount: 0.4, pattern: "tall_grass" },
    { base: "#5b9245", noise: "#4a7d3a", noiseAmount: 0.4, pattern: "tall_grass" },
    { base: "#5b9245", noise: "#4a7d3a", noiseAmount: 0.4, pattern: "tall_grass" },
  ],
  [BlockType.MOSSY_COBBLE]: [
    { base: "#6a7a55", noise: "#5a6a4a", noiseAmount: 0.5, pattern: "mossy_cobble" },
    { base: "#5a6a4a", noise: "#4a5a3a", noiseAmount: 0.5, pattern: "mossy_cobble" },
    { base: "#4a5a3a", noise: "#3a4a2a", noiseAmount: 0.5, pattern: "mossy_cobble" },
  ],
  [BlockType.COAL_ORE]: [
    { base: "#444444", noise: "#3a3a3a", noiseAmount: 0.4, pattern: "coal_ore" },
    { base: "#3a3a3a", noise: "#2e2e2e", noiseAmount: 0.4, pattern: "coal_ore" },
    { base: "#2e2e2e", noise: "#222222", noiseAmount: 0.4, pattern: "coal_ore" },
  ],
  [BlockType.IRON_ORE]: [
    { base: "#a09080", noise: "#908074", noiseAmount: 0.4, pattern: "iron_ore" },
    { base: "#908074", noise: "#807064", noiseAmount: 0.4, pattern: "iron_ore" },
    { base: "#807064", noise: "#706058", noiseAmount: 0.4, pattern: "iron_ore" },
  ],
  [BlockType.DIAMOND_ORE]: [
    { base: "#3a5a6a", noise: "#2a4a5a", noiseAmount: 0.35, pattern: "diamond_ore" },
    { base: "#2a4a5a", noise: "#1a3a4a", noiseAmount: 0.35, pattern: "diamond_ore" },
    { base: "#1a3a4a", noise: "#0a2a3a", noiseAmount: 0.35, pattern: "diamond_ore" },
  ],
  [BlockType.PORTAL]: [
    { base: "#2a8a9a", noise: "#1a7a8a", noiseAmount: 0.5, pattern: "portal_sky" },
    { base: "#1a7a8a", noise: "#0a6a7a", noiseAmount: 0.5, pattern: "portal_sky" },
    { base: "#0a6a7a", noise: "#005a6a", noiseAmount: 0.5, pattern: "portal_sky" },
  ],
  [BlockType.PORTAL_SKY]: [
    { base: "#2a8a9a", noise: "#1a7a8a", noiseAmount: 0.5, pattern: "portal_sky" },
    { base: "#1a7a8a", noise: "#0a6a7a", noiseAmount: 0.5, pattern: "portal_sky" },
    { base: "#0a6a7a", noise: "#005a6a", noiseAmount: 0.5, pattern: "portal_sky" },
  ],
  [BlockType.RUBY_ORE]: [
    { base: "#5a1a1a", noise: "#4a0a0a", noiseAmount: 0.35, pattern: "ruby_ore" },
    { base: "#4a0a0a", noise: "#3a0000", noiseAmount: 0.35, pattern: "ruby_ore" },
    { base: "#3a0000", noise: "#2a0000", noiseAmount: 0.35, pattern: "ruby_ore" },
  ],
  [BlockType.HAY]: [
    { base: "#c9a04a", noise: "#a88838", noiseAmount: 0.4, pattern: "hay" },
    { base: "#b08a3a", noise: "#8a6a28", noiseAmount: 0.4, pattern: "hay" },
    { base: "#8a6a28", noise: "#6a5018", noiseAmount: 0.4, pattern: "hay" },
  ],
  [BlockType.DOOR]: [
    { base: "#a67a3f", noise: "#8a6630", noiseAmount: 0.25, pattern: "door_top" },
    { base: "#a67a3f", noise: "#8a6630", noiseAmount: 0.25, pattern: "door_side" },
    { base: "#6b4421", noise: "#553619", noiseAmount: 0.25, pattern: "door_side" },
  ],
  [BlockType.GRAVE]: [
    { base: "#4a4a4a", noise: "#3a3a3a", noiseAmount: 0.35, pattern: "grave_top" },
    { base: "#3a3a3a", noise: "#2a2a2a", noiseAmount: 0.35, pattern: "grave_side" },
    { base: "#2a2a2a", noise: "#1a1a1a", noiseAmount: 0.35, pattern: "grave_side" },
  ],
  [BlockType.FOOD]: [
    { base: "#cc4444", noise: "#aa3333", noiseAmount: 0.3, pattern: "food" },
    { base: "#cc4444", noise: "#aa3333", noiseAmount: 0.3, pattern: "food" },
    { base: "#cc4444", noise: "#aa3333", noiseAmount: 0.3, pattern: "food" },
  ],
  [BlockType.SWORD]: [
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "sword" },
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "sword" },
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "sword" },
  ],
  [BlockType.PICKAXE]: [
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "pickaxe" },
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "pickaxe" },
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "pickaxe" },
  ],
  [BlockType.AXE]: [
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "axe" },
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "axe" },
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "axe" },
  ],
  [BlockType.SHOVEL]: [
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "shovel" },
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "shovel" },
    { base: "#c0c0c0", noise: "#999999", noiseAmount: 0.2, pattern: "shovel" },
  ],
  [BlockType.COAL]: [
    { base: "#1a1a1a", noise: "#0a0a0a", noiseAmount: 0.4, pattern: "coal" },
    { base: "#1a1a1a", noise: "#0a0a0a", noiseAmount: 0.4, pattern: "coal" },
    { base: "#1a1a1a", noise: "#0a0a0a", noiseAmount: 0.4, pattern: "coal" },
  ],
  [BlockType.RUBY]: [
    { base: "#e02020", noise: "#a01010", noiseAmount: 0.3, pattern: "ruby" },
    { base: "#e02020", noise: "#a01010", noiseAmount: 0.3, pattern: "ruby" },
    { base: "#e02020", noise: "#a01010", noiseAmount: 0.3, pattern: "ruby" },
  ],
  [BlockType.IRON_PICKAXE]: [
    { base: "#d0d0d0", noise: "#999999", noiseAmount: 0.2, pattern: "iron_pickaxe" },
    { base: "#d0d0d0", noise: "#999999", noiseAmount: 0.2, pattern: "iron_pickaxe" },
    { base: "#d0d0d0", noise: "#999999", noiseAmount: 0.2, pattern: "iron_pickaxe" },
  ],
  [BlockType.DIAMOND_PICKAXE]: [
    { base: "#60e0e0", noise: "#40c0c0", noiseAmount: 0.2, pattern: "diamond_pickaxe" },
    { base: "#60e0e0", noise: "#40c0c0", noiseAmount: 0.2, pattern: "diamond_pickaxe" },
    { base: "#60e0e0", noise: "#40c0c0", noiseAmount: 0.2, pattern: "diamond_pickaxe" },
  ],
};

let cachedAtlas: { texture: THREE.Texture; rows: number; canvas: HTMLCanvasElement } | null = null;

// Generate (or return cached) the texture atlas. Returns a THREE.Texture
// configured with NearestFilter for pixel-perfect rendering.
export function getTextureAtlas(): { texture: THREE.Texture; rows: number; canvas: HTMLCanvasElement } {
  if (cachedAtlas) return cachedAtlas;

  const blockIds = Object.keys(SPECS).map(Number);
  const rows = blockIds.length;
  const width = TILES_PER_ROW * TILE;
  const height = rows * TILE;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Map block id -> row index for UV lookup later
  const rowById = new Map<number, number>();
  blockIds.forEach((id, i) => {
    rowById.set(id, i);
    const [top, side, bot] = SPECS[id];
    drawTile(ctx, 0 * TILE, i * TILE, top);
    drawTile(ctx, 1 * TILE, i * TILE, side);
    drawTile(ctx, 2 * TILE, i * TILE, bot);
  });

  // Save row map on the texture for the mesher to read
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  // Attach rowById to the texture for the mesher
  (texture as unknown as { _rowById: Map<number, number> })._rowById = rowById;

  cachedAtlas = { texture, rows, canvas };
  return cachedAtlas;
}

// Helper to fetch the row index for a block id (used by the chunk mesher).
export function getTileRow(texture: THREE.Texture, blockId: number): number {
  const rowById = (texture as unknown as { _rowById?: Map<number, number> })._rowById;
  if (!rowById) return 0;
  return rowById.get(blockId) ?? 0;
}

// Render a single block tile to a data URL. Used by the hotbar UI to
// display real block textures instead of solid color swatches.
export function getBlockIconDataURL(blockId: number, faceKind: "top" | "side" | "bottom" = "side"): string {
  const atlas = getTextureAtlas();
  const texture = atlas.texture;
  const row = getTileRow(texture, blockId);
  const colU = faceColumnU(faceKind);
  const srcX = colU * TILE;
  const srcY = row * TILE;

  // Blit the tile to a small standalone canvas at native resolution.
  const out = document.createElement("canvas");
  out.width = TILE;
  out.height = TILE;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(atlas.canvas, srcX, srcY, TILE, TILE, 0, 0, TILE, TILE);
  return out.toDataURL("image/png");
}

function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, spec: TextureSpec) {
  // Sprite blocks (flowers, tall grass, torches) start with a transparent
  // tile — only the plant/torch pixels are drawn, so the crossed-quad
  // geometry shows the shape instead of a solid colored cube.
  if (spec.pattern === "flower_top" || spec.pattern === "flower_side"
      || spec.pattern === "tall_grass"
      || spec.pattern === "torch_top" || spec.pattern === "torch_side") {
    ctx.clearRect(x, y, TILE, TILE);
    // Skip the base+noise fill; jump straight to the pattern overlay.
    const rng = mulberry32(hashStr(spec.base + spec.noise + spec.pattern));
    drawPattern(ctx, x, y, spec, rng);
    return;
  }

  // Base fill
  ctx.fillStyle = spec.base;
  ctx.fillRect(x, y, TILE, TILE);

  // Deterministic noise per pixel so textures look the same every run
  const rng = mulberry32(hashStr(spec.base + spec.noise + spec.pattern));

  // Enhanced noise: per-pixel brightness variation for a more natural,
  // less flat look. Each pixel gets a subtle random shade shift.
  const baseR = parseInt(spec.base.slice(1, 3), 16);
  const baseG = parseInt(spec.base.slice(3, 5), 16);
  const baseB = parseInt(spec.base.slice(5, 7), 16);
  for (let py = 0; py < TILE; py++) {
    for (let px = 0; px < TILE; px++) {
      const r = rng();
      if (r < spec.noiseAmount) {
        // Stronger variation: mix between noise color and darker/lighter shades
        const variation = rng();
        if (variation < 0.3) {
          ctx.fillStyle = spec.noise;
        } else if (variation < 0.6) {
          ctx.fillStyle = darken(spec.base, 0.75 + rng() * 0.15);
        } else {
          ctx.fillStyle = lighten(spec.base, 0.1 + rng() * 0.15);
        }
        ctx.fillRect(x + px, y + py, 1, 1);
      } else if (rng() < 0.3) {
        // Subtle per-pixel brightness for non-noise pixels too
        const shift = (rng() - 0.5) * 20;
        const nr = Math.max(0, Math.min(255, baseR + shift));
        const ng = Math.max(0, Math.min(255, baseG + shift));
        const nb = Math.max(0, Math.min(255, baseB + shift));
        ctx.fillStyle = `rgb(${nr|0},${ng|0},${nb|0})`;
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
  }

  // Pattern overlay
  drawPattern(ctx, x, y, spec, rng);
}

// Draw the pattern overlay for a tile. Extracted so sprite blocks can
// call it directly (skipping the base+noise fill).
function drawPattern(ctx: CanvasRenderingContext2D, x: number, y: number, spec: TextureSpec, rng: () => number) {
  switch (spec.pattern) {
    case "grass_top":
      drawGrassTop(ctx, x, y, rng);
      break;
    case "grass_side":
      drawGrassSide(ctx, x, y, rng);
      break;
    case "dirt":
      // already done by noise; add a few darker specks
      drawSpots(ctx, x, y, rng, "#5a3a1a", 6);
      break;
    case "stone":
      drawSpots(ctx, x, y, rng, "#525252", 5);
      drawSpots(ctx, x, y, rng, "#9a9a9a", 3);
      break;
    case "cobble":
      drawCobble(ctx, x, y, rng);
      break;
    case "sand":
      drawSpots(ctx, x, y, rng, "#b39a55", 4);
      break;
    case "wood_side":
      drawWoodSide(ctx, x, y);
      break;
    case "wood_top":
      drawWoodTop(ctx, x, y);
      break;
    case "leaves":
      drawSpots(ctx, x, y, rng, "#1f3f1a", 8);
      drawSpots(ctx, x, y, rng, "#4f8a3f", 4);
      break;
    case "water":
      drawWater(ctx, x, y);
      break;
    case "snow":
      drawSpots(ctx, x, y, rng, "#ffffff", 3);
      break;
    case "planks":
      drawPlanks(ctx, x, y);
      break;
    case "brick":
      drawBrick(ctx, x, y);
      break;
    case "glass":
      drawGlass(ctx, x, y);
      break;
    case "torch_top":
      drawTorchTop(ctx, x, y, rng);
      break;
    case "torch_side":
      drawTorchSide(ctx, x, y);
      break;
    case "food":
      drawFood(ctx, x, y, rng);
      break;
    case "bed_top":
      drawBedTop(ctx, x, y);
      break;
    case "bed_side":
      drawBedSide(ctx, x, y);
      break;
    case "crafting_top":
      drawCraftingTop(ctx, x, y);
      break;
    case "sword":
      drawSword(ctx, x, y);
      break;
    case "pickaxe":
      drawPickaxe(ctx, x, y);
      break;
    case "axe":
      drawAxe(ctx, x, y);
      break;
    case "shovel":
      drawShovel(ctx, x, y);
      break;
    case "bedrock":
      drawSpots(ctx, x, y, rng, "#000000", 8);
      drawSpots(ctx, x, y, rng, "#4a4a4a", 4);
      break;
    case "wool":
      drawWool(ctx, x, y, rng);
      break;
    case "flower_top":
      drawFlowerTop(ctx, x, y);
      break;
    case "flower_side":
      drawFlowerSide(ctx, x, y);
      break;
    case "tall_grass":
      drawTallGrass(ctx, x, y, rng);
      break;
    case "mossy_cobble":
      drawMossyCobble(ctx, x, y, rng);
      break;
    case "coal_ore":
      drawOre(ctx, x, y, rng, "#0a0a0a");
      break;
    case "iron_ore":
      drawOre(ctx, x, y, rng, "#c8a878");
      break;
    case "diamond_ore":
      drawOre(ctx, x, y, rng, "#4ee8e8");
      break;
    case "ruby_ore":
      drawOre(ctx, x, y, rng, "#ff2020");
      break;
    case "coal":
      drawSpots(ctx, x, y, rng, "#000000", 6);
      drawSpots(ctx, x, y, rng, "#3a3a3a", 4);
      break;
    case "grave_top":
      drawGraveTop(ctx, x, y);
      break;
    case "grave_side":
      drawGraveSide(ctx, x, y);
      break;
    case "portal":
      drawPortal(ctx, x, y, rng);
      break;
    case "portal_sky":
      drawPortal(ctx, x, y, rng, true);
      break;
    case "ruby":
      drawRuby(ctx, x, y, rng);
      break;
    case "iron_pickaxe":
      drawPickaxeTiered(ctx, x, y, "#d0d0d0", "#999999");
      break;
    case "diamond_pickaxe":
      drawPickaxeTiered(ctx, x, y, "#60e0e0", "#40c0c0");
      break;
    case "hay":
      drawHay(ctx, x, y);
      break;
    case "door_top":
      drawDoorTop(ctx, x, y);
      break;
    case "door_side":
      drawDoorSide(ctx, x, y);
      break;
  }
}

function drawGrassTop(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number) {
  // Sprinkle brighter blades
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = rng() < 0.5 ? "#7cb858" : "#5b9245";
    ctx.fillRect(x + Math.floor(rng() * TILE), y + Math.floor(rng() * TILE), 1, 1);
  }
}

// Draw the iconic grass side: dirt base with a green strip (3-4 px
// tall) at the TOP of the tile, with a few irregular dripping pixels
// below the strip for a natural transition.
function drawGrassSide(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number) {
  // Top 4 rows: solid green with slight noise
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < TILE; px++) {
      const r = rng();
      if (r < 0.5) ctx.fillStyle = "#6aa84f";
      else if (r < 0.85) ctx.fillStyle = "#5b9245";
      else ctx.fillStyle = "#7cb858";
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // A few drips/teeth hanging below the green strip
  for (let px = 0; px < TILE; px++) {
    if (rng() < 0.4) {
      const drip = 1 + Math.floor(rng() * 2);
      ctx.fillStyle = rng() < 0.5 ? "#6aa84f" : "#5b9245";
      for (let py = 4; py < 4 + drip; py++) {
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
  }
}

function drawSpots(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number, color: string, count: number) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.fillRect(x + Math.floor(rng() * TILE), y + Math.floor(rng() * TILE), 1, 1);
  }
}

function drawCobble(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number) {
  // Random dark cracks forming cobble chunks
  ctx.fillStyle = "#3f3f3f";
  // Horizontal & vertical cracks
  for (let i = 0; i < 3; i++) {
    const py = 2 + Math.floor(rng() * 12);
    for (let px = 0; px < TILE; px++) ctx.fillRect(x + px, y + py, 1, 1);
  }
  for (let i = 0; i < 3; i++) {
    const px = 2 + Math.floor(rng() * 12);
    for (let py = 0; py < TILE; py++) ctx.fillRect(x + px, y + py, 1, 1);
  }
  // Lighter highlights on a few "stones"
  ctx.fillStyle = "#9a9a9a";
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 1 + Math.floor(rng() * 5), y + 1 + Math.floor(rng() * 5), 1, 1);
    ctx.fillRect(x + 9 + Math.floor(rng() * 5), y + 1 + Math.floor(rng() * 5), 1, 1);
  }
}

function drawWoodSide(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Vertical bark streaks
  ctx.fillStyle = "#553a1f";
  for (let py = 0; py < TILE; py++) {
    ctx.fillRect(x + 2, y + py, 1, 1);
    ctx.fillRect(x + 7, y + py, 1, 1);
    ctx.fillRect(x + 12, y + py, 1, 1);
  }
  ctx.fillStyle = "#8a6233";
  for (let py = 0; py < TILE; py++) {
    ctx.fillRect(x + 5, y + py, 1, 1);
    ctx.fillRect(x + 10, y + py, 1, 1);
  }
}

function drawWoodTop(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Concentric rings
  ctx.strokeStyle = "#7a5a2a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x + 8, y + 8, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 8, y + 8, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#6e4f2a";
  ctx.fillRect(x + 7, y + 7, 2, 2);
}

function drawWater(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Horizontal wave lines
  ctx.fillStyle = "#5a8fe0";
  for (let py = 2; py < TILE; py += 4) {
    for (let px = 0; px < TILE; px += 1) {
      if ((px + py) % 3 === 0) ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function drawPlanks(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Horizontal plank seams every 4 px
  ctx.fillStyle = "#735224";
  for (let py = 3; py < TILE; py += 4) {
    for (let px = 0; px < TILE; px++) ctx.fillRect(x + px, y + py, 1, 1);
  }
  // Vertical board breaks alternating
  ctx.fillStyle = "#5a3f1a";
  ctx.fillRect(x + 7, y + 0, 1, 4);
  ctx.fillRect(x + 3, y + 4, 1, 4);
  ctx.fillRect(x + 11, y + 4, 1, 4);
  ctx.fillRect(x + 7, y + 8, 1, 4);
  ctx.fillRect(x + 3, y + 12, 1, 4);
  ctx.fillRect(x + 11, y + 12, 1, 4);
}

function drawBrick(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Mortar lines
  ctx.fillStyle = "#cfcfcf";
  // Horizontal mortar every 4px
  for (let py = 3; py < TILE; py += 4) {
    for (let px = 0; px < TILE; px++) ctx.fillRect(x + px, y + py, 1, 1);
  }
  // Vertical mortar, offset per row
  for (let row = 0; row < 4; row++) {
    const offset = row % 2 === 0 ? 0 : 4;
    const py = row * 4;
    for (let i = 0; i < 3; i++) {
      const px = (offset + i * 8) % TILE;
      for (let dy = 0; dy < 3; dy++) ctx.fillRect(x + px, y + py + dy, 1, 1);
    }
  }
}

function drawGlass(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Border frame
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < TILE; i++) {
    ctx.fillRect(x + i, y + 0, 1, 1);
    ctx.fillRect(x + i, y + TILE - 1, 1, 1);
    ctx.fillRect(x + 0, y + i, 1, 1);
    ctx.fillRect(x + TILE - 1, y + i, 1, 1);
  }
  // Diagonal highlight
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 3, y + 3, 1, 1);
  ctx.fillRect(x + 4, y + 4, 1, 1);
  ctx.fillRect(x + 5, y + 5, 1, 1);
}

// Torch top: bright flame center with darker surround.
function drawTorchTop(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number) {
  // Bright flame pixels in the center 4x4
  for (let py = 5; py < 11; py++) {
    for (let px = 5; px < 11; px++) {
      const r = rng();
      if (r < 0.4) ctx.fillStyle = "#ffff80";
      else if (r < 0.8) ctx.fillStyle = "#ffcc44";
      else ctx.fillStyle = "#ff8800";
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

// Torch side: stick (brown) in the center column with a flame tip at top.
function drawTorchSide(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Flame tip (top 3 rows, center 4 px)
  ctx.fillStyle = "#ffcc44";
  ctx.fillRect(x + 6, y + 1, 4, 2);
  ctx.fillStyle = "#ffff80";
  ctx.fillRect(x + 7, y + 0, 2, 1);
  // Stick (center 2 px, below flame)
  ctx.fillStyle = "#6b4421";
  for (let py = 3; py < TILE; py++) {
    ctx.fillRect(x + 7, y + py, 2, 1);
  }
  ctx.fillStyle = "#8b5a2b";
  for (let py = 3; py < TILE; py++) {
    ctx.fillRect(x + 7, y + py, 1, 1);
  }
}

// Food: a red apple-like blob with a darker stem and a highlight.
function drawFood(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number) {
  // Stem (top center, dark brown)
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(x + 7, y + 2, 2, 2);
  // Body (rounded red blob)
  ctx.fillStyle = "#dd5555";
  for (let py = 4; py < 14; py++) {
    const w = py < 8 ? py - 2 : 12 - (py - 8);
    const startX = 8 - Math.floor(w / 2);
    for (let px = 0; px < w; px++) {
      ctx.fillRect(x + startX + px, y + py, 1, 1);
    }
  }
  // Highlight (lighter red, upper-left)
  ctx.fillStyle = "#ff8888";
  ctx.fillRect(x + 5, y + 5, 2, 2);
  ctx.fillRect(x + 6, y + 7, 1, 1);
  // Darker specks for texture
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = "#aa3333";
    ctx.fillRect(x + 4 + Math.floor(rng() * 8), y + 6 + Math.floor(rng() * 6), 1, 1);
  }
}

// Bed top: red pillow area on a wooden frame.
function drawBedTop(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Wooden frame border
  ctx.fillStyle = "#6b4421";
  for (let i = 0; i < TILE; i++) {
    ctx.fillRect(x + i, y + 0, 1, 1);
    ctx.fillRect(x + i, y + TILE - 1, 1, 1);
    ctx.fillRect(x + 0, y + i, 1, 1);
    ctx.fillRect(x + TILE - 1, y + i, 1, 1);
  }
  // Red blanket (center area)
  ctx.fillStyle = "#cc3333";
  ctx.fillRect(x + 2, y + 2, 12, 9);
  // Pillow (white, top portion)
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(x + 3, y + 3, 10, 3);
  // Pillow shadow
  ctx.fillStyle = "#cccccc";
  ctx.fillRect(x + 3, y + 5, 10, 1);
}

// Bed side: red blanket with wooden legs.
function drawBedSide(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Wooden legs (bottom corners)
  ctx.fillStyle = "#6b4421";
  ctx.fillRect(x + 1, y + 12, 2, 4);
  ctx.fillRect(x + 13, y + 12, 2, 4);
  // Red blanket
  ctx.fillStyle = "#cc3333";
  ctx.fillRect(x + 1, y + 3, 14, 8);
  // Blanket stripe
  ctx.fillStyle = "#aa2222";
  ctx.fillRect(x + 1, y + 7, 14, 1);
}

// Wool: soft woven texture with subtle crosshatch strands.
function drawWool(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number) {
  // Faint horizontal strands every 2-3 px
  ctx.fillStyle = "#bbbbbb";
  for (let py = 1; py < TILE; py += 3) {
    for (let px = 0; px < TILE; px++) {
      if (rng() < 0.7) ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
  // Faint vertical strands
  ctx.fillStyle = "#cccccc";
  for (let px = 2; px < TILE; px += 4) {
    for (let py = 0; py < TILE; py++) {
      if (rng() < 0.4) ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

// Flower top: a small green cross (leaves) — flower is rendered as a
// cross-shape sprite, not a full block, so the top is mostly transparent.
function drawFlowerTop(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#2ecc71";
  // Center 4x4 leaf cluster
  ctx.fillRect(x + 6, y + 6, 4, 4);
  ctx.fillRect(x + 5, y + 7, 1, 2);
  ctx.fillRect(x + 10, y + 7, 1, 2);
}

// Flower side: a red petals blob on a thin green stem — appears as an
// X-shape sprite when viewed from the side.
function drawFlowerSide(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Stem (center column, lower half)
  ctx.fillStyle = "#2ecc71";
  for (let py = 8; py < TILE; py++) ctx.fillRect(x + 7, y + py, 2, 1);
  // Leaves on the stem
  ctx.fillRect(x + 5, y + 10, 2, 1);
  ctx.fillRect(x + 9, y + 11, 2, 1);
  // Petals (red, top portion — rounded)
  ctx.fillStyle = "#cc4444";
  ctx.fillRect(x + 5, y + 4, 6, 1);
  ctx.fillRect(x + 4, y + 5, 8, 1);
  ctx.fillRect(x + 4, y + 6, 8, 1);
  ctx.fillRect(x + 5, y + 7, 6, 1);
  // Yellow center
  ctx.fillStyle = "#ffdd33";
  ctx.fillRect(x + 7, y + 5, 2, 2);
}

// Tall grass: vertical blades of varying height — sprite-like, mostly
// transparent except for the blades themselves.
function drawTallGrass(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number) {
  ctx.fillStyle = "#5b9245";
  for (let blade = 0; blade < 5; blade++) {
    const bx = 2 + Math.floor(rng() * 12);
    const h = 6 + Math.floor(rng() * 8);
    for (let py = 0; py < h; py++) {
      ctx.fillRect(x + bx, y + TILE - 1 - py, 1, 1);
    }
  }
  // Lighter highlights on a few blades
  ctx.fillStyle = "#7cb858";
  for (let i = 0; i < 4; i++) {
    const bx = 3 + Math.floor(rng() * 10);
    ctx.fillRect(x + bx, y + TILE - 4, 1, 2);
  }
}

// Mossy cobble: regular cobble texture overlaid with green moss patches.
function drawMossyCobble(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number) {
  // Base cobble cracks
  ctx.fillStyle = "#3a3a3a";
  for (let i = 0; i < 3; i++) {
    const py = 2 + Math.floor(rng() * 12);
    for (let px = 0; px < TILE; px++) ctx.fillRect(x + px, y + py, 1, 1);
  }
  for (let i = 0; i < 3; i++) {
    const px = 2 + Math.floor(rng() * 12);
    for (let py = 0; py < TILE; py++) ctx.fillRect(x + px, y + py, 1, 1);
  }
  // Moss patches (green, clustered in corners and along cracks)
  ctx.fillStyle = "#4a7a3a";
  // Top-left moss blob
  ctx.fillRect(x + 1, y + 1, 4, 2);
  ctx.fillRect(x + 2, y + 3, 3, 1);
  // Bottom-right moss blob
  ctx.fillRect(x + 11, y + 12, 4, 2);
  ctx.fillRect(x + 12, y + 11, 3, 1);
  // Random moss specks
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(x + 1 + Math.floor(rng() * 14), y + 1 + Math.floor(rng() * 14), 1, 1);
  }
  // Lighter moss highlights
  ctx.fillStyle = "#6a9a5a";
  ctx.fillRect(x + 2, y + 1, 2, 1);
  ctx.fillRect(x + 12, y + 13, 2, 1);
}

// Generic ore drawing: stone base with colored mineral blobs.
function drawOre(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number, mineralColor: string) {
  // A few mineral blobs of varying size
  ctx.fillStyle = mineralColor;
  // Larger blob (3x3-ish)
  ctx.fillRect(x + 4 + Math.floor(rng() * 2), y + 4 + Math.floor(rng() * 2), 2, 2);
  ctx.fillRect(x + 4, y + 7, 1, 1);
  // Smaller specks
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 2 + Math.floor(rng() * 12), y + 2 + Math.floor(rng() * 12), 1, 1);
  }
  // Tiny highlight on the main blob
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(x + 5, y + 5, 1, 1);
}

// Grave top: a rounded headstone slab seen from above — darker stone
// with a small cross carved into the center.
function drawGraveTop(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Slightly darker frame to suggest a beveled edge
  ctx.fillStyle = "#2a2a2a";
  for (let i = 0; i < TILE; i++) {
    ctx.fillRect(x + i, y + 0, 1, 1);
    ctx.fillRect(x + i, y + TILE - 1, 1, 1);
    ctx.fillRect(x + 0, y + i, 1, 1);
    ctx.fillRect(x + TILE - 1, y + i, 1, 1);
  }
  // Small cross engraving in the center
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x + 7, y + 5, 2, 6);
  ctx.fillRect(x + 5, y + 7, 6, 2);
}

// Grave side: a tall headstone silhouette on a stone base — the iconic
// rounded-top tombstone shape.
function drawGraveSide(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Base ground line (darker)
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x, y + TILE - 2, TILE, 2);
  // Headstone body (lighter grey, rounded top)
  ctx.fillStyle = "#5a5a5a";
  // Main slab
  ctx.fillRect(x + 3, y + 4, 10, 10);
  // Rounded top (arch)
  ctx.fillRect(x + 4, y + 3, 8, 1);
  ctx.fillRect(x + 5, y + 2, 6, 1);
  ctx.fillRect(x + 6, y + 1, 4, 1);
  // Highlight on the left edge
  ctx.fillStyle = "#6a6a6a";
  ctx.fillRect(x + 3, y + 5, 1, 8);
  // R.I.P. engraving (dark pixels)
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x + 7, y + 6, 2, 1);
  ctx.fillRect(x + 7, y + 8, 2, 1);
  ctx.fillRect(x + 7, y + 10, 2, 1);
  // Crack at the bottom (weathering)
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(x + 6, y + 12, 1, 2);
  ctx.fillRect(x + 9, y + 11, 1, 2);
}

// Portal: swirling vortex texture — concentric arcs with brighter
// speckles to evoke a magical portal surface. Purple by default (overworld),
// aqua when `sky` is true (sky dimension).
function drawPortal(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number, sky = false) {
  const arcColor = sky ? "#3aaaba" : "#8a5aaa";
  const centerColor = sky ? "#8aeaff" : "#c08aff";
  const sparkle1 = sky ? "#b0f0ff" : "#e0b0ff";
  const sparkle2 = sky ? "#40a0c0" : "#a060d0";
  // Concentric arcs (darker to lighter, inward)
  ctx.strokeStyle = arcColor;
  ctx.lineWidth = 1;
  for (let r = 7; r > 1; r--) {
    ctx.beginPath();
    ctx.arc(x + 8, y + 8, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Bright swirl center
  ctx.fillStyle = centerColor;
  ctx.fillRect(x + 7, y + 7, 2, 2);
  // Sparkle speckles
  for (let i = 0; i < 8; i++) {
    const sx = x + 2 + Math.floor(rng() * 12);
    const sy = y + 2 + Math.floor(rng() * 12);
    ctx.fillStyle = rng() < 0.5 ? sparkle1 : sparkle2;
    ctx.fillRect(sx, sy, 1, 1);
  }
}

// Ruby: a faceted red gem — diamond shape with bright highlight.
function drawRuby(ctx: CanvasRenderingContext2D, x: number, y: number, rng: () => number) {
  // Diamond/gem shape (top half narrower than bottom)
  ctx.fillStyle = "#e02020";
  // Top point
  ctx.fillRect(x + 7, y + 3, 2, 1);
  ctx.fillRect(x + 6, y + 4, 4, 1);
  ctx.fillRect(x + 5, y + 5, 6, 1);
  // Wide middle
  ctx.fillRect(x + 4, y + 6, 8, 3);
  // Bottom taper
  ctx.fillRect(x + 5, y + 9, 6, 1);
  ctx.fillRect(x + 6, y + 10, 4, 1);
  ctx.fillRect(x + 7, y + 11, 2, 1);
  // Bright highlight (upper-left facet)
  ctx.fillStyle = "#ff6060";
  ctx.fillRect(x + 6, y + 5, 2, 1);
  ctx.fillRect(x + 5, y + 6, 2, 2);
  // Dark facet line (right side)
  ctx.fillStyle = "#800808";
  ctx.fillRect(x + 10, y + 7, 1, 2);
  ctx.fillRect(x + 9, y + 9, 1, 1);
  // Sparkle
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 6, y + 6, 1, 1);
}

// Pickaxe (tiered): handle + head. Head color varies by tier (iron/diamond).
function drawPickaxeTiered(ctx: CanvasRenderingContext2D, x: number, y: number, headColor: string, darkColor: string) {
  // Handle (brown, diagonal from bottom-left to top-right)
  ctx.fillStyle = "#8b5a2b";
  for (let i = 0; i < 10; i++) {
    ctx.fillRect(x + 3 + i, y + 12 - i, 2, 1);
  }
  ctx.fillStyle = "#6b4421";
  for (let i = 0; i < 10; i++) {
    ctx.fillRect(x + 3 + i, y + 12 - i, 1, 1);
  }
  // Head (curved bar across the top)
  ctx.fillStyle = headColor;
  // Horizontal bar
  ctx.fillRect(x + 4, y + 3, 8, 2);
  // Left pick
  ctx.fillRect(x + 3, y + 4, 1, 2);
  ctx.fillRect(x + 2, y + 5, 1, 1);
  // Right pick
  ctx.fillRect(x + 12, y + 4, 1, 2);
  ctx.fillRect(x + 13, y + 5, 1, 1);
  // Dark shading on the head
  ctx.fillStyle = darkColor;
  ctx.fillRect(x + 4, y + 4, 8, 1);
  ctx.fillRect(x + 3, y + 5, 1, 1);
  ctx.fillRect(x + 12, y + 5, 1, 1);
  // Highlight
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 5, y + 3, 1, 1);
}

// Crafting table top: wooden surface with a 3x3 grid carved into it.
function drawCraftingTop(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Border (darker wood)
  ctx.fillStyle = "#553619";
  for (let i = 0; i < TILE; i++) {
    ctx.fillRect(x + i, y + 0, 1, 1);
    ctx.fillRect(x + i, y + TILE - 1, 1, 1);
    ctx.fillRect(x + 0, y + i, 1, 1);
    ctx.fillRect(x + TILE - 1, y + i, 1, 1);
  }
  // 3x3 grid lines (darker)
  ctx.fillStyle = "#553619";
  // Vertical lines at x=5 and x=10
  for (let py = 3; py < 13; py++) {
    ctx.fillRect(x + 5, y + py, 1, 1);
    ctx.fillRect(x + 10, y + py, 1, 1);
  }
  // Horizontal lines at y=5 and y=10
  for (let px = 3; px < 13; px++) {
    ctx.fillRect(x + px, y + 5, 1, 1);
    ctx.fillRect(x + px, y + 10, 1, 1);
  }
  // Tool mark (cross in center cell)
  ctx.fillStyle = "#8b5a2b";
  ctx.fillRect(x + 7, y + 7, 2, 1);
  ctx.fillRect(x + 7, y + 7, 1, 2);
}

// Sword: diagonal blade with a crossguard and brown handle.
function drawSword(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Blade (silver, diagonal from bottom-left to top-right)
  ctx.fillStyle = "#e0e0e0";
  for (let i = 0; i < 10; i++) {
    ctx.fillRect(x + 3 + i, y + 12 - i, 1, 1);
    ctx.fillRect(x + 4 + i, y + 12 - i, 1, 1);
  }
  // Blade tip (brighter)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 13, y + 2, 1, 1);
  ctx.fillRect(x + 12, y + 3, 1, 1);
  // Crossguard (gold/brown, horizontal)
  ctx.fillStyle = "#8b5a2b";
  ctx.fillRect(x + 2, y + 12, 3, 1);
  ctx.fillRect(x + 3, y + 13, 3, 1);
  ctx.fillRect(x + 4, y + 11, 3, 1);
  // Handle (brown, bottom-left)
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(x + 1, y + 13, 2, 2);
  ctx.fillRect(x + 2, y + 14, 1, 1);
}

// Pickaxe: silver head on a diagonal handle.
function drawPickaxe(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Handle (brown, diagonal bottom-left to top-right)
  ctx.fillStyle = "#5a3a1a";
  for (let i = 0; i < 10; i++) ctx.fillRect(x + 4 + i, y + 12 - i, 1, 1);
  // Head (silver, curved bar at top)
  ctx.fillStyle = "#c0c0c0";
  ctx.fillRect(x + 8, y + 3, 1, 2);
  ctx.fillRect(x + 7, y + 2, 3, 1);
  ctx.fillRect(x + 6, y + 1, 5, 1);
  ctx.fillRect(x + 5, y + 2, 1, 1);
  ctx.fillRect(x + 11, y + 2, 1, 1);
  ctx.fillStyle = "#e0e0e0";
  ctx.fillRect(x + 8, y + 2, 2, 1);
}

// Axe: silver blade head on a diagonal handle.
function drawAxe(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Handle (brown, diagonal bottom-left to top-right)
  ctx.fillStyle = "#5a3a1a";
  for (let i = 0; i < 10; i++) ctx.fillRect(x + 4 + i, y + 12 - i, 1, 1);
  // Blade head (silver, triangle at top-right of handle)
  ctx.fillStyle = "#c0c0c0";
  ctx.fillRect(x + 9, y + 3, 4, 1);
  ctx.fillRect(x + 10, y + 2, 3, 1);
  ctx.fillRect(x + 11, y + 4, 2, 1);
  ctx.fillStyle = "#e0e0e0";
  ctx.fillRect(x + 10, y + 3, 2, 1);
}

// Shovel: silver spade on a vertical handle.
function drawShovel(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Handle (brown, vertical center)
  ctx.fillStyle = "#5a3a1a";
  for (let py = 5; py < 15; py++) ctx.fillRect(x + 7, y + py, 2, 1);
  // Spade head (silver, trapezoid at bottom)
  ctx.fillStyle = "#c0c0c0";
  ctx.fillRect(x + 6, y + 11, 4, 1);
  ctx.fillRect(x + 5, y + 12, 6, 2);
  ctx.fillRect(x + 6, y + 14, 4, 1);
  ctx.fillStyle = "#e0e0e0";
  ctx.fillRect(x + 7, y + 12, 2, 1);
}

function darken(hex: string, factor: number): string {
  const c = parseInt(hex.slice(1), 16);
  const r = Math.floor(((c >> 16) & 0xff) * factor);
  const g = Math.floor(((c >> 8) & 0xff) * factor);
  const b = Math.floor((c & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function lighten(hex: string, amount: number): string {
  const c = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.floor(((c >> 16) & 0xff) + 255 * amount));
  const g = Math.min(255, Math.floor(((c >> 8) & 0xff) + 255 * amount));
  const b = Math.min(255, Math.floor((c & 0xff) + 255 * amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Convenience: get the U offset (0..1 in atlas X) for a face column.
// 0 = top, 1 = side, 2 = bottom
export function faceColumnU(faceKind: "top" | "side" | "bottom"): number {
  if (faceKind === "top") return 0;
  if (faceKind === "side") return 1;
  return 2;
}

// Door top half: window grid (4 small panes) above a rail.
function drawDoorTop(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Outer frame (dark border)
  ctx.fillStyle = "#5a3a18";
  ctx.fillRect(x, y, TILE, 1);
  ctx.fillRect(x, y + TILE - 1, TILE, 1);
  ctx.fillRect(x, y, 1, TILE);
  ctx.fillRect(x + TILE - 1, y, 1, TILE);
  // 4 window panes (2x2 grid) in the upper portion
  const paneY = y + 2;
  const paneH = 6;
  ctx.fillStyle = "#8a9aac";
  ctx.fillRect(x + 2, paneY, 5, paneH);
  ctx.fillRect(x + 9, paneY, 5, paneH);
  // Pane dividers
  ctx.fillStyle = "#5a3a18";
  ctx.fillRect(x + 7, paneY, 2, paneH); // vertical divider
  ctx.fillRect(x + 2, paneY + 3, 12, 1); // horizontal divider
  // Lower rail (solid wood) — already base-filled
}

// Door bottom half: vertical wood panels with a handle.
function drawDoorSide(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Outer frame
  ctx.fillStyle = "#5a3a18";
  ctx.fillRect(x, y, TILE, 1);
  ctx.fillRect(x, y + TILE - 1, TILE, 1);
  ctx.fillRect(x, y, 1, TILE);
  ctx.fillRect(x + TILE - 1, y, 1, TILE);
  // Two recessed vertical panels
  ctx.fillStyle = "#7a5a28";
  ctx.fillRect(x + 2, y + 2, 5, 5);
  ctx.fillRect(x + 9, y + 2, 5, 5);
  ctx.fillStyle = "#5a3a18";
  ctx.fillRect(x + 2, y + 8, 5, 5);
  ctx.fillRect(x + 9, y + 8, 5, 5);
  // Door handle (small dark dot on the right side)
  ctx.fillStyle = "#d0c060";
  ctx.fillRect(x + 12, y + 7, 2, 2);
}

// Hay bale: horizontal straw strands with golden highlights.
function drawHay(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Horizontal strand bands
  for (let py = 0; py < TILE; py += 2) {
    ctx.fillStyle = (py / 2) % 2 === 0 ? "#d8b058" : "#a88838";
    ctx.fillRect(x, y + py, TILE, 1);
  }
  // Random straw flecks
  for (let i = 0; i < 18; i++) {
    const px = Math.floor(Math.random() * TILE);
    const py = Math.floor(Math.random() * TILE);
    ctx.fillStyle = Math.random() < 0.5 ? "#e8c878" : "#7a5818";
    ctx.fillRect(x + px, y + py, 1, 1);
  }
  // Bindings: two vertical straps
  ctx.fillStyle = "#5a3a18";
  ctx.fillRect(x + 4, y, 1, TILE);
  ctx.fillRect(x + TILE - 5, y, 1, TILE);
}

