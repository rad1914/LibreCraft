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
import type { Dimension } from "./world";

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
  // `placeExtra` is a callback the generator uses to write blocks that
  // fall outside this chunk's bounds (e.g. tree leaves spanning a
  // border) — the World stores them and applies them when the neighbor
  // chunk is generated. This fixes the "half-cut trees" bug.
  // `dimension` switches between overworld (normal terrain) and sky
  // (floating islands at high altitude).
  generate(
    seed: number,
    heightNoise: Noise,
    biomeNoise: Noise,
    tempNoise: Noise,
    dimension: Dimension,
    placeExtra: (wx: number, wy: number, wz: number, id: number) => void,
  ) {
    if (dimension === "sky") {
      this.generateSky(seed, heightNoise, biomeNoise, placeExtra);
      return;
    }
    this.generateOverworld(seed, heightNoise, biomeNoise, tempNoise, placeExtra);
  }

  // Sky dimension generation: large floating islands at high altitude.
  // Inherits overworld terrain features (ores, caves, trees, flowers, tall
  // grass) but applies them to the floating island terrain instead of a
  // solid world. Islands are bigger and thicker than before.
  private generateSky(
    seed: number,
    heightNoise: Noise,
    biomeNoise: Noise,
    placeExtra: (wx: number, wy: number, wz: number, id: number) => void,
  ) {
    const baseX = this.cx * CHUNK_SIZE;
    const baseZ = this.cz * CHUNK_SIZE;
    const ISLAND_BASE_Y = 40; // surface altitude
    const ISLAND_THICKNESS = 16; // much thicker islands (was 6)

    // Cave noise (same as overworld — reuse for island interiors).
    const caveNoise1 = heightNoise;
    const caveNoise2 = biomeNoise;

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        // Island mask: lower-frequency noise for BIGGER islands. Threshold
        // 0.25 leaves wider gaps between islands while making each one larger.
        const mask = heightNoise.fbm2D(wx * 0.018, wz * 0.018, 4);
        if (mask < 0.25) continue; // air — no island here

        // Island thickness varies — much thicker in the center (up to 20+).
        const thicknessNoise = heightNoise.fbm2D(wx * 0.04 + 500, wz * 0.04 + 500, 3);
        const thickness = Math.max(4, Math.floor(ISLAND_THICKNESS * (0.5 + thicknessNoise * 0.8)));

        // Surface height variation (±3 blocks for rolling hills on islands)
        const surfaceVar = Math.floor(biomeNoise.fbm2D(wx * 0.06, wz * 0.06, 3) * 4);
        const surfaceY = ISLAND_BASE_Y + surfaceVar;

        for (let dy = 0; dy < thickness; dy++) {
          const y = surfaceY - dy;
          if (y < 0 || y >= CHUNK_HEIGHT) continue;
          let block: number;
          if (dy === 0) {
            block = BlockType.GRASS; // grass top
          } else if (dy < 3) {
            block = BlockType.DIRT; // dirt below surface
          } else {
            block = BlockType.STONE; // stone core
            // Underground ore generation (inherited from overworld).
            if (y > 2) block = rollOre(wx, y, wz, seed);
          }

          // Cave carving (inherited from overworld) — only in stone, not
          // in the surface grass/dirt layer.
          if (dy >= 3 && y > 2 && block === BlockType.STONE && shouldCarveCave(caveNoise1, caveNoise2, wx, y, wz)) {
            block = BlockType.AIR;
          }

          this.blocks[this.idx(x, y, z)] = block;
        }

        // Surface decorations (inherited from overworld): tall grass + flowers.
        const decoHash = hash3(wx + 31, wz - 17, seed + 1);
        if (decoHash < 0.18) {
          this.blocks[this.idx(x, surfaceY + 1, z)] = BlockType.TALL_GRASS;
        }
        if (decoHash > 0.85 && decoHash < 0.92) {
          this.blocks[this.idx(x, surfaceY + 1, z)] = BlockType.FLOWER;
        }

        // Trees (inherited from overworld) — higher chance on big islands.
        const treeHash = hash3(wx, wz, seed + 7777);
        if (treeHash < 0.05 && surfaceY + 1 < CHUNK_HEIGHT) {
          this.placeTree(x, surfaceY + 1, z, Biome.FOREST, baseX, baseZ, placeExtra);
        }
      }
    }
    this.generated = true;
    this.dirty = true;
  }

  private generateOverworld(
    seed: number,
    heightNoise: Noise,
    biomeNoise: Noise,
    tempNoise: Noise,
    placeExtra: (wx: number, wy: number, wz: number, id: number) => void,
  ) {
    const baseX = this.cx * CHUNK_SIZE;
    const baseZ = this.cz * CHUNK_SIZE;

    // Cave noise: reuse heightNoise with a different frequency for 3D
    // cave carving. Two overlapping noise fields create twisting tunnels.
    const caveNoise1 = heightNoise;
    const caveNoise2 = biomeNoise;

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const biome = pickBiome(biomeNoise, tempNoise, wx, wz);
        this.biomes[z * CHUNK_SIZE + x] = biome;

        const def = BIOMES[biome];
        const n = heightNoise.fbm2D(wx * 0.013, wz * 0.013, 5, 2, 0.5);
        const ridge = Math.pow(Math.abs(heightNoise.fbm2D(wx * 0.022 + 333, wz * 0.022 - 333, 4)), 1.4);
        // Mountains: taller peaks with amplified ridge noise. The base
        // amplitude is doubled for mountains, and the ridge contribution
        // is squared for sharper, more dramatic summits.
        let mountainBoost = 0;
        if (biome === Biome.MOUNTAINS) {
          mountainBoost = ridge * ridge * def.amplitude * 1.8 + ridge * def.amplitude * 0.5;
        }
        const height = Math.floor(def.baseHeight + n * def.amplitude + mountainBoost);
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
          } else {
            // Underground ore generation — depth-tiered.
            if (y < clamped - 4 && y > 2) block = rollOre(wx, y, wz, seed);
          }

          // Cave carving: only below the surface (y < clamped - 4) and above
          // bedrock (y > 2) so we don't break floors or surface features.
          if (y < clamped - 4 && y > 2 && block === BlockType.STONE && shouldCarveCave(caveNoise1, caveNoise2, wx, y, wz)) {
            block = BlockType.AIR;
          }

          this.blocks[this.idx(x, y, z)] = block;
        }

        // Fill water up to sea level (but not in carved caves)
        for (let y = clamped + 1; y <= SEA_LEVEL_ADJ; y++) {
          if (this.blocks[this.idx(x, y, z)] === BlockType.AIR) {
            this.blocks[this.idx(x, y, z)] = BlockType.WATER;
          }
        }

        // Surface decorations (only on land above sea level).
        const isLand = clamped >= SEA_LEVEL_ADJ && biome !== Biome.OCEAN;
        if (isLand) {
          const decoHash = hash3(wx + 31, wz - 17, seed + 1);
          // Grass tufts in plains/forest/snowy biomes
          if (
            (biome === Biome.PLAINS || biome === Biome.FOREST || biome === Biome.SNOWY) &&
            decoHash < 0.18
          ) {
            this.blocks[this.idx(x, clamped + 1, z)] = BlockType.TALL_GRASS;
          }
          // Flowers — only in plains
          if (biome === Biome.PLAINS && decoHash > 0.85 && decoHash < 0.92) {
            this.blocks[this.idx(x, clamped + 1, z)] = BlockType.FLOWER;
          }
        }

        // Trees: deterministic per-column hash so world is reproducible
        if (def.treeChance > 0 && isLand) {
          const hash = hash3(wx, wz, seed);
          if (hash < def.treeChance && biome !== Biome.DESERT) {
            this.placeTree(x, clamped + 1, z, biome, baseX, baseZ, placeExtra);
          }
        }

        // Mountains: occasional stone outcrops above the snow line for
        // a more rugged, rocky feel on the peaks.
        if (biome === Biome.MOUNTAINS && clamped > 44 && clamped < CHUNK_HEIGHT - 2) {
          const outcropHash = hash3(wx + 9999, wz - 9999, seed + 7);
          if (outcropHash < 0.08) {
            this.blocks[this.idx(x, clamped + 1, z)] = BlockType.STONE;
            if (outcropHash < 0.03 && clamped + 2 < CHUNK_HEIGHT) {
              this.blocks[this.idx(x, clamped + 2, z)] = BlockType.STONE;
            }
          }
        }

        // Occasional mossy-cobble boulders in forests and mountains.
        if (isLand && (biome === Biome.FOREST || biome === Biome.MOUNTAINS)) {
          const boulderHash = hash3(wx + 555, wz - 555, seed + 11);
          if (boulderHash < 0.012 && clamped + 1 < CHUNK_HEIGHT) {
            this.blocks[this.idx(x, clamped + 1, z)] = BlockType.MOSSY_COBBLE;
            // 50% chance of a 2-block boulder
            if (boulderHash < 0.006 && clamped + 2 < CHUNK_HEIGHT) {
              this.blocks[this.idx(x, clamped + 2, z)] = BlockType.MOSSY_COBBLE;
            }
          }
        }
      }
    }
    this.generated = true;
    this.dirty = true;
  }

  private placeTree(
    x: number, y: number, z: number, biome: Biome,
    baseX: number, baseZ: number,
    placeExtra: (wx: number, wy: number, wz: number, id: number) => void,
  ) {
    // Trunk height varies by biome and a per-tree hash. Forests get
    // taller trees (5..7) with occasional 2-block-taller giants; plains
    // get small trees (4..5); mountains get stunted trees (5).
    const h = hash3(x + this.cx * 16, z + this.cz * 16, y);
    let trunkHeight: number;
    if (biome === Biome.FOREST) {
      trunkHeight = 5 + Math.floor(h * 3);
      if (h > 0.75) trunkHeight += 2;
    } else if (biome === Biome.MOUNTAINS) {
      trunkHeight = 5;
    } else {
      trunkHeight = 4 + Math.floor(h * 2);
    }
    // Helper to write a block at local (lx,ly,lz) — if it falls outside
    // this chunk, route it through `placeExtra` so the neighbor chunk
    // picks it up when it's generated. This is the fix for half-cut
    // trees at chunk borders.
    const setSafe = (lx: number, ly: number, lz: number, id: number) => {
      if (ly < 0 || ly >= CHUNK_HEIGHT) return;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
        // Cross-chunk — defer via the World callback.
        placeExtra(baseX + lx, ly, baseZ + lz, id);
        return;
      }
      if (this.blocks[this.idx(lx, ly, lz)] === BlockType.AIR) {
        this.blocks[this.idx(lx, ly, lz)] = id;
      }
    };

    // Trunk
    for (let i = 0; i < trunkHeight; i++) {
      if (y + i < CHUNK_HEIGHT) this.setLocal(x, y + i, z, BlockType.WOOD);
    }
    // Leaves: two layers of 3x3 then a 5x5
    const topY = y + trunkHeight;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 0; dy++) {
          if (Math.abs(dx) + Math.abs(dz) === 4) continue;
          setSafe(x + dx, topY + dy, z + dz, BlockType.LEAVES);
        }
      }
    }
    // Top crown
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dz) === 2) continue;
        setSafe(x + dx, topY + 1, z + dz, BlockType.LEAVES);
      }
    }
    setSafe(x, topY + 2, z, BlockType.LEAVES);
  }

  // Build (or rebuild) the chunk's meshes from its current block data.
  //
  // Performance: uses a small dynamically-growable typed-array buffer
  // instead of plain number[] arrays. The buffer starts at a modest
  // 8K-vertex capacity (enough for typical chunks) and doubles when
  // full — far cheaper than the GC churn of `array.push(x,y,z)` on
  // hot paths. Local in-chunk neighbor reads avoid the World.getMap/
  // string-key path for the 6 neighbor lookups each block does.
  buildMeshes(material: THREE.Material, transparentMaterial: THREE.Material, neighborGetter: ChunkNeighborGetter) {
    const atlas = getTextureAtlas();
    const texture = atlas.texture;
    const rows = atlas.rows;
    const insetU = 0.5 / (TILES_PER_ROW * TILE);
    const insetV = 0.5 / (rows * TILE);

    const opaque = new MeshBuf();
    const trans = new MeshBuf();

    const baseX = this.cx * CHUNK_SIZE;
    const baseZ = this.cz * CHUNK_SIZE;
    const blocks = this.blocks;

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const i = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
          const id = blocks[i];
          if (id === 0) continue; // AIR
          const def = BLOCKS[id];
          const wx = baseX + x;
          const wy = y;
          const wz = baseZ + z;

          // Inline neighbor lookup: prefer local reads (same chunk).
          const getNeighbor = (dx: number, dy: number, dz: number): number => {
            const nx = x + dx, ny = y + dy, nz = z + dz;
            if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE && ny >= 0 && ny < CHUNK_HEIGHT) {
              return blocks[(ny * CHUNK_SIZE + nz) * CHUNK_SIZE + nx];
            }
            return neighborGetter(wx + dx, wy + dy, wz + dz);
          };

          // Sprite blocks (flowers, tall grass) render as two crossed quads.
          if (def.sprite) {
            const row = getTileRow(texture, id);
            const colU = faceColumnU("side");
            const u0 = (colU / TILES_PER_ROW) + insetU;
            const u1 = ((colU + 1) / TILES_PER_ROW) - insetU;
            const v1 = 1 - (row / rows) - insetV;
            const v0 = 1 - ((row + 1) / rows) + insetV;
            const quads = [
              [[0,0,0],[1,0,1],[1,1,1],[0,1,0]],
              [[1,0,0],[0,0,1],[0,1,1],[1,1,0]],
            ] as const;
            for (const corners of quads) {
              // Front
              let sv = trans.vertCount;
              for (let k = 0; k < 4; k++) {
                trans.pushVert(wx + corners[k][0], wy + corners[k][1], wz + corners[k][2], 0, 1, 0,
                  (k === 0 || k === 3) ? u0 : u1, (k === 0 || k === 1) ? v0 : v1);
              }
              trans.pushQuadIdx(sv);
              // Back (reverse winding)
              sv = trans.vertCount;
              for (let k = 0; k < 4; k++) {
                trans.pushVert(wx + corners[k][0], wy + corners[k][1], wz + corners[k][2], 0, 1, 0,
                  (k === 0 || k === 3) ? u0 : u1, (k === 0 || k === 1) ? v0 : v1);
              }
              trans.pushQuadIdxReversed(sv);
            }
            continue;
          }

          const target = def.transparent ? trans : opaque;
          const row = getTileRow(texture, id);

          for (const face of FACES) {
            const neighbor = getNeighbor(face.dir[0], face.dir[1], face.dir[2]);
            if (!shouldRenderFace(id, neighbor)) continue;

            const colU = faceColumnU(face.kind);
            const u0 = (colU / TILES_PER_ROW) + insetU;
            const u1 = ((colU + 1) / TILES_PER_ROW) - insetU;
            const v1 = 1 - (row / rows) - insetV;
            const v0 = 1 - ((row + 1) / rows) + insetV;

            const sv = target.vertCount;
            for (let k = 0; k < 4; k++) {
              const corner = face.corners[k];
              const [uu, vv] = uvCorner(face.uvCorners[k], u0, u1, v0, v1);
              target.pushVert(wx + corner[0], wy + corner[1], wz + corner[2],
                face.dir[0], face.dir[1], face.dir[2], uu, vv);
            }
            target.pushQuadIdx(sv);
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

    if (opaque.vertCount > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(opaque.pos.subarray(0, opaque.vertCount * 3), 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(opaque.uv.subarray(0, opaque.vertCount * 2), 2));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(opaque.nor.subarray(0, opaque.vertCount * 3), 3));
      geo.setIndex(new THREE.Uint32BufferAttribute(opaque.idx.subarray(0, opaque.idxCount), 1));
      this.opaqueMesh = new THREE.Mesh(geo, material);
      this.opaqueMesh.frustumCulled = true;
    }
    if (trans.vertCount > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(trans.pos.subarray(0, trans.vertCount * 3), 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(trans.uv.subarray(0, trans.vertCount * 2), 2));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(trans.nor.subarray(0, trans.vertCount * 3), 3));
      geo.setIndex(new THREE.Uint32BufferAttribute(trans.idx.subarray(0, trans.idxCount), 1));
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

// Growable typed-array buffer for chunk meshing. Starts small (4K verts)
// and doubles capacity when full — far cheaper than `number[].push()` on
// the hot meshing path, and avoids the memory blowup of pre-allocating
// the full theoretical max (which would be ~400K verts per chunk).
class MeshBuf {
  pos: Float32Array;
  uv: Float32Array;
  nor: Float32Array;
  idx: Uint32Array;
  vertCount = 0;
  idxCount = 0;

  constructor() {
    const cap = 4096; // initial vertex capacity
    this.pos = new Float32Array(cap * 3);
    this.uv = new Float32Array(cap * 2);
    this.nor = new Float32Array(cap * 3);
    this.idx = new Uint32Array(cap * 6 / 4);
  }

  private grow() {
    const newCap = this.pos.length / 3 * 2;
    const np = new Float32Array(newCap * 3);
    np.set(this.pos);
    this.pos = np;
    const nu = new Float32Array(newCap * 2);
    nu.set(this.uv);
    this.uv = nu;
    const nn = new Float32Array(newCap * 3);
    nn.set(this.nor);
    this.nor = nn;
    const ni = new Uint32Array(newCap * 6 / 4);
    ni.set(this.idx);
    this.idx = ni;
  }

  pushVert(px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number) {
    if (this.vertCount >= this.pos.length / 3) this.grow();
    const i = this.vertCount;
    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
    this.nor[i * 3] = nx; this.nor[i * 3 + 1] = ny; this.nor[i * 3 + 2] = nz;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.vertCount++;
  }

  pushQuadIdx(sv: number) {
    if (this.idxCount + 6 > this.idx.length) this.grow();
    this.idx[this.idxCount++] = sv;
    this.idx[this.idxCount++] = sv + 1;
    this.idx[this.idxCount++] = sv + 2;
    this.idx[this.idxCount++] = sv + 2;
    this.idx[this.idxCount++] = sv + 3;
    this.idx[this.idxCount++] = sv;
  }

  pushQuadIdxReversed(sv: number) {
    if (this.idxCount + 6 > this.idx.length) this.grow();
    this.idx[this.idxCount++] = sv;
    this.idx[this.idxCount++] = sv + 3;
    this.idx[this.idxCount++] = sv + 2;
    this.idx[this.idxCount++] = sv + 2;
    this.idx[this.idxCount++] = sv + 1;
    this.idx[this.idxCount++] = sv;
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

// Depth-tiered underground ore generation. Returns the ore block id for the
// given (wx, y, wz, seed) coordinate, or BlockType.STONE if no ore should
// spawn there. Coal is most common (any depth), iron below y=32, diamond
// below y=16, ruby below y=10 (very rare).
function rollOre(wx: number, y: number, wz: number, seed: number): number {
  const h = hash3(wx * 7, y * 13, wz * 11 + seed);
  if (h < 0.012) return BlockType.COAL_ORE;
  if (h < 0.018 && y < 32) return BlockType.IRON_ORE;
  if (h < 0.004 && y < 16) return BlockType.DIAMOND_ORE;
  if (h < 0.0015 && y < 10) return BlockType.RUBY_ORE;
  return BlockType.STONE;
}

// Cave-carving check: returns true if the block at (wx, y, wz) should be
// carved to AIR by overlapping 3D noise fields. Both noise values must be
// high (> 0.55) for a block to be carved, producing sparse tunnels rather
// than swiss cheese.
function shouldCarveCave(caveNoise1: Noise, caveNoise2: Noise, wx: number, y: number, wz: number): boolean {
  const c1 = caveNoise1.noise3D(wx * 0.05, y * 0.08, wz * 0.05);
  const c2 = caveNoise2.noise3D(wx * 0.05 + 100, y * 0.08 + 100, wz * 0.05 + 100);
  return c1 > 0.55 && c2 > 0.55;
}
