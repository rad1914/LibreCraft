// A single chunk: a CHUNK_SIZE x CHUNK_HEIGHT x CHUNK_SIZE voxel volume.
// Stores block ids in a flat Uint8Array and rebuilds a Three.js
// BufferGeometry whenever its blocks change. Meshing uses face culling:
// only faces that border air or transparent blocks are emitted.

import * as THREE from "three";
import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  BIOMES,
  Biome,
  pickBiome,
} from "./biomes";
import { BlockType, BLOCKS, isAir } from "./blocks";
import { Noise } from "./noise";
import {
  getTextureAtlas,
  getTileRow,
  faceColumnU,
  TILES_PER_ROW,
  TILE,
} from "./textures";

export interface ChunkNeighborGetter {
  (worldX: number, worldY: number, worldZ: number): number;
}

export class Chunk {
  // biome id per XZ column, used for tree placement / coloring
  biomes: Uint8Array;
  blocks: Uint8Array;
  cx: number;
  cz: number;
  generated = false;

  opaqueMesh: THREE.Mesh | null = null;
  transparentMesh: THREE.Mesh | null = null;

  // local edit flag - true once the player has modified this chunk
  dirty = true;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  }

  // local-coordinate access (no bounds checking across Y)
  private idx(x: number, y: number, z: number): number {
    return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
  }

  getLocal(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return BlockType.AIR;
    return this.blocks[this.idx(x, y, z)];
  }

  setLocal(x: number, y: number, z: number, id: number) {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    this.blocks[this.idx(x, y, z)] = id;
    this.dirty = true;
  }

  // Procedurally generate this chunk's terrain from a seed.
  generate(seed: number, heightNoise: Noise, biomeNoise: Noise, tempNoise: Noise) {
    const baseX = this.cx * CHUNK_SIZE;
    const baseZ = this.cz * CHUNK_SIZE;

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const biome = pickBiome(biomeNoise, tempNoise, wx, wz);
        this.biomes[z * CHUNK_SIZE + x] = biome;

        const def = BIOMES[biome];
        const n = heightNoise.fbm2D(wx * 0.013, wz * 0.013, 5, 2, 0.5);
        const ridge = Math.pow(Math.abs(heightNoise.fbm2D(wx * 0.022 + 333, wz * 0.022 - 333, 4)), 1.4);
        const height = Math.floor(def.baseHeight + n * def.amplitude + (biome === Biome.MOUNTAINS ? ridge * def.amplitude : 0));
        const clamped = Math.max(1, Math.min(CHUNK_HEIGHT - 2, height));

        for (let y = 0; y <= clamped; y++) {
          let block = BlockType.STONE;
          if (y === 0) {
            block = BlockType.BEDROCK;
          } else if (y === clamped) {
            if (clamped < 24 && biome === Biome.OCEAN) {
              block = BlockType.SAND;
            } else if (biome === Biome.DESERT) {
              block = BlockType.SAND;
            } else if (biome === Biome.MOUNTAINS && clamped > 44) {
              block = BlockType.SNOW;
            } else if (biome === Biome.SNOWY) {
              block = BlockType.SNOW;
            } else if (clamped < SEA_LEVEL_ADJ) {
              block = BlockType.SAND;
            } else {
              block = def.surface;
            }
          } else if (y >= clamped - 3) {
            block = def.filler;
          }
          this.blocks[this.idx(x, y, z)] = block;
        }

        // Fill water up to sea level
        for (let y = clamped + 1; y <= SEA_LEVEL_ADJ; y++) {
          this.blocks[this.idx(x, y, z)] = BlockType.WATER;
        }

        // Trees: deterministic per-column hash so world is reproducible
        if (def.treeChance > 0 && clamped >= SEA_LEVEL_ADJ && biome !== Biome.OCEAN) {
          const hash = hash3(wx, wz, seed);
          if (hash < def.treeChance && biome !== Biome.DESERT) {
            this.placeTree(x, clamped + 1, z, biome);
          }
        }

        // Mountains: occasional stone outcrops above the snow line for
        // a more rugged, rocky feel on the peaks. Already snow-capped
        // above y=44 via the surface block; here we add a few floating
        // stone nubs on top of the snow to break up the flat white.
        if (biome === Biome.MOUNTAINS && clamped > 44 && clamped < CHUNK_HEIGHT - 2) {
          const outcropHash = hash3(wx + 9999, wz - 9999, seed + 7);
          if (outcropHash < 0.08) {
            // Small 1-2 block stone nub on top of the snow.
            this.blocks[this.idx(x, clamped + 1, z)] = BlockType.STONE;
            if (outcropHash < 0.03 && clamped + 2 < CHUNK_HEIGHT) {
              this.blocks[this.idx(x, clamped + 2, z)] = BlockType.STONE;
            }
          }
        }
      }
    }
    this.generated = true;
    this.dirty = true;
  }

  private placeTree(x: number, y: number, z: number, biome: Biome) {
    // Trunk height varies by biome and a per-tree hash. Forests get
    // taller trees (5..7) with occasional 2-block-taller giants; plains
    // get small trees (4..5); mountains get stunted trees (5).
    const h = hash3(x + this.cx * 16, z + this.cz * 16, y);
    let trunkHeight: number;
    if (biome === Biome.FOREST) {
      trunkHeight = 5 + Math.floor(h * 3);
      // 25% chance of a "big" forest tree — 2 blocks taller than normal.
      if (h > 0.75) trunkHeight += 2;
    } else if (biome === Biome.MOUNTAINS) {
      trunkHeight = 5;
    } else {
      trunkHeight = 4 + Math.floor(h * 2);
    }
    // Trunk
    for (let i = 0; i < trunkHeight; i++) {
      if (y + i < CHUNK_HEIGHT) this.setLocal(x, y + i, z, BlockType.WOOD);
    }
    // Leaves: two layers of 3x3 then a 5x5
    const topY = y + trunkHeight;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 0; dy++) {
          const lx = x + dx;
          const ly = topY + dy;
          const lz = z + dz;
          if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
          if (ly < 0 || ly >= CHUNK_HEIGHT) continue;
          if (Math.abs(dx) + Math.abs(dz) === 4) continue;
          if (this.blocks[this.idx(lx, ly, lz)] === BlockType.AIR) {
            this.blocks[this.idx(lx, ly, lz)] = BlockType.LEAVES;
          }
        }
      }
    }
    // Top crown
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dz) === 2) continue;
        const lx = x + dx;
        const lz = z + dz;
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
        if (topY + 1 < CHUNK_HEIGHT && this.blocks[this.idx(lx, topY + 1, lz)] === BlockType.AIR) {
          this.blocks[this.idx(lx, topY + 1, lz)] = BlockType.LEAVES;
        }
      }
    }
    if (topY + 2 < CHUNK_HEIGHT && this.blocks[this.idx(x, topY + 2, z)] === BlockType.AIR) {
      this.blocks[this.idx(x, topY + 2, z)] = BlockType.LEAVES;
    }
  }

  // Build (or rebuild) the chunk's meshes from its current block data.
  buildMeshes(material: THREE.Material, transparentMaterial: THREE.Material, neighborGetter: ChunkNeighborGetter) {
    const atlas = getTextureAtlas();
    const texture = atlas.texture;
    const rows = atlas.rows;
    // Inset UVs to avoid bleeding at tile borders
    const insetU = 0.5 / (TILES_PER_ROW * TILE);
    const insetV = 0.5 / (rows * TILE);

    const opaquePositions: number[] = [];
    const opaqueUvs: number[] = [];
    const opaqueNormals: number[] = [];
    const opaqueIndices: number[] = [];

    const transPositions: number[] = [];
    const transUvs: number[] = [];
    const transNormals: number[] = [];
    const transIndices: number[] = [];

    const baseX = this.cx * CHUNK_SIZE;
    const baseZ = this.cz * CHUNK_SIZE;

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = this.blocks[this.idx(x, y, z)];
          if (isAir(id)) continue;
          const def = BLOCKS[id];
          const wx = baseX + x;
          const wy = y;
          const wz = baseZ + z;

          const target = def.transparent
            ? { pos: transPositions, uv: transUvs, nor: transNormals, idx: transIndices }
            : { pos: opaquePositions, uv: opaqueUvs, nor: opaqueNormals, idx: opaqueIndices };

          const row = getTileRow(texture, id);

          for (const face of FACES) {
            const nx = wx + face.dir[0];
            const ny = wy + face.dir[1];
            const nz = wz + face.dir[2];
            const neighbor = neighborGetter(nx, ny, nz);

            // Cull rules:
            //  - face is hidden if neighbor is solid opaque
            //  - water faces against water are hidden
            //  - leaves/glass faces against same type are hidden
            if (!shouldRenderFace(id, neighbor)) continue;

            // UV rect for this face's tile
            const colU = faceColumnU(face.kind); // 0,1,2
            const u0 = (colU / TILES_PER_ROW) + insetU;
            const u1 = ((colU + 1) / TILES_PER_ROW) - insetU;
            // Row 0 is at the TOP of the atlas texture (v=1); row `rows-1`
            // is at the bottom (v=0). Each tile spans 1/rows vertically.
            const v1 = 1 - (row / rows) - insetV; // top edge
            const v0 = 1 - ((row + 1) / rows) + insetV; // bottom edge

            const startVertex = target.pos.length / 3;
            for (let i = 0; i < 4; i++) {
              const corner = face.corners[i];
              target.pos.push(wx + corner[0], wy + corner[1], wz + corner[2]);
              target.nor.push(face.dir[0], face.dir[1], face.dir[2]);
              const [uu, vv] = uvCorner(face.uvCorners[i], u0, u1, v0, v1);
              target.uv.push(uu, vv);
            }
            target.idx.push(startVertex, startVertex + 1, startVertex + 2, startVertex + 2, startVertex + 3, startVertex);
          }
        }
      }
    }

    // Dispose old meshes
    if (this.opaqueMesh) {
      this.opaqueMesh.geometry.dispose();
      this.opaqueMesh = null;
    }
    if (this.transparentMesh) {
      this.transparentMesh.geometry.dispose();
      this.transparentMesh = null;
    }

    if (opaquePositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(opaquePositions, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(opaqueUvs, 2));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(opaqueNormals, 3));
      geo.setIndex(opaqueIndices);
      this.opaqueMesh = new THREE.Mesh(geo, material);
      this.opaqueMesh.frustumCulled = true;
    }
    if (transPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(transPositions, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(transUvs, 2));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(transNormals, 3));
      geo.setIndex(transIndices);
      this.transparentMesh = new THREE.Mesh(geo, transparentMaterial);
      this.transparentMesh.frustumCulled = true;
    }
    this.dirty = false;
  }

  dispose() {
    if (this.opaqueMesh) {
      this.opaqueMesh.geometry.dispose();
      this.opaqueMesh = null;
    }
    if (this.transparentMesh) {
      this.transparentMesh.geometry.dispose();
      this.transparentMesh = null;
    }
  }
}

const SEA_LEVEL_ADJ = 24;

// Face definitions: each face has a direction and 4 corner offsets.
// Corners are ordered so that triangles (0,1,2) and (2,3,0) face
// OUTWARD (CCW when viewed from outside the cube). The `uvCorners`
// field tells the mesher which corner of the texture tile (BL, BR, TR,
// TL) each geometric corner corresponds to — this is what makes
// textures appear upright and correctly oriented on every face.
//
// UV tile corners: BL=(0,0) BR=(1,0) TR=(1,1) TL=(0,1) in tile space.
interface Face {
  dir: [number, number, number];
  corners: [number, number, number][];
  uvCorners: ["BL" | "BR" | "TR" | "TL", "BL" | "BR" | "TR" | "TL", "BL" | "BR" | "TR" | "TL", "BL" | "BR" | "TR" | "TL"];
  kind: "top" | "side" | "bottom";
}

const FACES: Face[] = [
  // +X (side, facing east).
  // NOTE: corners wound CCW from outside (verified: cross(e1,e2) = +X).
  // uvCorners reversed in lockstep so each physical vertex keeps its
  // original UV label — texture orientation is unchanged.
  {
    dir: [1, 0, 0], kind: "side",
    corners: [[1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]],
    uvCorners: ["TR", "TL", "BL", "BR"],
  },
  // -X (side, facing west). Same reversal as +X.
  {
    dir: [-1, 0, 0], kind: "side",
    corners: [[0, 1, 1], [0, 1, 0], [0, 0, 0], [0, 0, 1]],
    uvCorners: ["TR", "TL", "BL", "BR"],
  },
  // +Y (top). Already correctly wound — unchanged.
  {
    dir: [0, 1, 0], kind: "top",
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    uvCorners: ["BL", "BR", "TR", "TL"],
  },
  // -Y (bottom). Already correctly wound — unchanged.
  {
    dir: [0, -1, 0], kind: "bottom",
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    uvCorners: ["BL", "BR", "TR", "TL"],
  },
  // +Z (side, facing south). Reversed like +X.
  {
    dir: [0, 0, 1], kind: "side",
    corners: [[1, 1, 1], [0, 1, 1], [0, 0, 1], [1, 0, 1]],
    uvCorners: ["TR", "TL", "BL", "BR"],
  },
  // -Z (side, facing north). Reversed like +X.
  {
    dir: [0, 0, -1], kind: "side",
    corners: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]],
    uvCorners: ["TR", "TL", "BL", "BR"],
  },
];

// Map a UV-corner label to (u, v) within a tile, given tile bounds
// [u0,u1] x [v0,v1] where v1 is the TOP of the tile (higher v = up).
function uvCorner(
  label: "BL" | "BR" | "TR" | "TL",
  u0: number, u1: number, v0: number, v1: number
): [number, number] {
  switch (label) {
    case "BL": return [u0, v0];
    case "BR": return [u1, v0];
    case "TR": return [u1, v1];
    case "TL": return [u0, v1];
  }
}

function shouldRenderFace(self: number, neighbor: number): boolean {
  if (isAir(neighbor)) return true;
  const neighborDef = BLOCKS[neighbor];
  if (!neighborDef) return true;
  if (neighborDef.transparent) {
    // Don't render water-water or glass-glass boundaries
    if (neighbor === self) return false;
    return true;
  }
  return false;
}

function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) / 0xFFFFFFFF);
}
