// Mob system with several types:
//   - PASSIVE: pig, cow, sheep — harmless creatures that wander. Drop
//     FOOD on death. Sheep also drop WOOL. Spawn only during the day.
//   - GOBLIN: green humanoid hostile. Faster and tougher than zombies.
//     Spawns at night, despawns in daylight.
//   - FLYING: phantom-like aerial mobs that swoop at the player.
//
// Iron golems are smarter now: they pathfind toward the nearest hostile
// mob within detection range, prioritizing mobs that are attacking
// villagers. They're also summoned by building a + cross of iron ore
// (handled in engine.ts, not here).

import * as THREE from "three";
import { World } from "./world";
import { CHUNK_HEIGHT } from "./biomes";
import { BlockType } from "./blocks";

type Dimension = "overworld" | "sky";

const MAX_MOBS = 12; // slightly reduced from 14 — denser spawns feel crowded
const SPAWN_DISTANCE_MIN = 8;
const SPAWN_DISTANCE_MAX = 18;
const DESPAWN_DISTANCE = 40;
const DETECTION_RANGE = 10;
const CONTACT_DAMAGE = 4;
const CONTACT_RANGE = 1.2;
const FLY_CONTACT_RANGE = 1.6;
const GOLEM_DETECTION_RANGE = 14; // golems scan further for hostiles
const GOLEM_ATTACK_RANGE = 2.0;
const GOLEM_DAMAGE = 8; // 4 hearts — heavy hitter
const GOLEM_ATTACK_COOLDOWN = 1.1;
const GOLEM_SPEED = 1.4;
const GOLEM_MAX_HEALTH = 60; // buffed from 40 — golems are tankier now
const GOBLIN_SPEED = 2.4;
const GOBLIN_HEALTH = 14;
const GOBLIN_DAMAGE = 5;
// Dragon: spawns only in the sky dimension. Big, slow flyer, heavy hitter.
const DRAGON_HEALTH = 30;
const DRAGON_DAMAGE = 7;
const DRAGON_SPEED = 3.0;
// Wolf: neutral passive mob. Attacks back if hit, otherwise wanders.
const WOLF_HEALTH = 8;
const WOLF_DAMAGE = 4;

export type MobType = "pig" | "cow" | "sheep" | "wolf" | "goblin" | "flying" | "dragon" | "villager" | "iron_golem";

// Display names for each mob type. The internal "flying" type is shown
// to the player as "Shade" — a spectral flying hostile mob.
export const MOB_DISPLAY_NAMES: Record<MobType, string> = {
  pig: "Pig",
  cow: "Cow",
  sheep: "Sheep",
  wolf: "Wolf",
  goblin: "Goblin",
  flying: "Shade",
  dragon: "Dragon",
  villager: "Villager",
  iron_golem: "Iron Golem",
};

interface MobCallbacks {
  onDamagePlayer?: (amount: number) => void;
  onMobKilled?: (mob: Mob) => void;
  // Knockback the player by (dx, dy, dz) — used by flying mobs that
  // physically shove the player on contact.
  onKnockbackPlayer?: (dx: number, dy: number, dz: number) => void;
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
  // Villager home position — villagers stay within ~12 blocks of this point.
  private villagerHomeX = 0;
  private villagerHomeZ = 0;
  // Iron golem AI: current target mob (set by MobManager each tick).
  // When set, the golem walks toward the target instead of wandering.
  golemTarget: Mob | null = null;
  // Walking animation phase — used to swing arms/legs on humanoid models.
  private animPhase = Math.random() * Math.PI * 2;

  // Flying mob AI phase: "hover" → "dive" → "return" → repeat.
  private flyPhase: "hover" | "dive" | "return" = "hover";
  private flyPhaseTimer = 2 + Math.random() * 2;
  private flyHomeX = 0;
  private flyHomeY = 0;
  private flyHomeZ = 0;
  private flapPhase = 0;

  constructor(x: number, y: number, z: number, type: MobType, callbacks: MobCallbacks) {
    this.type = type;
    this.callbacks = callbacks;
    switch (type) {
      case "goblin":     this.maxHealth = this.health = GOBLIN_HEALTH; this.mesh = buildGoblinModel(); break;
      case "flying":     this.maxHealth = this.health = 6; this.mesh = buildFlyingModel(); break;
      case "dragon":     this.maxHealth = this.health = DRAGON_HEALTH; this.mesh = buildDragonModel(); break;
      case "cow":        this.maxHealth = this.health = 10; this.mesh = buildCowModel(); break;
      case "sheep":      this.maxHealth = this.health = 8; this.mesh = buildSheepModel(); break;
      case "wolf":       this.maxHealth = this.health = WOLF_HEALTH; this.mesh = buildWolfModel(); break;
      case "villager":   this.maxHealth = this.health = 10; this.mesh = buildVillagerModel(); break;
      case "iron_golem": this.maxHealth = this.health = GOLEM_MAX_HEALTH; this.mesh = buildIronGolemModel(); break;
      default:           this.maxHealth = this.health = 6; this.mesh = buildPigModel(); break;
    }
    this.mesh.position.set(x, y, z);
    this.flyHomeX = x; this.flyHomeY = y; this.flyHomeZ = z;
    this.villagerHomeX = x; this.villagerHomeZ = z;
    this.pickDirection();
  }

  private pickDirection() {
    const angle = Math.random() * Math.PI * 2;
    const speed = this.type === "goblin" ? 1.5 : 0.8;
    this.vx = Math.cos(angle) * speed;
    this.vz = Math.sin(angle) * speed;
    this.directionTimer = 2 + Math.random() * 3;
  }

  takeDamage(amount: number): boolean {
    this.health -= amount;
    // Flash red on hit
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        child.material.emissive.setHex(0xff0000);
        child.material.emissiveIntensity = 0.8;
      }
    });
    setTimeout(() => { if (this.health > 0) this.restoreEmissive(); }, 100);
    return this.health <= 0;
  }

  // Heal the mob by `amount` HP, capped at maxHealth. Used by the engine
  // when the player feeds iron ore to a damaged iron golem.
  heal(amount: number) {
    if (this.health <= 0) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  private restoreEmissive() {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshLambertMaterial) {
        const isHostile = this.type === "goblin" || this.type === "flying" || this.type === "dragon";
        child.material.emissive.setHex(isHostile ? 0x440000 : 0x222222);
        child.material.emissiveIntensity = 0.3;
      }
    });
  }

  update(dt: number, world: World, playerPos: THREE.Vector3) {
    this.damageCooldown -= dt;
    this.animPhase += dt * 6;

    // Dragons use the flying AI but with a larger detection range and
    // heavier contact damage. Their model is bigger so contact range is wider.
    if (this.type === "flying" || this.type === "dragon") {
      this.updateFlying(dt, playerPos);
      return;
    }

    // Gravity for ground-based mobs
    this.vy += -20 * dt;
    if (this.vy < -30) this.vy = -30;

    switch (this.type) {
      case "goblin":     this.updateGoblin(dt, world, playerPos); break;
      case "iron_golem": this.updateIronGolem(dt, world, playerPos); break;
      case "villager":   this.updateVillager(dt, world, playerPos); break;
      case "wolf":       this.updateWolf(dt, world, playerPos); break;
      default:           this.updatePassive(dt, world, playerPos); break;
    }

    // Move + collide on each axis
    this.moveAxis(world, this.vx * dt, 0, 0);
    this.moveAxis(world, 0, 0, this.vz * dt);
    this.moveAxis(world, 0, this.vy * dt, 0);

    // Animate humanoid limbs (swing arms/legs based on horizontal speed)
    this.animateLimbs();

    // Face the movement direction
    if (Math.abs(this.vx) > 0.01 || Math.abs(this.vz) > 0.01) {
      this.mesh.rotation.y = Math.atan2(this.vx, this.vz);
    }
  }

  // Animate arm/leg swing on humanoid mobs (goblin, villager, golem).
  // The mesh children are tagged with userData.kind = "armL" / "armR" / "legL" / "legR".
  private animateLimbs() {
    const speed = Math.hypot(this.vx, this.vz);
    if (speed < 0.1) return;
    const swing = Math.sin(this.animPhase) * Math.min(0.6, speed * 0.25);
    this.mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const kind = child.userData.kind;
      if (!kind) return;
      if (kind === "armL" || kind === "legR") child.rotation.x = swing;
      else if (kind === "armR" || kind === "legL") child.rotation.x = -swing;
    });
  }

  // Goblin AI: chases the player when in detection range, occasionally
  // strafes sideways to fake dodging. Faster than passive mobs.
  private updateGoblin(dt: number, world: World, playerPos: THREE.Vector3) {
    const dx = playerPos.x - this.mesh.position.x;
    const dz = playerPos.z - this.mesh.position.z;
    const distSq = dx * dx + dz * dz;
    const detect = DETECTION_RANGE * 1.4;
    if (distSq < detect * detect) {
      const dist = Math.sqrt(distSq) || 1;
      // Strafe component: perpendicular vector, flips every ~1.5s
      const strafe = Math.sin(this.animPhase * 0.5) * 0.4;
      this.vx = (dx / dist) * GOBLIN_SPEED + (-dz / dist) * strafe * GOBLIN_SPEED;
      this.vz = (dz / dist) * GOBLIN_SPEED + (dx / dist) * strafe * GOBLIN_SPEED;
      this.autoJump(world);
      if (distSq < CONTACT_RANGE * CONTACT_RANGE && this.damageCooldown <= 0) {
        this.callbacks.onDamagePlayer?.(GOBLIN_DAMAGE);
        this.damageCooldown = 0.8;
      }
    } else {
      this.wanderIdle(dt);
    }
  }

  // Auto-jump: if there's a solid block ahead at foot level and air above it, leap.
  private autoJump(world: World) {
    if (!this.onGround) return;
    const ahead = 0.6;
    const fx = Math.floor(this.mesh.position.x + this.vx * ahead);
    const fz = Math.floor(this.mesh.position.z + this.vz * ahead);
    const fy = Math.floor(this.mesh.position.y);
    if (world.isSolidAt(fx, fy, fz) && !world.isSolidAt(fx, fy + 1, fz)) {
      this.vy = 7.0;
      this.onGround = false;
    }
  }

  private wanderIdle(dt: number) {
    this.directionTimer -= dt;
    if (this.directionTimer <= 0) {
      if (Math.random() < 0.3) { this.vx = 0; this.vz = 0; }
      else this.pickDirection();
    }
  }

  private updatePassive(dt: number, _world: World, playerPos: THREE.Vector3) {
    const dx = playerPos.x - this.mesh.position.x;
    const dz = playerPos.z - this.mesh.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < 9) {
      const dist = Math.sqrt(distSq) || 1;
      const speed = 1.6;
      this.vx = -(dx / dist) * speed;
      this.vz = -(dz / dist) * speed;
    } else {
      this.wanderIdle(dt);
    }
  }

  // Wolf AI: neutral. Wanders like a passive mob, but if the player
  // recently attacked it (health < maxHealth and not full), it chases
  // and bites. Otherwise it ignores the player.
  private updateWolf(dt: number, world: World, playerPos: THREE.Vector3) {
    const dx = playerPos.x - this.mesh.position.x;
    const dz = playerPos.z - this.mesh.position.z;
    const distSq = dx * dx + dz * dz;
    // Aggro if the wolf has been hit (health below max).
    const aggro = this.health < this.maxHealth;
    if (aggro && distSq < DETECTION_RANGE * DETECTION_RANGE) {
      const dist = Math.sqrt(distSq) || 1;
      const speed = 2.2;
      this.vx = (dx / dist) * speed;
      this.vz = (dz / dist) * speed;
      this.autoJump(world);
      if (distSq < CONTACT_RANGE * CONTACT_RANGE && this.damageCooldown <= 0) {
        this.callbacks.onDamagePlayer?.(WOLF_DAMAGE);
        this.damageCooldown = 0.8;
      }
    } else {
      // Wander like a passive mob, but don't flee.
      this.wanderIdle(dt);
    }
  }

  // Villager AI: stays near home (their house), wanders within a 12-block
  // radius, and walks back home if they stray too far. Avoids walking off
  // edges by checking for ground below.
  private updateVillager(dt: number, world: World, _playerPos: THREE.Vector3) {
    const homeDx = this.villagerHomeX - this.mesh.position.x;
    const homeDz = this.villagerHomeZ - this.mesh.position.z;
    const homeDist = Math.sqrt(homeDx * homeDx + homeDz * homeDz);
    if (homeDist > 12) {
      const speed = 1.0;
      this.vx = (homeDx / homeDist) * speed;
      this.vz = (homeDz / homeDist) * speed;
    } else {
      this.directionTimer -= dt;
      if (this.directionTimer <= 0) {
        if (Math.random() < 0.4) { this.vx = 0; this.vz = 0; }
        else {
          this.pickDirection();
          // Edge check — don't walk off cliffs.
          const aheadX = Math.floor(this.mesh.position.x + this.vx * 2);
          const aheadZ = Math.floor(this.mesh.position.z + this.vz * 2);
          const aheadY = Math.floor(this.mesh.position.y) - 1;
          if (!world.isSolidAt(aheadX, aheadY, aheadZ)) {
            this.vx = -this.vx; this.vz = -this.vz;
          }
        }
      }
    }
  }

  // Iron golem AI: smart protector. Walks toward its assigned target
  // (the nearest hostile mob within detection range, set by MobManager).
  // When close enough, attacks. When no target, wanders slowly near
  // villagers. Auto-jumps obstacles while pursuing.
  private updateIronGolem(dt: number, world: World, _playerPos: THREE.Vector3) {
    if (this.glemTarget) {
      const dx = this.glemTarget.mesh.position.x - this.mesh.position.x;
      const dz = this.glemTarget.mesh.position.z - this.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      if (dist > GOLEM_ATTACK_RANGE) {
        this.vx = (dx / dist) * GOLEM_SPEED;
        this.vz = (dz / dist) * GOLEM_SPEED;
        this.autoJump(world);
      } else {
        // In range — stop and let MobManager apply damage on its tick.
        this.vx = 0; this.vz = 0;
        if (this.damageCooldown <= 0) {
          this.damageMobTarget();
          this.damageCooldown = GOLEM_ATTACK_COOLDOWN;
        }
      }
      // Drop target if it died or got too far away.
      if (this.glemTarget.health <= 0 || dist > GOLEM_DETECTION_RANGE * 1.5) {
        this.glemTarget = null;
      }
    } else {
      // Wander slowly
      this.directionTimer -= dt;
      if (this.directionTimer <= 0) {
        if (Math.random() < 0.5) { this.vx = 0; this.vz = 0; }
        else {
          const angle = Math.random() * Math.PI * 2;
          this.vx = Math.cos(angle) * 0.5;
          this.vz = Math.sin(angle) * 0.5;
        }
        this.directionTimer = 3 + Math.random() * 4;
      }
    }
  }

  private damageMobTarget() {
    if (!this.glemTarget) return;
    this.glemTarget.takeDamage(GOLEM_DAMAGE);
    // Knockback the target away from the golem.
    const dx = this.glemTarget.mesh.position.x - this.mesh.position.x;
    const dz = this.glemTarget.mesh.position.z - this.mesh.position.z;
    const d = Math.hypot(dx, dz) || 1;
    this.glemTarget.mesh.position.x += (dx / d) * 1.2;
    this.glemTarget.mesh.position.z += (dz / d) * 1.2;
    this.glemTarget.mesh.position.y += 0.3;
  }

  private updateFlying(dt: number, playerPos: THREE.Vector3) {
    // Dragons are bigger and tougher: wider detection, wider contact,
    // heavier damage, slower cadence.
    const isDragon = this.type === "dragon";
    const detectRange = isDragon ? DETECTION_RANGE * 2.0 : DETECTION_RANGE;
    const contactRange = isDragon ? FLY_CONTACT_RANGE * 1.8 : FLY_CONTACT_RANGE;
    const damage = isDragon ? DRAGON_DAMAGE : CONTACT_DAMAGE;
    const diveSpeed = isDragon ? DRAGON_SPEED + 2.0 : 5.0;
    const hoverSpeed = isDragon ? DRAGON_SPEED * 0.5 : 1.5;
    const returnSpeed = isDragon ? DRAGON_SPEED + 1.0 : 4.0;

    this.flapPhase += dt * (isDragon ? 2 : 4);
    const bob = Math.sin(this.flapPhase) * (isDragon ? 0.6 : 0.4);

    const dx = playerPos.x - this.mesh.position.x;
    const dy = (playerPos.y + 1) - this.mesh.position.y;
    const dz = playerPos.z - this.mesh.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const dist = Math.sqrt(distSq) || 1;

    this.flyPhaseTimer -= dt;
    if (this.flyPhase === "hover") {
      if (this.flyPhaseTimer <= 0 && distSq < detectRange * detectRange * 2.5) {
        this.flyPhase = "dive";
        this.flyPhaseTimer = isDragon ? 4 : 3;
      } else if (this.flyPhaseTimer <= 0) {
        this.flyPhaseTimer = 3 + Math.random() * 2;
      }
    } else if (this.flyPhase === "dive") {
      if (distSq < contactRange * contactRange || this.flyPhaseTimer <= 0) {
        this.flyPhase = "return";
        this.flyPhaseTimer = 4;
      }
    } else {
      const hdx = this.flyHomeX - this.mesh.position.x;
      const hdy = this.flyHomeY - this.mesh.position.y;
      const hdz = this.flyHomeZ - this.mesh.position.z;
      if (hdx * hdx + hdy * hdy + hdz * hdz < 4 || this.flyPhaseTimer <= 0) {
        this.flyPhase = "hover";
        this.flyPhaseTimer = 3 + Math.random() * 2;
        this.flyHomeX = this.mesh.position.x;
        this.flyHomeY = this.mesh.position.y;
        this.flyHomeZ = this.mesh.position.z;
      }
    }

    let speed = 3.5;
    if (this.flyPhase === "hover") {
      speed = hoverSpeed;
      const angle = this.flapPhase * 0.5;
      const tx = this.flyHomeX + Math.cos(angle) * 3;
      const tz = this.flyHomeZ + Math.sin(angle) * 3;
      const ty = this.flyHomeY + bob;
      const tdx = tx - this.mesh.position.x;
      const tdy = ty - this.mesh.position.y;
      const tdz = tz - this.mesh.position.z;
      const td = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz) || 1;
      this.vx = (tdx / td) * speed;
      this.vy = (tdy / td) * speed;
      this.vz = (tdz / td) * speed;
    } else if (this.flyPhase === "dive") {
      speed = diveSpeed;
      this.vx = (dx / dist) * speed;
      this.vy = (dy / dist) * speed + bob * 0.3;
      this.vz = (dz / dist) * speed;
    } else {
      speed = returnSpeed;
      const hdx = this.flyHomeX - this.mesh.position.x;
      const hdy = this.flyHomeY - this.mesh.position.y;
      const hdz = this.flyHomeZ - this.mesh.position.z;
      const hd = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz) || 1;
      this.vx = (hdx / hd) * speed;
      this.vy = (hdy / hd) * speed + bob * 0.3;
      this.vz = (hdz / hd) * speed;
    }

    if (distSq < contactRange * contactRange && this.damageCooldown <= 0 && this.flyPhase === "dive") {
      this.callbacks.onDamagePlayer?.(damage);
      const kbDir = Math.sqrt(distSq) || 1;
      // Shades knock the player back harder than phantoms did — they
      // physically shove with a spectral force. Dragons knock even more.
      const kbStrength = isDragon ? 9 : 9;
      this.callbacks.onKnockbackPlayer?.((dx / kbDir) * kbStrength, isDragon ? 6 : 6, (dz / kbDir) * kbStrength);
      this.damageCooldown = isDragon ? 1.4 : 1.0;
    }

    this.mesh.position.x += this.vx * dt;
    this.mesh.position.y += this.vy * dt;
    this.mesh.position.z += this.vz * dt;
    if (this.mesh.position.y < 2) this.mesh.position.y = 2;
    if (this.mesh.position.y > CHUNK_HEIGHT - 5) this.mesh.position.y = CHUNK_HEIGHT - 5;
    if (Math.abs(this.vx) > 0.01 || Math.abs(this.vz) > 0.01) {
      this.mesh.rotation.y = Math.atan2(this.vx, this.vz);
    }
  }

  private moveAxis(world: World, dx: number, dy: number, dz: number) {
    const p = this.mesh.position;
    p.x += dx; p.y += dy; p.z += dz;
    const r = 0.4;
    const h = this.type === "goblin" ? 0.8 : this.type === "iron_golem" ? 1.4 : this.type === "wolf" ? 0.6 : 0.7;
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

  update(dt: number, playerPos: THREE.Vector3, dayFactor: number, dimension: Dimension = "overworld") {
    // Spawn rules — slightly slower cadence (3-5s instead of 2-5s) to
    // reduce overall mob density while keeping the world feeling alive.
    // Night spawns are goblins (ground) and flying mobs only — no basic
    // zombie type. In the sky dimension, dragons also spawn.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.mobs.length < MAX_MOBS) {
      this.spawnTimer = 3 + Math.random() * 2;
      const isNight = dayFactor < 0.3;
      const isDay = dayFactor > 0.5;
      if (dimension === "sky") {
        // Sky dimension: dragons spawn anytime, plus occasional goblins.
        const r = Math.random();
        const type: MobType = r < 0.5 ? "dragon" : r < 0.8 ? "flying" : "goblin";
        this.trySpawn(playerPos, type);
      } else if (isNight) {
        // Night: 60% goblin, 40% flying
        const type: MobType = Math.random() < 0.6 ? "goblin" : "flying";
        this.trySpawn(playerPos, type);
      } else if (isDay) {
        // Day: passive mobs — pig, cow, sheep, wolf
        const passives: MobType[] = ["pig", "cow", "sheep", "wolf"];
        this.trySpawn(playerPos, passives[Math.floor(Math.random() * passives.length)]);
      }
    }

    // Despawn in daylight (hostile mobs) or when too far (all non-persistent).
    // Dragons despawn when too far but not by daylight (they persist in the sky).
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      const dx = m.mesh.position.x - playerPos.x;
      const dz = m.mesh.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      const isNightMob = m.type === "flying" || m.type === "goblin";
      const isPersistent = m.type === "villager" || m.type === "iron_golem";
      // Wolves persist like other passives — they don't despawn in daylight.
      const isDragon = m.type === "dragon";
      if (!isPersistent && !isDragon && ((isNightMob && dayFactor > 0.5) || dist > DESPAWN_DISTANCE)) {
        this.removeMob(i);
        continue;
      }
      // Dragons only despawn when far away.
      if (isDragon && dist > DESPAWN_DISTANCE) {
        this.removeMob(i);
        continue;
      }
      m.update(dt, this.world, playerPos);
    }

    // Iron golem targeting: each golem picks the nearest hostile mob
    // within GOLEM_DETECTION_RANGE, prioritizing mobs that are close to
    // a villager (so golems defend villagers first). Done once per tick.
    for (const golem of this.mobs) {
      if (golem.type !== "iron_golem") continue;
      if (golem.glemTarget && golem.glemTarget.health > 0) continue; // already chasing
      let best: Mob | null = null;
      let bestScore = Infinity;
      for (const target of this.mobs) {
        if (target.type !== "flying" && target.type !== "goblin" && target.type !== "dragon") continue;
        const gdx = target.mesh.position.x - golem.mesh.position.x;
        const gdy = target.mesh.position.y - golem.mesh.position.y;
        const gdz = target.mesh.position.z - golem.mesh.position.z;
        const gdistSq = gdx * gdx + gdy * gdy + gdz * gdz;
        if (gdistSq > GOLEM_DETECTION_RANGE * GOLEM_DETECTION_RANGE) continue;
        // Priority: reduce score if the target is near a villager.
        let score = gdistSq;
        for (const v of this.mobs) {
          if (v.type !== "villager") continue;
          const vdx = target.mesh.position.x - v.mesh.position.x;
          const vdz = target.mesh.position.z - v.mesh.position.z;
          const vdistSq = vdx * vdx + vdz * vdz;
          if (vdistSq < 64) score -= 80; // big priority boost for villagers in danger
        }
        if (score < bestScore) { bestScore = score; best = target; }
      }
      golem.glemTarget = best;
    }

    // Goblins fight back: attack nearby iron golems.
    for (const hostile of this.mobs) {
      if (hostile.type !== "goblin") continue;
      if (hostile.damageCooldown > 0) continue;
      for (const target of this.mobs) {
        if (target.type !== "iron_golem") continue;
        const dx = target.mesh.position.x - hostile.mesh.position.x;
        const dy = target.mesh.position.y - hostile.mesh.position.y;
        const dz = target.mesh.position.z - hostile.mesh.position.z;
        if (dx * dx + dy * dy + dz * dz < 4) {
          target.takeDamage(3);
          hostile.damageCooldown = 1.0;
          break;
        }
      }
    }
  }

  spawnMobAt(x: number, y: number, z: number, type: MobType) {
    const mob = new Mob(x, y, z, type, this.callbacks);
    this.mobs.push(mob);
    this.scene.add(mob.mesh);
  }

  private trySpawn(playerPos: THREE.Vector3, type: MobType) {
    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_DISTANCE_MIN + Math.random() * (SPAWN_DISTANCE_MAX - SPAWN_DISTANCE_MIN);
    const x = Math.floor(playerPos.x + Math.cos(angle) * dist);
    const z = Math.floor(playerPos.z + Math.sin(angle) * dist);

    if (type === "flying") {
      const y = Math.min(CHUNK_HEIGHT - 6, Math.floor(playerPos.y) + 8);
      const mob = new Mob(x + 0.5, y, z + 0.5, type, this.callbacks);
      this.mobs.push(mob);
      this.scene.add(mob.mesh);
      return;
    }

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

  getMobAt(rayOrigin: THREE.Vector3, rayDir: THREE.Vector3, maxDist: number): Mob | null {
    let closest: Mob | null = null;
    let closestDist = maxDist;
    for (const m of this.mobs) {
      const dx = m.mesh.position.x - rayOrigin.x;
      const dy = m.mesh.position.y - rayOrigin.y;
      const dz = m.mesh.position.z - rayOrigin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > closestDist) continue;
      const dot = (dx * rayDir.x + dy * rayDir.y + dz * rayDir.z) / (dist || 1);
      if (dot > 0.92) { closest = m; closestDist = dist; }
    }
    return closest;
  }

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

  // Find the nearest iron golem within `maxDist` of (x, y, z) that is
  // below max health. Returns null if none. Used by the engine when the
  // player taps a golem while holding iron ore — feeds the ore to heal it.
  getNearestDamagedGolem(x: number, y: number, z: number, maxDist: number): Mob | null {
    let best: Mob | null = null;
    let bestDistSq = maxDist * maxDist;
    for (const m of this.mobs) {
      if (m.type !== "iron_golem") continue;
      if (m.health >= m.maxHealth) continue; // already full
      const dx = m.mesh.position.x - x;
      const dy = m.mesh.position.y - y;
      const dz = m.mesh.position.z - z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq < bestDistSq) { bestDistSq = dSq; best = m; }
    }
    return best;
  }

  private removeMob(i: number) {
    const m = this.mobs[i];
    this.scene.remove(m.mesh);
    disposeGroup(m.mesh);
    this.mobs.splice(i, 1);
  }

  despawnAggressive() {
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const t = this.mobs[i].type;
      if (t === "flying" || t === "goblin" || t === "dragon") this.removeMob(i);
    }
  }

  dispose() {
    for (const m of this.mobs) {
      this.scene.remove(m.mesh);
      disposeGroup(m.mesh);
    }
    this.mobs = [];
  }
}

function disposeGroup(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
    }
  });
}

// --- Entity model builders ---

// Helper: tag a mesh with a "kind" for limb-swing animation.
function tag(mesh: THREE.Mesh, kind: string): THREE.Mesh {
  mesh.userData.kind = kind;
  return mesh;
}

// Goblin: detailed green hostile humanoid. Pointed ears, sharp tusks,
// loincloth, clawed hands, and a small hunched posture. The only ground
// hostile mob in the game (alongside flying mobs at night).
function buildGoblinModel(): THREE.Group {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x3a7a2a, emissive: 0x1a3a1a, emissiveIntensity: 0.35 });
  const skinDark = new THREE.MeshLambertMaterial({ color: 0x2a5a1a, emissive: 0x0a2a0a, emissiveIntensity: 0.25 });
  const cloth = new THREE.MeshLambertMaterial({ color: 0x5a3a18, emissive: 0x2a1a08, emissiveIntensity: 0.15 });
  const eye = new THREE.MeshLambertMaterial({ color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 1.0 });
  const tusk = new THREE.MeshLambertMaterial({ color: 0xfff0c0, emissive: 0x4a3a20, emissiveIntensity: 0.3 });

  // Hunched torso — slightly shorter than zombie
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.28), skin);
  body.position.set(0, 0.45, 0);
  group.add(body);

  // Belly accent (darker green patch)
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.05), skinDark);
  belly.position.set(0, 0.4, 0.15);
  group.add(belly);

  // Head — slightly oversized, angular
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.36), skin);
  head.position.set(0, 0.88, 0);
  group.add(head);

  // Pointed ears (two thin cones on the sides)
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 4), skin);
  earL.position.set(-0.22, 0.95, 0);
  earL.rotation.z = Math.PI / 2.5;
  group.add(earL);
  const earR = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 4), skin);
  earR.position.set(0.22, 0.95, 0);
  earR.rotation.z = -Math.PI / 2.5;
  group.add(earR);

  // Glowing yellow eyes — sunken, angled inward
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.05), eye);
  eyeL.position.set(-0.09, 0.92, 0.18);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.05), eye);
  eyeR.position.set(0.09, 0.92, 0.18);
  group.add(eyeR);

  // Brow ridge (dark)
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.06), skinDark);
  brow.position.set(0, 0.97, 0.17);
  group.add(brow);

  // Tusks — two small white cones poking up from the lower jaw
  const tuskL = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), tusk);
  tuskL.position.set(-0.07, 0.78, 0.18);
  tuskL.rotation.x = Math.PI;
  group.add(tuskL);
  const tuskR = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), tusk);
  tuskR.position.set(0.07, 0.78, 0.18);
  tuskR.rotation.x = Math.PI;
  group.add(tuskR);

  // Loincloth — wraps around the waist
  const loincloth = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.32), cloth);
  loincloth.position.set(0, 0.25, 0);
  group.add(loincloth);

  // Long clawed arms
  const armL = tag(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.48, 0.13), skin), "armL");
  armL.position.set(-0.3, 0.68, 0);
  armL.geometry.translate(0, -0.24, 0);
  group.add(armL);
  const armR = tag(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.48, 0.13), skin), "armR");
  armR.position.set(0.3, 0.68, 0);
  armR.geometry.translate(0, -0.24, 0);
  group.add(armR);

  // Claw tips (dark)
  const clawL = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 4), skinDark);
  clawL.position.set(-0.3, 0.42, 0.05);
  clawL.rotation.x = Math.PI;
  group.add(clawL);
  const clawR = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 4), skinDark);
  clawR.position.set(0.3, 0.42, 0.05);
  clawR.rotation.x = Math.PI;
  group.add(clawR);

  // Short bowed legs
  const legL = tag(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.38, 0.15), skinDark), "legL");
  legL.position.set(-0.1, 0.19, 0);
  legL.geometry.translate(0, -0.19, 0);
  group.add(legL);
  const legR = tag(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.38, 0.15), skinDark), "legR");
  legR.position.set(0.1, 0.19, 0);
  legR.geometry.translate(0, -0.19, 0);
  group.add(legR);

  return group;
}

// Flying mob (phantom): a small winged creature with glowing eyes and
// a dark blue body.
function buildFlyingModel(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0x1a3a5a, emissive: 0x0a1a2a, emissiveIntensity: 0.4 });
  const wing = new THREE.MeshLambertMaterial({ color: 0x102848, emissive: 0x05101e, emissiveIntensity: 0.3 });
  const eye = new THREE.MeshLambertMaterial({ color: 0xff66aa, emissive: 0xff3388, emissiveIntensity: 0.9 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), body);
  group.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), body);
  head.position.set(0, 0.1, 0.3);
  group.add(head);
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), eye);
  eyeL.position.set(-0.08, 0.12, 0.46);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), eye);
  eyeR.position.set(0.08, 0.12, 0.46);
  group.add(eyeR);

  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.35), wing);
  wingL.position.set(-0.5, 0.05, 0);
  wingL.rotation.z = 0.2;
  group.add(wingL);
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.35), wing);
  wingR.position.set(0.5, 0.05, 0);
  wingR.rotation.z = -0.2;
  group.add(wingR);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), body);
  tail.position.set(0, 0, -0.35);
  group.add(tail);

  return group;
}

// Pig: pink, stocky body with a flat snout and short legs.
function buildPigModel(): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xe890a0, emissive: 0x552030, emissiveIntensity: 0.2 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0xb06070, emissive: 0x401020, emissiveIntensity: 0.15 });
  const snoutMat = new THREE.MeshLambertMaterial({ color: 0xc07080, emissive: 0x401020, emissiveIntensity: 0.15 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.85), bodyMat);
  body.position.set(0, 0.45, 0);
  group.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.35), bodyMat);
  head.position.set(0, 0.5, 0.55);
  group.add(head);

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.1), snoutMat);
  snout.position.set(0, 0.45, 0.75);
  group.add(snout);

  for (const [lx, lz] of [[-0.18, 0.3], [0.18, 0.3], [-0.18, -0.3], [0.18, -0.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), darkMat);
    leg.position.set(lx, 0.15, lz);
    group.add(leg);
  }
  return group;
}

// Cow: brown-and-white, larger than pig, with horns.
function buildCowModel(): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a, emissive: 0x2a1a0a, emissiveIntensity: 0.2 });
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee, emissive: 0x444444, emissiveIntensity: 0.15 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a1a0a, emissive: 0x140a05, emissiveIntensity: 0.15 });
  const hornMat = new THREE.MeshLambertMaterial({ color: 0xd0c0a0, emissive: 0x403020, emissiveIntensity: 0.1 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 1.0), bodyMat);
  body.position.set(0, 0.55, 0);
  group.add(body);

  const patch = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.3, 0.3), whiteMat);
  patch.position.set(0, 0.55, -0.3);
  group.add(patch);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), bodyMat);
  head.position.set(0, 0.55, 0.65);
  group.add(head);

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.1), whiteMat);
  snout.position.set(0, 0.5, 0.85);
  group.add(snout);

  const hornL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.18), hornMat);
  hornL.position.set(-0.18, 0.78, 0.65);
  hornL.rotation.x = 0.4;
  group.add(hornL);
  const hornR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.18), hornMat);
  hornR.position.set(0.18, 0.78, 0.65);
  hornR.rotation.x = 0.4;
  group.add(hornR);

  for (const [lx, lz] of [[-0.22, 0.35], [0.22, 0.35], [-0.22, -0.35], [0.22, -0.35]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.35, 0.16), darkMat);
    leg.position.set(lx, 0.17, lz);
    group.add(leg);
  }
  return group;
}

// Sheep: fluffy white body on a small dark head.
function buildSheepModel(): THREE.Group {
  const group = new THREE.Group();
  const woolMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee, emissive: 0x666666, emissiveIntensity: 0.15 });
  const headMat = new THREE.MeshLambertMaterial({ color: 0x404040, emissive: 0x202020, emissiveIntensity: 0.15 });
  const legMat = new THREE.MeshLambertMaterial({ color: 0x303030, emissive: 0x181818, emissiveIntensity: 0.15 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 0.85), woolMat);
  body.position.set(0, 0.5, 0);
  group.add(body);

  const puffTop = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.9), woolMat);
  puffTop.position.set(0, 0.72, 0);
  group.add(puffTop);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), headMat);
  head.position.set(0, 0.5, 0.55);
  group.add(head);

  const eyeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x888888, emissiveIntensity: 0.5 });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), eyeMat);
  eyeL.position.set(-0.08, 0.55, 0.7);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), eyeMat);
  eyeR.position.set(0.08, 0.55, 0.7);
  group.add(eyeR);

  for (const [lx, lz] of [[-0.2, 0.3], [0.2, 0.3], [-0.2, -0.3], [0.2, -0.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), legMat);
    leg.position.set(lx, 0.15, lz);
    group.add(leg);
  }
  return group;
}

// Villager: detailed humanoid NPC. Distinct head with a nose, eyes, and
// hair; a colored robe (apron) over a tunic; arms and legs that swing
// when walking. Different from the basic zombie silhouette.
function buildVillagerModel(): THREE.Group {
  const group = new THREE.Group();
  const robeMat = new THREE.MeshLambertMaterial({ color: 0x8b6a3a, emissive: 0x3a2a10, emissiveIntensity: 0.2 });
  const apronMat = new THREE.MeshLambertMaterial({ color: 0xc8c8c8, emissive: 0x444444, emissiveIntensity: 0.15 });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xc0a080, emissive: 0x403020, emissiveIntensity: 0.15 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x5a4020, emissive: 0x2a1a08, emissiveIntensity: 0.15 });
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x3a2a18, emissive: 0x1a0a08, emissiveIntensity: 0.2 });
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x202020, emissive: 0x000000, emissiveIntensity: 0 });

  // Torso — robe with white apron overlay
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.7, 0.3), robeMat);
  body.position.set(0, 0.6, 0);
  group.add(body);
  // Apron (front white panel)
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.05), apronMat);
  apron.position.set(0, 0.55, 0.16);
  group.add(apron);
  // Belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.06, 0.32), darkMat);
  belt.position.set(0, 0.4, 0);
  group.add(belt);

  // Head — slightly bigger than zombie, with a prominent nose
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), skinMat);
  head.position.set(0, 1.18, 0);
  group.add(head);
  // Hair (top cap)
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.38), hairMat);
  hair.position.set(0, 1.32, 0);
  group.add(hair);
  // Nose (small box on the front)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.06), skinMat);
  nose.position.set(0, 1.16, 0.2);
  group.add(nose);
  // Eyes
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), eyeMat);
  eyeL.position.set(-0.09, 1.22, 0.18);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), eyeMat);
  eyeR.position.set(0.09, 1.22, 0.18);
  group.add(eyeR);
  // Eyebrows
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.04), hairMat);
  brow.position.set(0, 1.28, 0.18);
  group.add(brow);

  // Arms — robe sleeves
  const armL = tag(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), robeMat), "armL");
  armL.position.set(-0.3, 0.82, 0);
  armL.geometry.translate(0, -0.27, 0);
  group.add(armL);
  const armR = tag(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), robeMat), "armR");
  armR.position.set(0.3, 0.82, 0);
  armR.geometry.translate(0, -0.27, 0);
  group.add(armR);
  // Hands (skin) at the end of each sleeve
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.13), skinMat);
  handL.position.set(-0.3, 0.55, 0);
  group.add(handL);
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.13), skinMat);
  handR.position.set(0.3, 0.55, 0);
  group.add(handR);

  // Legs — dark trousers
  const legL = tag(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.16), darkMat), "legL");
  legL.position.set(-0.11, 0.16, 0);
  legL.geometry.translate(0, -0.16, 0);
  group.add(legL);
  const legR = tag(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.16), darkMat), "legR");
  legR.position.set(0.11, 0.16, 0);
  legR.geometry.translate(0, -0.16, 0);
  group.add(legR);

  return group;
}

// Iron golem (revamped): a tall, broad iron humanoid with a carved
// pumpkin-like head, shoulder pauldrons, a chest plate with a visible
// seam, thick riveted arms, and heavy stumpy legs. Much more
// imposing than the old model — clearly a village protector.
function buildIronGolemModel(): THREE.Group {
  const group = new THREE.Group();
  const ironMat = new THREE.MeshLambertMaterial({ color: 0xc0c0c0, emissive: 0x444444, emissiveIntensity: 0.25 });
  const ironDark = new THREE.MeshLambertMaterial({ color: 0x808080, emissive: 0x222222, emissiveIntensity: 0.2 });
  const ironLight = new THREE.MeshLambertMaterial({ color: 0xe0e0e0, emissive: 0x555555, emissiveIntensity: 0.3 });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xd08020, emissive: 0x4a2a08, emissiveIntensity: 0.25 });
  const headDark = new THREE.MeshLambertMaterial({ color: 0xa06010, emissive: 0x3a1a08, emissiveIntensity: 0.2 });
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a, emissive: 0x000000, emissiveIntensity: 0 });

  // Torso — broad iron chest plate with a center seam
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.55), ironMat);
  body.position.set(0, 1.0, 0);
  group.add(body);
  // Chest seam (dark line down the middle)
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.05), ironDark);
  seam.position.set(0, 1.0, 0.28);
  group.add(seam);
  // Chest rivets (2x2 grid of small dark dots)
  for (const [rx, ry] of [[-0.25, 1.2], [0.25, 1.2], [-0.25, 0.8], [0.25, 0.8]]) {
    const rivet = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), ironDark);
    rivet.position.set(rx, ry, 0.29);
    group.add(rivet);
  }

  // Shoulder pauldrons — bigger boxes on top of the shoulders
  const pauldronL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.6), ironLight);
  pauldronL.position.set(-0.6, 1.45, 0);
  group.add(pauldronL);
  const pauldronR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.6), ironLight);
  pauldronR.position.set(0.6, 1.45, 0);
  group.add(pauldronR);

  // Head — large carved pumpkin-like block. Sits on top of the torso.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.5), headMat);
  head.position.set(0, 1.85, 0);
  group.add(head);
  // Head top ridges (small dark lines for a carved look)
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.05), headDark);
  ridge.position.set(0, 2.08, 0);
  group.add(ridge);

  // Carved eyes (dark recessed boxes) + glowing iris inside
  const irisMat = new THREE.MeshLambertMaterial({ color: 0xff8800, emissive: 0xff6600, emissiveIntensity: 0.9 });
  const eyeSocketL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), eyeMat);
  eyeSocketL.position.set(-0.13, 1.88, 0.26);
  group.add(eyeSocketL);
  const eyeSocketR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), eyeMat);
  eyeSocketR.position.set(0.13, 1.88, 0.26);
  group.add(eyeSocketR);
  const irisL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), irisMat);
  irisL.position.set(-0.13, 1.88, 0.28);
  group.add(irisL);
  const irisR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), irisMat);
  irisR.position.set(0.13, 1.88, 0.28);
  group.add(irisR);
  // Carved mouth (a dark horizontal slot)
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), eyeMat);
  mouth.position.set(0, 1.7, 0.26);
  group.add(mouth);

  // Arms — thick riveted iron, longer than torso so they reach down
  const armL = tag(new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 0.28), ironMat), "armL");
  armL.position.set(-0.7, 1.05, 0);
  armL.geometry.translate(0, -0.5, 0);
  group.add(armL);
  const armR = tag(new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 0.28), ironMat), "armR");
  armR.position.set(0.7, 1.05, 0);
  armR.geometry.translate(0, -0.5, 0);
  group.add(armR);
  // Arm rivets (one band near the shoulder)
  for (const ax of [-0.7, 0.7]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.3), ironDark);
    band.position.set(ax, 1.4, 0);
    group.add(band);
  }

  // Legs — heavy stumpy iron pillars
  const legL = tag(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), ironDark), "legL");
  legL.position.set(-0.25, 0.25, 0);
  legL.geometry.translate(0, -0.25, 0);
  group.add(legL);
  const legR = tag(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), ironDark), "legR");
  legR.position.set(0.25, 0.25, 0);
  legR.geometry.translate(0, -0.25, 0);
  group.add(legR);

  return group;
}

// Dragon: a large winged serpent that spawns in the sky dimension.
// Long body, broad wings, glowing eyes, spiky tail. Bigger and more
// imposing than the flying phantom — clearly a boss-tier threat.
function buildDragonModel(): THREE.Group {
  const group = new THREE.Group();
  const scaleMat = new THREE.MeshLambertMaterial({ color: 0x2a1a4a, emissive: 0x1a0a2a, emissiveIntensity: 0.3 });
  const bellyMat = new THREE.MeshLambertMaterial({ color: 0x4a3a6a, emissive: 0x2a1a4a, emissiveIntensity: 0.2 });
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x1a0a3a, emissive: 0x0a0520, emissiveIntensity: 0.4 });
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0xff3300, emissive: 0xff3300, emissiveIntensity: 1.0 });
  const spikeMat = new THREE.MeshLambertMaterial({ color: 0x6a5a8a, emissive: 0x2a1a4a, emissiveIntensity: 0.2 });

  // Long serpentine body (tapered — wider in the middle, narrower at tail)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1.6), scaleMat);
  body.position.set(0, 0, 0);
  group.add(body);
  // Belly accent (lighter underside)
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 1.4), bellyMat);
  belly.position.set(0, -0.3, 0);
  group.add(belly);

  // Head — boxy with a snout
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), scaleMat);
  head.position.set(0, 0.1, 1.0);
  group.add(head);
  // Snout
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.3), scaleMat);
  snout.position.set(0, 0.05, 1.35);
  group.add(snout);
  // Glowing eyes
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
  eyeL.position.set(-0.13, 0.18, 1.22);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
  eyeR.position.set(0.13, 0.18, 1.22);
  group.add(eyeR);
  // Two horns sweeping back from the head
  const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 4), spikeMat);
  hornL.position.set(-0.18, 0.35, 0.92);
  hornL.rotation.x = -0.6;
  group.add(hornL);
  const hornR = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 4), spikeMat);
  hornR.position.set(0.18, 0.35, 0.92);
  hornR.rotation.x = -0.6;
  group.add(hornR);

  // Large bat-like wings (flat panels angled outward)
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.8), wingMat);
  wingL.position.set(-1.0, 0.2, 0);
  wingL.rotation.z = 0.25;
  group.add(wingL);
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.8), wingMat);
  wingR.position.set(1.0, 0.2, 0);
  wingR.rotation.z = -0.25;
  group.add(wingR);

  // Tail — tapered segments going back
  const tail1 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.6), scaleMat);
  tail1.position.set(0, 0, -1.0);
  group.add(tail1);
  const tail2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.6), scaleMat);
  tail2.position.set(0, 0.05, -1.55);
  group.add(tail2);
  // Tail spike
  const tailSpike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 4), spikeMat);
  tailSpike.position.set(0, 0.05, -2.0);
  tailSpike.rotation.x = Math.PI / 2;
  group.add(tailSpike);

  // Back spikes (a row of small cones along the spine)
  for (let i = 0; i < 3; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), spikeMat);
    spike.position.set(0, 0.38, -0.4 + i * 0.4);
    group.add(spike);
  }

  return group;
}

// Wolf: a small canine mob. Neutral — bites back if attacked, otherwise
// wanders peacefully. Grey-brown body, pointy ears, bushy tail.
function buildWolfModel(): THREE.Group {
  const group = new THREE.Group();
  const furMat = new THREE.MeshLambertMaterial({ color: 0x8a7560, emissive: 0x3a2a18, emissiveIntensity: 0.15 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x5a4a38, emissive: 0x2a1a08, emissiveIntensity: 0.15 });
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0xffaa00, emissive: 0xff8800, emissiveIntensity: 0.6 });

  // Body — longer than it is tall (canine proportions)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.8), furMat);
  body.position.set(0, 0.4, 0);
  group.add(body);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), furMat);
  head.position.set(0, 0.45, 0.5);
  group.add(head);
  // Snout
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.15), darkMat);
  snout.position.set(0, 0.4, 0.7);
  group.add(snout);
  // Pointed ears
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 4), furMat);
  earL.position.set(-0.1, 0.66, 0.48);
  group.add(earL);
  const earR = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 4), furMat);
  earR.position.set(0.1, 0.66, 0.48);
  group.add(earR);
  // Eyes
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), eyeMat);
  eyeL.position.set(-0.08, 0.48, 0.66);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), eyeMat);
  eyeR.position.set(0.08, 0.48, 0.66);
  group.add(eyeR);

  // Bushy tail
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.35), furMat);
  tail.position.set(0, 0.45, -0.5);
  tail.rotation.x = 0.4;
  group.add(tail);

  // Legs
  for (const [lx, lz] of [[-0.12, 0.3], [0.12, 0.3], [-0.12, -0.3], [0.12, -0.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), darkMat);
    leg.position.set(lx, 0.15, lz);
    group.add(leg);
  }

  return group;
}
