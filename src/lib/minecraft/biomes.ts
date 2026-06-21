// Biome definitions and world constants. Biomes are selected from a
// separate low-frequency noise field so the world map feels regional.

import { Noise } from "./noise";
import { BlockType } from "./blocks";

export const CHUNK_SIZE = 16;     // X / Z dimension of a chunk
export const CHUNK_HEIGHT = 64;   // Y dimension of the world
export const SEA_LEVEL = 24;      // water surface height

export enum Biome {
  PLAINS = 0,
  FOREST = 1,
  DESERT = 2,
  MOUNTAINS = 3,
  SNOWY = 4,
  OCEAN = 5,
}

export interface BiomeDef {
  id: Biome;
  name: string;
  surface: number;   // block placed on top of dirt/sand
  filler: number;    // block placed below surface
  treeChance: number; // probability per surface block
  baseHeight: number;
  amplitude: number;
}

export const BIOMES: Record<Biome, BiomeDef> = {
  [Biome.PLAINS]: {
    id: Biome.PLAINS,
    name: "Plains",
    surface: BlockType.GRASS,
    filler: BlockType.DIRT,
    treeChance: 0.012,
    baseHeight: 26,
    amplitude: 4,
  },
  [Biome.FOREST]: {
    id: Biome.FOREST,
    name: "Forest",
    surface: BlockType.GRASS,
    filler: BlockType.DIRT,
    treeChance: 0.12,
    baseHeight: 28,
    amplitude: 6,
  },
  [Biome.DESERT]: {
    id: Biome.DESERT,
    name: "Desert",
    surface: BlockType.SAND,
    filler: BlockType.SAND,
    treeChance: 0.001,
    baseHeight: 25,
    amplitude: 3,
  },
  [Biome.MOUNTAINS]: {
    id: Biome.MOUNTAINS,
    name: "Mountains",
    surface: BlockType.STONE,
    filler: BlockType.STONE,
    treeChance: 0.002,
    baseHeight: 34,
    amplitude: 22,
  },
  [Biome.SNOWY]: {
    id: Biome.SNOWY,
    name: "Snowy",
    surface: BlockType.SNOW,
    filler: BlockType.DIRT,
    treeChance: 0.02,
    baseHeight: 28,
    amplitude: 7,
  },
  [Biome.OCEAN]: {
    id: Biome.OCEAN,
    name: "Ocean",
    surface: BlockType.SAND,
    filler: BlockType.SAND,
    treeChance: 0,
    baseHeight: 18,
    amplitude: 4,
  },
};

// Pick the biome at a world (x, z) coordinate.
// Uses a low-frequency noise for temperature and humidity, blended
// with a continent noise to occasionally produce oceans.
export function pickBiome(
  biomeNoise: Noise,
  tempNoise: Noise,
  x: number,
  z: number
): Biome {
  const continent = biomeNoise.fbm2D(x * 0.0042, z * 0.0042, 3);
  if (continent < -0.35) return Biome.OCEAN;

  const t = tempNoise.fbm2D(x * 0.0061 + 1000, z * 0.0061 - 1000, 3);
  const m = biomeNoise.fbm2D(x * 0.0085 + 500, z * 0.0085 + 500, 3);

  // Mountains emerge where continent noise is high
  if (continent > 0.32) return Biome.MOUNTAINS;

  if (t < -0.3) return Biome.SNOWY;
  if (t > 0.25 && m < 0) return Biome.DESERT;
  if (m > 0.15) return Biome.FOREST;
  return Biome.PLAINS;
}
