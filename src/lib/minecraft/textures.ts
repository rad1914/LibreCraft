// Procedurally generates a 16x16 pixel-art texture atlas for all blocks
// using a canvas. Each block gets 3 textures (top, side, bottom) packed
// into a single atlas image so the chunk mesher can use one shared
// material with nearest-neighbor sampling for the pixel-perfect look.
//
// Atlas layout: each row holds textures for one block; columns are
// top/side/bottom. With 14 blocks at 16x16 each, the atlas is 48x224.
// We bump tile size to 16 with no padding to keep UV math simple.

import * as THREE from "three";
import { BLOCKS, BlockType } from "./blocks";

export const TILE = 16; // pixels per tile
export const TILES_PER_ROW = 3; // top, side, bottom

interface TextureSpec {
  base: string; // base fill color (hex)
  noise: string; // noise speckle color (hex)
  noiseAmount: number; // 0..1 fraction of pixels to speckle
  pattern?: "grass_top" | "wood_side" | "wood_top" | "leaves" | "brick" | "cobble" | "stone" | "sand" | "water" | "snow" | "glass" | "planks" | "dirt" | "bedrock";
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
};

let cachedAtlas: { texture: THREE.Texture; tileUV: number; rows: number; canvas: HTMLCanvasElement } | null = null;

// Generate (or return cached) the texture atlas. Returns a THREE.Texture
// configured with NearestFilter for pixel-perfect rendering.
export function getTextureAtlas(): { texture: THREE.Texture; tileUV: number; rows: number; canvas: HTMLCanvasElement } {
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
  // Each tile spans 1/TILES_PER_ROW horizontally, 1/rows vertically.
  // We inset slightly to avoid bleeding at tile edges.
  const tileUV = 1 / TILES_PER_ROW;
  const tileV = 1 / rows;

  cachedAtlas = { texture, tileUV, rows, canvas };
  (cachedAtlas as unknown as { tileV: number }).tileV = tileV;
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

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Convenience: get the U offset (0..1 in atlas X) for a face column.
// 0 = top, 1 = side, 2 = bottom
export function faceColumnU(faceKind: "top" | "side" | "bottom"): number {
  if (faceKind === "top") return 0;
  if (faceKind === "side") return 1;
  return 2;
}

