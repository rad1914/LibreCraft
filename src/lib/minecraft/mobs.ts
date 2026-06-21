// Minimal mob system with two types:
//   - PASSIVE: harmless creatures that wander. When killed (by the
//     player attacking them), they drop FOOD that heals 6 HP when eaten.
//   - AGGRESSIVE: hostile creatures that chase the player and deal
//     contact damage. They spawn at night and despawn in daylight.
//
// Both types have gravity + AABB collision and wander AI. Aggressive
// mobs switch to chase mode when the player is within detection range.

import * as THREE from "three";
import { World } from "./world";
import { CHUNK_HEIGHT } from "./biomes";

const MAX_MOBS = 12;
const SPAWN_DISTANCE_MIN = 8;
const SPAWN_DISTANCE_MAX = 16;
const DESPAWN_DISTANCE = 40;
const DETECTION_RANGE = 10; // aggressive mobs detect player within this
const CONTACT_DAMAGE = 4; // 2 hearts per attack
const CONTACT_RANGE = 1.0;

export type MobType = "passive" | "aggressive";

export interface MobCallbacks {
  onDamagePlayer?: (amount: number) => void;
  onMobKilled?: (mob: Mob) => void;
}

export class Mob {
  mesh: THREE.Group;
  vx = 0;
  vz = 0;
  vy = 0;
  onGround = false;
  directionTimer = 0;
  type: MobType;
  health: number;
  maxHealth: number;
  callbacks: MobCallbacks;
  damageCooldown = 0;

  constructor(x: number, y: number, z: number, type: MobType, callbacks: MobCallbacks) {
    this.type = type;
    this.callbacks = callbacks;
    if (type === "aggressive") {
      this.maxHealth = 6;
      this.health = 6;
      this.mesh = buildAggressiveModel();
    } else {
      this.maxHealth = 4;
      this.health = 4;
      this.mesh = buildPassiveModel();
    }
    this.mesh.position.set(x, y, z);
    this.pickDirection();
  }

  private pickDirection() {
    const angle = Math.random() * Math.PI * 2;
    const speed = this.type === "aggressive" ? 1.2 : 0.8;
    this.vx = Math.cos(angle) * speed;
    this.vz = Math.sin(angle) * speed;
    this.directionTimer = 2 + Math.random() * 3;
  }

  takeDamage(amount: number): boolean {
    this.health -= amount;
    // Flash red on hit — iterate all meshes in the group
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        child.material.emissive.setHex(0xff0000);
        child.material.emissiveIntensity = 0.8;
      }
    });
    setTimeout(() => {
      if (this.health > 0) {
        this.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
            child.material.emissive.setHex(this.type === "aggressive" ? 0x440000 : 0x222222);
            child.material.emissiveIntensity = 0.3;
          }
        });
      }
    }, 100);
    return this.health <= 0;
  }

  update(dt: number, world: World, playerPos: THREE.Vector3) {
    // Gravity
    this.vy += -20 * dt;
    if (this.vy < -30) this.vy = -30;

    // Damage cooldown
    this.damageCooldown -= dt;

    // Aggressive mob AI: chase player if within detection range
    if (this.type === "aggressive") {
      const dx = playerPos.x - this.mesh.position.x;
      const dz = playerPos.z - this.mesh.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < DETECTION_RANGE * DETECTION_RANGE) {
        const dist = Math.sqrt(distSq);
        const speed = 2.0;
        this.vx = (dx / dist) * speed;
        this.vz = (dz / dist) * speed;
        // Auto-jump: if on ground and moving toward a wall, jump
        if (this.onGround) {
          const ahead = 0.5;
          const fx = Math.floor(this.mesh.position.x + this.vx * ahead);
          const fz = Math.floor(this.mesh.position.z + this.vz * ahead);
          const fy = Math.floor(this.mesh.position.y);
          if (world.isSolidAt(fx, fy, fz) && !world.isSolidAt(fx, fy + 1, fz)) {
            this.vy = 7.0; // jump
            this.onGround = false;
          }
        }
        // Contact damage
        if (distSq < CONTACT_RANGE * CONTACT_RANGE && this.damageCooldown <= 0) {
          this.callbacks.onDamagePlayer?.(CONTACT_DAMAGE);
          this.damageCooldown = 1.0; // 1 damage per second
        }
      } else {
        // Wander
        this.directionTimer -= dt;
        if (this.directionTimer <= 0) {
          if (Math.random() < 0.3) { this.vx = 0; this.vz = 0; }
          else this.pickDirection();
        }
      }
    } else {
      // Passive mob: wander, flee from player if very close
      const dx = playerPos.x - this.mesh.position.x;
      const dz = playerPos.z - this.mesh.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < 9) { // within 3 blocks, flee
        const dist = Math.sqrt(distSq);
        const speed = 1.6;
        this.vx = -(dx / dist) * speed;
        this.vz = -(dz / dist) * speed;
      } else {
        this.directionTimer -= dt;
        if (this.directionTimer <= 0) {
          if (Math.random() < 0.3) { this.vx = 0; this.vz = 0; }
          else this.pickDirection();
        }
      }
    }

    // Move + collide
    this.moveAxis(world, this.vx * dt, 0, 0);
    this.moveAxis(world, 0, 0, this.vz * dt);
    this.moveAxis(world, 0, this.vy * dt, 0);
  }

  private moveAxis(world: World, dx: number, dy: number, dz: number) {
    const p = this.mesh.position;
    p.x += dx;
    p.y += dy;
    p.z += dz;
    const r = 0.4;
    const h = this.type === "aggressive" ? 0.8 : 0.7;
    const minX = Math.floor(p.x - r);
    const maxX = Math.floor(p.x + r);
    const minY = Math.floor(p.y);
    const maxY = Math.floor(p.y + h);
    const minZ = Math.floor(p.z - r);
    const maxZ = Math.floor(p.z + r);
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!world.isSolidAt(x, y, z)) continue;
          if (dy < 0) { p.y = y + 1; this.vy = 0; this.onGround = true; }
          else if (dy > 0) { p.y = y - h; this.vy = 0; }
          if (dx > 0) { p.x = x - r - 0.01; this.vx = -this.vx * 0.5; }
          else if (dx < 0) { p.x = x + 1 + r + 0.01; this.vx = -this.vx * 0.5; }
          if (dz > 0) { p.z = z - r - 0.01; this.vz = -this.vz * 0.5; }
          else if (dz < 0) { p.z = z + 1 + r + 0.01; this.vz = -this.vz * 0.5; }
        }
      }
    }
    if (dy === 0) this.onGround = false;
  }
}

export class MobManager {
  mobs: Mob[] = [];
  scene: THREE.Scene;
  world: World;
  callbacks: MobCallbacks;
  spawnTimer = 0;

  constructor(scene: THREE.Scene, world: World, callbacks: MobCallbacks = {}) {
    this.scene = scene;
    this.world = world;
    this.callbacks = callbacks;
  }

  update(dt: number, playerPos: THREE.Vector3, dayFactor: number) {
    // Spawn at night
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.mobs.length < MAX_MOBS) {
      this.spawnTimer = 2 + Math.random() * 3;
      // At night: 60% aggressive, 40% passive. Daytime: passive only.
      const isNight = dayFactor < 0.3;
      const type: MobType = isNight ? (Math.random() < 0.6 ? "aggressive" : "passive") : "passive";
      // Don't spawn aggressive mobs during day
      if (type === "aggressive" && !isNight) return;
      this.trySpawn(playerPos, type);
    }

    // Despawn in daylight (aggressive) or when too far (all)
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      const dx = m.mesh.position.x - playerPos.x;
      const dz = m.mesh.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      const shouldDespawn = (m.type === "aggressive" && dayFactor > 0.5) || dist > DESPAWN_DISTANCE;
      if (shouldDespawn) {
        this.removeMob(i);
        continue;
      }
      m.update(dt, this.world, playerPos);
    }
  }

  private trySpawn(playerPos: THREE.Vector3, type: MobType) {
    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_DISTANCE_MIN + Math.random() * (SPAWN_DISTANCE_MAX - SPAWN_DISTANCE_MIN);
    const x = Math.floor(playerPos.x + Math.cos(angle) * dist);
    const z = Math.floor(playerPos.z + Math.sin(angle) * dist);
    const startY = Math.min(CHUNK_HEIGHT - 3, Math.floor(playerPos.y) + 10);
    for (let y = startY; y > 1; y--) {
      if (this.world.isSolidAt(x, y, z) && !this.world.isSolidAt(x, y + 1, z) && !this.world.isSolidAt(x, y + 2, z)) {
        const mob = new Mob(x + 0.5, y + 1, z + 0.5, type, this.callbacks);
        this.mobs.push(mob);
        this.scene.add(mob.mesh);
        return;
      }
    }
  }

  // Raycast hit test: returns the mob closest to the player within reach,
  // or null. Used for attacking mobs.
  getMobAt(rayOrigin: THREE.Vector3, rayDir: THREE.Vector3, maxDist: number): Mob | null {
    let closest: Mob | null = null;
    let closestDist = maxDist;
    for (const m of this.mobs) {
      const dx = m.mesh.position.x - rayOrigin.x;
      const dy = m.mesh.position.y - rayOrigin.y;
      const dz = m.mesh.position.z - rayOrigin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > closestDist) continue;
      // Check if the ray points roughly at the mob (dot product)
      const dot = (dx * rayDir.x + dy * rayDir.y + dz * rayDir.z) / (dist || 1);
      if (dot > 0.92) { // within ~23 degrees of the mob
        closest = m;
        closestDist = dist;
      }
    }
    return closest;
  }

  // Deal damage to a mob. Returns true if the mob was killed.
  damageMob(mob: Mob, amount: number): boolean {
    const killed = mob.takeDamage(amount);
    if (killed) {
      const idx = this.mobs.indexOf(mob);
      if (idx >= 0) {
        this.callbacks.onMobKilled?.(mob);
        this.removeMob(idx);
      }
    }
    return killed;
  }

  private removeMob(i: number) {
    const m = this.mobs[i];
    this.scene.remove(m.mesh);
    m.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });
    this.mobs.splice(i, 1);
  }

  // Remove all aggressive mobs (used when the player sleeps through the night).
  despawnAggressive() {
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      if (this.mobs[i].type === "aggressive") {
        this.removeMob(i);
      }
    }
  }

  dispose() {
    for (const m of this.mobs) {
      this.scene.remove(m.mesh);
      m.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
    }
    this.mobs = [];
  }
}

// --- Entity model builders ---

// Aggressive mob: a zombie-like figure with body, head, arms, legs.
function buildAggressiveModel(): THREE.Group {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x4a7a3a, emissive: 0x223322, emissiveIntensity: 0.3 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a5a1a, emissive: 0x112211, emissiveIntensity: 0.2 });
  const eye = new THREE.MeshLambertMaterial({ color: 0xff3300, emissive: 0xff3300, emissiveIntensity: 0.8 });

  // Body (0.5 wide, 0.6 tall, 0.3 deep)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), skin);
  body.position.set(0, 0.5, 0);
  group.add(body);

  // Head (0.4 cube on top)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skin);
  head.position.set(0, 1.0, 0);
  group.add(head);

  // Eyes (red, on front of head)
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eye);
  eyeL.position.set(-0.1, 1.02, 0.2);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eye);
  eyeR.position.set(0.1, 1.02, 0.2);
  group.add(eyeR);

  // Arms (0.15 x 0.5 x 0.15, on sides)
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), dark);
  armL.position.set(-0.33, 0.55, 0);
  group.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), dark);
  armR.position.set(0.33, 0.55, 0);
  group.add(armR);

  // Legs (0.18 x 0.4 x 0.18)
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.18), dark);
  legL.position.set(-0.12, 0.0, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.18), dark);
  legR.position.set(0.12, 0.0, 0);
  group.add(legR);

  return group;
}

// Passive mob: a pig-like figure with body, head, snout, legs.
function buildPassiveModel(): THREE.Group {
  const group = new THREE.Group();
  const colors = [0xe8b890, 0xd4a070, 0xc9b36a, 0xf0d0a0];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const bodyMat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b, emissive: 0x442211, emissiveIntensity: 0.2 });

  // Body (0.6 wide, 0.4 tall, 0.8 long — horizontal)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.8), bodyMat);
  body.position.set(0, 0.4, 0);
  group.add(body);

  // Head (0.35 cube at front)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.3), bodyMat);
  head.position.set(0, 0.45, 0.5);
  group.add(head);

  // Snout (0.15 x 0.12 x 0.08)
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.08), darkMat);
  snout.position.set(0, 0.4, 0.66);
  group.add(snout);

  // Legs (0.12 x 0.3 x 0.12, four)
  const legPositions = [
    [-0.18, 0, 0.3], [0.18, 0, 0.3],
    [-0.18, 0, -0.3], [0.18, 0, -0.3],
  ];
  for (const [lx, ly, lz] of legPositions) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), darkMat);
    leg.position.set(lx, ly + 0.15, lz);
    group.add(leg);
  }

  return group;
}
