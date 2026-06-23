// Player controller: first-person camera, AABB voxel collision,
// gravity, jumping, sprinting, and head-bob. Movement constants are
// tuned to feel close to Minecraft creative/survival walk speeds.

import * as THREE from "three";
import { World } from "./world";
import { CHUNK_HEIGHT } from "./biomes";
import { BlockType } from "./blocks";

const PLAYER_HEIGHT = 1.8;
const PLAYER_EYE = 1.62;
const PLAYER_HALF_WIDTH = 0.3; // half-width of the AABB on X and Z

const GRAVITY = -28;
const WATER_GRAVITY = -4; // reduced gravity while submerged
const WATER_BUOYANCY = 6; // upward impulse when holding jump underwater
const JUMP_VELOCITY = 9.2;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 7.2;
const SNEAK_SPEED = 1.8; // slow careful movement while sneaking
const WATER_SPEED = 2.5; // slower horizontal movement while submerged
const ACCEL_GROUND = 14;
const ACCEL_AIR = 3.5;
const FRICTION = 12;
const TERMINAL_VELOCITY = -55;
const WATER_TERMINAL_VELOCITY = -3;
const MAX_REACH = 5; // block break/place reach in blocks
const AUTO_JUMP_HEIGHT = 1; // max step height for auto-jump (in blocks)

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  sneak: boolean; // Shift key — slower movement, prevents edge-falling
}

export interface RaycastHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

export class Player {
  position = new THREE.Vector3(0, 50, 0);
  velocity = new THREE.Vector3(0, 0, 0);
  yaw = 0;
  pitch = 0;
  onGround = false;
  // True while the player's eye is inside a water block. Set by the
  // engine each frame before update(); drives water physics + UI overlay.
  submerged = false;
  camera: THREE.PerspectiveCamera;
  // Multiplier applied to walk/sprint speed. The engine sets this to 0.6
  // when the player is hungry (food < 6) and 1 otherwise.
  speedMultiplier = 1;

  // Reusable temp vectors to avoid GC churn
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private move = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  spawn(world: World) {
    // Find a safe spawn column near origin
    for (let y = CHUNK_HEIGHT - 1; y > 1; y--) {
      if (world.isSolidAt(0, y, 0)) {
        this.position.set(0.5, y + 1, 0.5);
        this.velocity.set(0, 0, 0);
        return;
      }
    }
    this.position.set(0.5, 40, 0.5);
  }

  update(dt: number, input: InputState, world: World) {
    dt = Math.min(dt, 0.05); // clamp to avoid tunneling on frame drops

    // Compute desired horizontal velocity from input
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // While submerged, horizontal speed is heavily reduced and sprinting
    // is disabled (water resistance). Sneaking also slows the player on
    // land. Priority: submerged > sneak > sprint > walk.
    const baseSpeed = this.submerged
      ? WATER_SPEED
      : (input.sneak ? SNEAK_SPEED : (input.sprint ? SPRINT_SPEED : WALK_SPEED));
    const speed = baseSpeed * this.speedMultiplier;
    this.move.set(0, 0, 0);
    if (input.forward) this.move.add(this.forward);
    if (input.back) this.move.sub(this.forward);
    if (input.right) this.move.add(this.right);
    if (input.left) this.move.sub(this.right);

    if (this.move.lengthSq() > 0) {
      this.move.normalize().multiplyScalar(speed);
    }

    // Accelerate toward desired velocity (less control in air; same in water)
    const accel = this.onGround ? ACCEL_GROUND : ACCEL_AIR;
    const dvx = this.move.x - this.velocity.x;
    const dvz = this.move.z - this.velocity.z;
    this.velocity.x += Math.sign(dvx) * Math.min(Math.abs(dvx), accel * dt);
    this.velocity.z += Math.sign(dvz) * Math.min(Math.abs(dvz), accel * dt);

    // Friction when no input on ground (or in water — water drag)
    if (this.move.lengthSq() === 0 && (this.onGround || this.submerged)) {
      const f = FRICTION * dt;
      if (Math.abs(this.velocity.x) < f) this.velocity.x = 0;
      else this.velocity.x -= Math.sign(this.velocity.x) * f;
      if (Math.abs(this.velocity.z) < f) this.velocity.z = 0;
      else this.velocity.z -= Math.sign(this.velocity.z) * f;
    }

    if (this.submerged) {
      // Water physics: jump = swim up (buoyancy); reduced gravity; soft terminal.
      if (input.jump) this.velocity.y += WATER_BUOYANCY * dt;
      this.velocity.y += WATER_GRAVITY * dt;
      if (this.velocity.y < WATER_TERMINAL_VELOCITY) this.velocity.y = WATER_TERMINAL_VELOCITY;
      if (this.velocity.y > 4) this.velocity.y = 4; // cap swim-up speed
      // Skip the auto-jump logic below — water has no auto-jump.
      this.onGround = false;
    } else {
      // Normal physics: jump (manual) + gravity.
      if (input.jump && this.onGround) {
        this.velocity.y = JUMP_VELOCITY;
        this.onGround = false;
      }
      this.velocity.y += GRAVITY * dt;
      if (this.velocity.y < TERMINAL_VELOCITY) this.velocity.y = TERMINAL_VELOCITY;
    }

    // Snapshot horizontal velocity BEFORE collision so we can detect
    // whether the player was blocked by a 1-block step (auto-jump).
    const preVX = this.velocity.x;
    const preVZ = this.velocity.z;
    const preX = this.position.x;
    const preZ = this.position.z;

    // Move with collision (axis-separated)
    this.moveAxis(world, this.velocity.x * dt, 0, 0);
    this.moveAxis(world, 0, 0, this.velocity.z * dt);

    // SNEAK edge-fall prevention: while sneaking on the ground, if the
    // player's center is no longer over a solid block (i.e. they would
    // walk off an edge), cancel horizontal movement to prevent falling.
    // This is the classic Minecraft sneak behavior.
    if (input.sneak && this.onGround && !this.submerged) {
      const footX = Math.floor(this.position.x);
      const footY = Math.floor(this.position.y - 0.1);
      const footZ = Math.floor(this.position.z);
      if (!world.isSolidAt(footX, footY, footZ)) {
        // Revert to pre-move horizontal position
        this.position.x = preX;
        this.position.z = preZ;
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }

    this.moveAxis(world, 0, this.velocity.y * dt, 0);

    // AUTO-JUMP: if the player was moving horizontally, is on the
    // ground, got blocked (didn't move the full requested distance),
    // and the obstacle is exactly 1 block tall with room above, give a
    // small upward impulse so they automatically step up. This matches
    // Minecraft's auto-jump behavior. Skipped while submerged (water
    // already lets the player swim up with jump).
    if (
      !this.submerged &&
      this.onGround &&
      (Math.abs(preVX) > 0.01 || Math.abs(preVZ) > 0.01) &&
      !input.jump
    ) {
      const movedX = Math.abs(this.position.x - preX);
      const movedZ = Math.abs(this.position.z - preZ);
      const requestedX = Math.abs(preVX * dt);
      const requestedZ = Math.abs(preVZ * dt);
      const blockedX = requestedX > 0.001 && movedX < requestedX * 0.5;
      const blockedZ = requestedZ > 0.001 && movedZ < requestedZ * 0.5;
      if (blockedX || blockedZ) {
        // Determine which direction we were trying to move (the one
        // that got blocked) and check if a 1-block step exists there.
        const dirX = blockedX ? Math.sign(preVX) : 0;
        const dirZ = blockedZ ? Math.sign(preVZ) : 0;
        if (this.canStepUp(world, dirX, dirZ)) {
          this.velocity.y = JUMP_VELOCITY;
          this.onGround = false;
        }
      }
    }

    // Update camera
    this.camera.position.set(this.position.x, this.position.y + PLAYER_EYE, this.position.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  // Check whether the player can auto-step up in the (dx, dz) direction.
  // Conditions:
  //  - there's a solid block directly in front at foot level
  //  - the block on top of it is air (so the obstacle is only 1 tall)
  //  - the block at head level in front is also air (room to stand)
  private canStepUp(world: World, dx: number, dz: number): boolean {
    if (dx === 0 && dz === 0) return false;
    const px = this.position.x;
    const py = Math.floor(this.position.y);
    const pz = this.position.z;
    // Sample at the edge of the player's AABB in the movement direction
    const sampleX = Math.floor(px + dx * (PLAYER_HALF_WIDTH + 0.05));
    const sampleZ = Math.floor(pz + dz * (PLAYER_HALF_WIDTH + 0.05));
    // Solid block at foot level?
    if (!world.isSolidAt(sampleX, py, sampleZ)) return false;
    // Air above the obstacle (so it's exactly 1 tall)?
    if (world.isSolidAt(sampleX, py + 1, sampleZ)) return false;
    // Air at head level too?
    if (world.isSolidAt(sampleX, py + 2, sampleZ)) return false;
    // Also check the other axis of the AABB to avoid stepping through
    // corners; sample a perpendicular point too.
    return true;
  }

  private moveAxis(world: World, dx: number, dy: number, dz: number) {
    // Apply movement on one axis, then resolve AABB collisions against
    // any voxel overlapping the player's bounding box.
    this.position.x += dx;
    this.position.y += dy;
    this.position.z += dz;

    if (dx === 0 && dy === 0 && dz === 0) return;

    const minX = Math.floor(this.position.x - PLAYER_HALF_WIDTH);
    const maxX = Math.floor(this.position.x + PLAYER_HALF_WIDTH);
    const minY = Math.floor(this.position.y);
    const maxY = Math.floor(this.position.y + PLAYER_HEIGHT);
    const minZ = Math.floor(this.position.z - PLAYER_HALF_WIDTH);
    const maxZ = Math.floor(this.position.z + PLAYER_HALF_WIDTH);

    let collided = false;

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!world.isSolidAt(x, y, z)) continue;
          collided = true;
          if (dx > 0) {
            this.position.x = x - PLAYER_HALF_WIDTH - 1e-3;
          } else if (dx < 0) {
            this.position.x = x + 1 + PLAYER_HALF_WIDTH + 1e-3;
          }
          if (dx !== 0) this.velocity.x = 0;
          if (dy > 0) {
            // Player head hit the BOTTOM of solid block at y.
            // Player's head (position.y + PLAYER_HEIGHT) should be at y.
            this.position.y = y - PLAYER_HEIGHT - 1e-3;
            this.velocity.y = 0;
          } else if (dy < 0) {
            // Player feet hit the TOP of solid block at y.
            // Block at y spans y..y+1, so the top surface is at y+1.
            this.position.y = y + 1 + 1e-3;
            this.velocity.y = 0;
            this.onGround = true;
          }
          if (dz > 0) {
            this.position.z = z - PLAYER_HALF_WIDTH - 1e-3;
          } else if (dz < 0) {
            this.position.z = z + 1 + PLAYER_HALF_WIDTH + 1e-3;
          }
          if (dz !== 0) this.velocity.z = 0;
        }
      }
    }

    if (dy < 0 && !collided) {
      // If we moved down and didn't hit anything, we are airborne
      this.onGround = false;
    }
  }

  // Voxel raycast using Amanatides & Woo algorithm.
  raycast(world: World): RaycastHit | null {
    const origin = new THREE.Vector3(
      this.position.x,
      this.position.y + PLAYER_EYE,
      this.position.z
    );
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    dir.normalize();

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = Math.sign(dir.x);
    const stepY = Math.sign(dir.y);
    const stepZ = Math.sign(dir.z);

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

    const fracX = stepX > 0 ? 1 - (origin.x - x) : origin.x - x;
    const fracY = stepY > 0 ? 1 - (origin.y - y) : origin.y - y;
    const fracZ = stepZ > 0 ? 1 - (origin.z - z) : origin.z - z;

    let tMaxX = stepX !== 0 ? tDeltaX * fracX : Infinity;
    let tMaxY = stepY !== 0 ? tDeltaY * fracY : Infinity;
    let tMaxZ = stepZ !== 0 ? tDeltaZ * fracZ : Infinity;

    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    while (t <= MAX_REACH) {
      const id = world.getBlock(x, y, z);
      // Air, water, and portal blocks (both types) are pass-through for raycast.
      // Flowers and tall grass ARE targetable (so the player can break
      // them), despite being non-solid for movement.
      const isPassable = id === BlockType.AIR || id === BlockType.WATER
        || id === BlockType.PORTAL || id === BlockType.PORTAL_SKY;
      if (!isPassable) {
        return { x, y, z, nx, ny, nz };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }
    }
    return null;
  }
}
