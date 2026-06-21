// World: manages a Map of chunks keyed by "cx,cz", streams chunks in
// around the player, exposes world-level block get/set, and triggers
// neighbor re-meshing on edits so chunk borders stay consistent.

import * as THREE from "three";
import { Chunk, ChunkNeighborGetter } from "./chunk";
import { CHUNK_SIZE, CHUNK_HEIGHT } from "./biomes";
import { BlockType, isSolid } from "./blocks";
import { Noise } from "./noise";
import { getTextureAtlas } from "./textures";

export class World {
  chunks = new Map<string, Chunk>();
  scene: THREE.Scene;
  seed: number;

  material: THREE.Material;
  transparentMaterial: THREE.Material;

  edits = new Map<string, number>();

  private heightNoise: Noise;
  private biomeNoise: Noise;
  private tempNoise: Noise;

  constructor(scene: THREE.Scene, seed: number = 1337) {
    this.scene = scene;
    this.seed = seed;
    this.heightNoise = new Noise(seed);
    this.biomeNoise = new Noise(seed + 1);
    this.tempNoise = new Noise(seed + 2);

    const atlas = getTextureAtlas();
    this.material = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      side: THREE.FrontSide,
      alphaTest: 0.5,
    });
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: true,
      alphaTest: 0.05,
    });
  }

  private key(cx: number, cz: number): string {
    return cx + "," + cz;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(this.key(cx, cz));
  }

  ensureChunk(cx: number, cz: number): Chunk {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cz);
      c.generate(this.seed, this.heightNoise, this.biomeNoise, this.tempNoise);
      this.chunks.set(k, c);
      // Mark any already-existing neighbors dirty so their border faces
      // re-cull against the newly generated chunk's blocks.
      this.markDirty(cx - 1, cz);
      this.markDirty(cx + 1, cz);
      this.markDirty(cx, cz - 1);
      this.markDirty(cx, cz + 1);
    }
    return c;
  }

  // Stream chunks within `radius` of (playerX, playerZ); unload chunks
  // outside `radius + 1`. Limits rebuilds per call for performance.
  update(playerX: number, playerZ: number, radius: number) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);

    // Load — limit to 2 immediate rebuilds per call; the rest are
    // handled by processDirtyBudget on subsequent frames.
    let immediateRebuilds = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const c = this.ensureChunk(cx, cz);
        if (c.dirty && immediateRebuilds < 2) {
          this.rebuildChunk(c);
          immediateRebuilds++;
        }
      }
    }

    // Unload distant chunks
    const unload = radius + 2;
    for (const [k, c] of this.chunks) {
      const [cx, cz] = k.split(",").map(Number);
      if (Math.abs(cx - pcx) > unload || Math.abs(cz - pcz) > unload) {
        if (c.opaqueMesh) this.scene.remove(c.opaqueMesh);
        if (c.transparentMesh) this.scene.remove(c.transparentMesh);
        c.dispose();
        this.chunks.delete(k);
      }
    }
  }

  // Rebuild a dirty chunk's meshes and properly sync the scene graph:
  // remove the OLD meshes from the scene (if any), dispose their
  // geometries, build new meshes, and add the new ones to the scene.
  // This is the fix for the "broken block texture still renders" bug —
  // previously the old Mesh object was left in scene.children with a
  // disposed geometry, and the new mesh was never added because the
  // world only added when `!hadOpaque`.
  private rebuildChunk(c: Chunk) {
    if (c.opaqueMesh) this.scene.remove(c.opaqueMesh);
    if (c.transparentMesh) this.scene.remove(c.transparentMesh);
    c.buildMeshes(this.material, this.transparentMaterial, this.neighborGetter);
    if (c.opaqueMesh) this.scene.add(c.opaqueMesh);
    if (c.transparentMesh) this.scene.add(c.transparentMesh);
  }

  // Re-mesh any chunk currently flagged dirty. Called per-frame with a
  // budget so we don't freeze the main thread generating everything at
  // once after a teleport.
  processDirtyBudget(budgetMs: number): number {
    const start = performance.now();
    let processed = 0;
    for (const [, c] of this.chunks) {
      if (!c.dirty) continue;
      this.rebuildChunk(c);
      processed++;
      if (performance.now() - start > budgetMs) break;
    }
    return processed;
  }

  private neighborGetter: ChunkNeighborGetter = (wx, wy, wz) => {
    return this.getBlock(wx, wy, wz);
  };

  getBlock(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BlockType.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return BlockType.AIR;
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    return chunk.getLocal(lx, wy, lz);
  }

  setBlock(wx: number, wy: number, wz: number, id: number) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    chunk.setLocal(lx, wy, lz, id);

    // Record this edit for persistence.
    this.edits.set(`${wx},${wy},${wz}`, id);

    // Mark this chunk + any neighbor chunk that touches the edited
    // column so border faces re-cull correctly.
    chunk.dirty = true;
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
  }

  // Replay saved block edits (called on load). Each edit is applied
  // via setBlock so chunk meshes rebuild correctly.
  applyEdits(edits: Array<{ x: number; y: number; z: number; id: number }>) {
    for (const e of edits) {
      // Use a direct path that doesn't re-record the edit (to avoid
      // redundant work — the edits map is already populated below).
      const cx = Math.floor(e.x / CHUNK_SIZE);
      const cz = Math.floor(e.z / CHUNK_SIZE);
      const chunk = this.ensureChunk(cx, cz);
      const lx = e.x - cx * CHUNK_SIZE;
      const lz = e.z - cz * CHUNK_SIZE;
      chunk.setLocal(lx, e.y, lz, e.id);
      chunk.dirty = true;
      if (lx === 0) this.markDirty(cx - 1, cz);
      if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
      if (lz === 0) this.markDirty(cx, cz - 1);
      if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
      this.edits.set(`${e.x},${e.y},${e.z}`, e.id);
    }
  }

  // Serialize edits for save.
  getEdits(): Array<{ x: number; y: number; z: number; id: number }> {
    const out: Array<{ x: number; y: number; z: number; id: number }> = [];
    for (const [key, id] of this.edits) {
      const [x, y, z] = key.split(",").map(Number);
      out.push({ x, y, z, id });
    }
    return out;
  }

  private markDirty(cx: number, cz: number) {
    const c = this.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  isSolidAt(wx: number, wy: number, wz: number): boolean {
    return isSolid(this.getBlock(Math.floor(wx), Math.floor(wy), Math.floor(wz)));
  }
}