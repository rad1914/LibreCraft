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
const RESPAWN_INVINCIBILITY = 1.0; // seconds of invincibility after respawn

export class LifeSystem {
  health = MAX_HEALTH;
  // Tracks the highest downward velocity seen since last landing.
  // Used to compute fall damage on impact.
  private fallStartY: number | null = null;
  private wasOnGround = true;
  dead = false;
  // Invincibility timer — counts down after respawn. While > 0, the
  // player takes no damage. Gives a brief grace period so the player
  // doesn't instantly die again to whatever killed them.
  invincibleTimer = 0;

  // Callbacks
  onHealthChange?: (health: number) => void;
  onDeath?: () => void;
  onRespawn?: () => void;

  // Call every frame with the player's current position and onGround state.
  update(currentY: number, onGround: boolean) {
    if (this.dead) return;
    // Tick down the invincibility timer.
    if (this.invincibleTimer > 0) this.invincibleTimer -= 1 / 60;

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
    // Invincibility: ignore all damage while the timer is active.
    if (this.invincibleTimer > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.onHealthChange?.(this.health);
    if (this.health <= 0) {
      this.die();
    }
  }

  private die() {
    this.dead = true;
    this.onDeath?.();
  }

  // Respawn at the given spawn point. Grants 1 second of invincibility
  // so the player can reorient without instantly dying again.
  respawn(player: { position: THREE.Vector3; yaw: number; pitch: number }, spawnPoint: THREE.Vector3, world: World) {
    this.health = RESPAWN_HEALTH;
    this.dead = false;
    this.fallStartY = null;
    this.wasOnGround = true;
    this.invincibleTimer = RESPAWN_INVINCIBILITY;
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
    this.invincibleTimer = 0;
    this.onHealthChange?.(this.health);
  }
}

export { MAX_HEALTH };
