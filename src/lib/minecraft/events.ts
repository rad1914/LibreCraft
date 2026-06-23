// Minimal events module. Events are special gameplay states that trigger
// occasionally and modify the world for a limited time. Each event has:
//   - A trigger condition (checked each frame)
//   - A duration (how long the event lasts)
//   - Effects applied while active (sky tint, mob spawning, sounds, etc.)
//   - A clean break — when the event ends, the game returns to normal.
//
// Currently implemented:
//   EV_red_moon — the sky turns blood red, hostile mobs spawn rapidly,
//     spooky glitchy sounds play, and the player takes random damage
//     with knockback if HP >= 6. Breaks automatically after ~60s and
//     the normal day/night cycle continues.

import type { DayNightCycle } from "./daynight";
import { playSpookyGlitch } from "./sound";

export type EventType = "red_moon";

export interface GameEventCallbacks {
  // Spawn a hostile mob near the player. Returns true on success.
  spawnHostileMob: () => boolean;
  // Apply damage + knockback to the player (dx, dy, dz = knockback vector).
  damagePlayer: (amount: number, dx: number, dy: number, dz: number) => void;
  // Get the player's current health (for the random-damage gate).
  getPlayerHealth: () => number;
}

export class GameEvent {
  type: EventType;
  // Remaining duration in seconds. When this hits 0, the event ends.
  timer: number;
  // Internal accumulator for periodic effects (mob spawns, sounds, etc.)
  private tickAccum = 0;

  constructor(type: EventType, duration: number) {
    this.type = type;
    this.timer = duration;
  }

  // Tick the event. Returns true while the event is still active, false
  // when it has ended (the caller should remove it).
  update(dt: number, dayNight: DayNightCycle, callbacks: GameEventCallbacks): boolean {
    this.timer -= dt;
    if (this.timer <= 0) return false;

    if (this.type === "red_moon") {
      // Tint the sky red — set the day/night cycle's redMoonTint so its
      // apply() lerps the sky toward blood red. The tint decays on its
      // own in dayNight.update(); we keep topping it up while the event
      // is active so it stays at full strength.
      dayNight.redMoonTint = 1.0;

      // Periodic effects: every ~1.5s, spawn a hostile mob + play a
      // spooky sound. Every ~8s, apply random damage + knockback if
      // the player's HP is >= 6.
      this.tickAccum += dt;
      if (this.tickAccum >= 1.5) {
        this.tickAccum = 0;
        callbacks.spawnHostileMob();
        playSpookyGlitch();
      }

      // Random damage tick — separate, slower cadence. Use a second
      // accumulator derived from the timer (every 8s).
      // We check if we're near a multiple of 8s remaining.
      const phase = Math.floor((this.timer) / 8);
      const phasePrev = Math.floor((this.timer + dt) / 8);
      if (phase !== phasePrev) {
        // Just crossed an 8s boundary.
        const hp = callbacks.getPlayerHealth();
        if (hp >= 6) {
          // Random direction knockback.
          const angle = Math.random() * Math.PI * 2;
          callbacks.damagePlayer(2, Math.cos(angle) * 5, 4, Math.sin(angle) * 5);
        }
      }
    }

    return true;
  }
}

export class EventManager {
  private active: GameEvent | null = null;
  private cooldown: number; // seconds until the next event can trigger
  private callbacks: GameEventCallbacks;

  constructor(callbacks: GameEventCallbacks) {
    this.callbacks = callbacks;
    // First event can't trigger for at least 5 minutes of play.
    this.cooldown = 300;
  }

  // Returns true if an event is currently active.
  isActive(): boolean { return this.active !== null; }

  // Returns the active event type, or null.
  activeType(): EventType | null { return this.active?.type ?? null; }

  // Tick the event system. Called every frame with the day/night cycle
  // (for sky tinting) and the current day factor (events only trigger
  // at night).
  update(dt: number, dayNight: DayNightCycle, dayFactor: number) {
    // Tick the active event.
    if (this.active) {
      const stillActive = this.active.update(dt, dayNight, this.callbacks);
      if (!stillActive) {
        this.active = null;
        // Cooldown before the next event.
        this.cooldown = 300 + Math.random() * 300; // 5-10 minutes
      }
      return;
    }
    // No active event — count down the cooldown and maybe trigger one.
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    // Only trigger at night.
    if (dayFactor > 0.25) return;
    // ~30% chance per check once the cooldown is up (re-checked every
    // frame, so effectively triggers within a few seconds of night starting).
    if (Math.random() < 0.005) {
      this.active = new GameEvent("red_moon", 60); // 60s event
      // Reset cooldown so the next check doesn't immediately re-trigger.
      this.cooldown = 9999;
    }
  }

  // Force-end the active event (used when the player sleeps, etc.).
  forceEnd() {
    this.active = null;
    this.cooldown = 300 + Math.random() * 300;
  }
}
