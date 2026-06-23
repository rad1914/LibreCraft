// World: manages a Map of chunks keyed by "cx,cz", streams chunks in
// around the player, exposes world-level block get/set, and triggers
// neighbor re-meshing on edits so chunk borders stay consistent.

import * as THREE from "three";
import { Chunk, ChunkNeighborGetter } from "./chunk";
import { CHUNK_SIZE, CHUNK_HEIGHT } from "./biomes";
import { BlockType, isSolid } from "./blocks";
import { Noise } from "./noise";
import { getTextureAtlas } from "./textures";

export type Dimension = "overworld" | "sky";

export class World {
  chunks = new Map<string, Chunk>();
  scene: THREE.Scene;
  seed: number;
  dimension: Dimension;

  material: THREE.Material;
  transparentMaterial: THREE.Material;

  edits = new Map<string, number>();

  // Open doors — tracks which DOOR blocks are currently "open" (pass-through).
  // Keyed by "x,y,z" of the door's BASE block (the bottom half of the 2-tall door).
  // The block id stays DOOR whether open or closed; this Set records the
  // open state so isSolidAt can return false for open doors.
  openDoors = new Set<string>();

  // Blocks queued by terrain generation that fell outside their origin
  // chunk (e.g. tree leaves spanning a chunk border). Drained into a
  // chunk the moment that chunk is generated. Keyed by `${wx},${wy},${wz}`.
  pendingExtraBlocks = new Map<string, number>();

  private heightNoise: Noise;
  private biomeNoise: Noise;
  private tempNoise: Noise;

  constructor(scene: THREE.Scene, seed: number = 1337, dimension: Dimension = "overworld") {
    this.scene = scene;
    this.seed = seed;
    this.dimension = dimension;
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
      // Pass a callback so tree leaves that span a chunk border are
      // stored safely on this World and applied when their target chunk
      // is generated (instead of being silently dropped at the edge).
      c.generate(this.seed, this.heightNoise, this.biomeNoise, this.tempNoise, this.dimension, (wx, wy, wz, id) => {
        const tcx = Math.floor(wx / CHUNK_SIZE);
        const tcz = Math.floor(wz / CHUNK_SIZE);
        if (tcx === cx && tcz === cz) {
          // Same chunk — write directly through setLocal.
          const lx = wx - tcx * CHUNK_SIZE;
          const lz = wz - tcz * CHUNK_SIZE;
          c.setLocal(lx, wy, lz, id);
        } else {
          // Different chunk — queue it for the neighbor.
          this.pendingExtraBlocks.set(`${wx},${wy},${wz}`, id);
        }
      });
      this.chunks.set(k, c);
      // Drain any pending extra-blocks for THIS chunk that were queued
      // by a neighbor's earlier tree placement.
      this.drainPendingForChunk(c, cx, cz);
      // Mark any already-existing neighbors dirty so their border faces
      // re-cull against the newly generated chunk's blocks.
      this.markDirty(cx - 1, cz);
      this.markDirty(cx + 1, cz);
      this.markDirty(cx, cz - 1);
      this.markDirty(cx, cz + 1);
    }
    return c;
  }

  // Apply any deferred cross-chunk blocks that targeted (cx, cz).
  private drainPendingForChunk(c: Chunk, cx: number, cz: number) {
    if (this.pendingExtraBlocks.size === 0) return;
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    // Iterate keys; we can't avoid a scan because the map is keyed by
    // world coordinates, not by chunk. This is bounded by total pending
    // size (a few hundred at most during normal play).
    const toDelete: string[] = [];
    for (const [key, id] of this.pendingExtraBlocks) {
      const [sx, sy, sz] = key.split(",");
      const wx = +sx, wy = +sy, wz = +sz;
      const tcx = Math.floor(wx / CHUNK_SIZE);
      const tcz = Math.floor(wz / CHUNK_SIZE);
      if (tcx === cx && tcz === cz) {
        const lx = wx - baseX;
        const lz = wz - baseZ;
        if (wy >= 0 && wy < CHUNK_HEIGHT) {
          c.setLocal(lx, wy, lz, id);
        }
        toDelete.push(key);
      }
    }
    for (const k of toDelete) this.pendingExtraBlocks.delete(k);
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
    this.markDirtyAndNeighbors(chunk, cx, cz, lx, lz);
  }

  // Replay saved block edits (called on load). Each edit is applied
  // via setBlock so chunk meshes rebuild correctly.
  applyEdits(edits: Array<{ x: number; y: number; z: number; id: number }>) {
    for (const e of edits) this.setBlock(e.x, e.y, e.z, e.id);
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

  // Public helper: mark the chunk containing (wx, wy, wz) as dirty so it
  // re-meshes on the next processDirtyBudget tick. Used by the engine
  // when door open/close state changes (no block id change, just visual).
  markDirtyAt(wx: number, wy: number, wz: number) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    this.markDirty(cx, cz);
  }

  // Mark the edited chunk dirty, plus any neighbor chunk whose border
  // touches the edited column.
  private markDirtyAndNeighbors(chunk: Chunk, cx: number, cz: number, lx: number, lz: number) {
    chunk.dirty = true;
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
  }

  isSolidAt(wx: number, wy: number, wz: number): boolean {
    const x = Math.floor(wx), y = Math.floor(wy), z = Math.floor(wz);
    const id = this.getBlock(x, y, z);
    // Open doors are pass-through — check if this block (or the block
    // below it, if this is the top half of a door) is an open door.
    if (id === BlockType.DOOR) {
      // Normalize to the base block (doors are 2 tall).
      const baseY = this.getBlock(x, y - 1, z) === BlockType.DOOR ? y - 1 : y;
      if (this.openDoors.has(`${x},${baseY},${z}`)) return false;
    }
    return isSolid(id);
  }

  // Toggle a door's open/closed state. Returns true if the door is now
  // open, false if now closed.
  toggleDoor(wx: number, wy: number, wz: number): boolean {
    // Normalize to the base block.
    let baseY = wy;
    if (this.getBlock(wx, wy - 1, wz) === BlockType.DOOR) baseY = wy - 1;
    const key = `${wx},${baseY},${wz}`;
    if (this.openDoors.has(key)) {
      this.openDoors.delete(key);
      return false;
    }
    this.openDoors.add(key);
    return true;
  }

  // Check if a door at (wx, wy, wz) is open. Handles both top and bottom
  // halves of the 2-tall door.
  isDoorOpen(wx: number, wy: number, wz: number): boolean {
    let baseY = wy;
    if (this.getBlock(wx, wy - 1, wz) === BlockType.DOOR) baseY = wy - 1;
    return this.openDoors.has(`${wx},${baseY},${wz}`);
  }
}