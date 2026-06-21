// Minimal life system: health (0..20), fall damage, death, respawn.
// The player takes damage when landing from a fall above a safe
// threshold. At 0 health, the player dies and respawns at the world
// spawn point with full health.

import * as THREE from "three";
import { World } from "./world";

const MAX_HEALTH = 20;
const SAFE_FALL = 3; // blocks — falls <= this deal no damage
const DAMAGE_PER_BLOCK = 1; // per block beyond SAFE_FALL
const RESPAWN_HEALTH = MAX_HEALTH;

export class LifeSystem {
  health = MAX_HEALTH;
  // Tracks the highest downward velocity seen since last landing.
  // Used to compute fall damage on impact.
  private fallStartY: number | null = null;
  private wasOnGround = true;
  dead = false;

  // Callbacks
  onHealthChange?: (health: number) => void;
  onDeath?: () => void;
  onRespawn?: () => void;
  onDamage?: (amount: number) => void;

  // Call every frame with the player's current position and onGround state.
  update(currentY: number, onGround: boolean) {
    if (this.dead) return;

    if (onGround && !this.wasOnGround) {
      // Just landed — compute fall damage
      if (this.fallStartY !== null) {
        const fallDistance = this.fallStartY - currentY;
        if (fallDistance > SAFE_FALL) {
          const damage = Math.floor((fallDistance - SAFE_FALL) * DAMAGE_PER_BLOCK);
          if (damage > 0) {
            this.takeDamage(damage);
          }
        }
      }
      this.fallStartY = null;
    } else if (!onGround && this.wasOnGround) {
      // Just started falling
      this.fallStartY = currentY;
    } else if (!onGround && this.fallStartY !== null) {
      // Still falling — update start Y if going up (jumping)
      if (currentY > this.fallStartY) {
        this.fallStartY = currentY;
      }
    }
    this.wasOnGround = onGround;
  }

  takeDamage(amount: number) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.onDamage?.(amount);
    this.onHealthChange?.(this.health);
    if (this.health <= 0) {
      this.die();
    }
  }

  private die() {
    this.dead = true;
    this.onDeath?.();
  }

  // Respawn at the given spawn point.
  respawn(player: { position: THREE.Vector3; yaw: number; pitch: number }, spawnPoint: THREE.Vector3, world: World) {
    this.health = RESPAWN_HEALTH;
    this.dead = false;
    this.fallStartY = null;
    this.wasOnGround = true;
    player.position.copy(spawnPoint);
    player.yaw = 0;
    player.pitch = 0;
    this.onHealthChange?.(this.health);
    this.onRespawn?.();
  }

  reset() {
    this.health = MAX_HEALTH;
    this.dead = false;
    this.fallStartY = null;
    this.wasOnGround = true;
    this.onHealthChange?.(this.health);
  }
}

export { MAX_HEALTH };
