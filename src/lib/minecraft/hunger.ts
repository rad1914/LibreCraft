// Hunger system: tracks food level (0..20) and applies effects.
//   - Food decreases by 1 every 30 seconds when idle, every 12 seconds
//     when walking, and every 6 seconds when sprinting.
//   - If food >= 18 (full): slow health regen (1 HP per 4 seconds).
//   - If food < 6 (low): player walks at 60% speed (handled by the engine
//     via the speedMultiplier field on the player).
//   - If food == 0: player takes 1 damage per 4 seconds (starvation).

const MAX_FOOD = 20;
const FOOD_DECAY_IDLE = 30; // seconds per -1 food when idle
const FOOD_DECAY_WALK = 12; // seconds per -1 food when walking
const FOOD_DECAY_SPRINT = 6; // seconds per -1 food when sprinting
const REGEN_FOOD_THRESHOLD = 18;
const REGEN_INTERVAL = 4;
const STARVE_FOOD_THRESHOLD = 0;
const STARVE_INTERVAL = 4;
const SLOW_FOOD_THRESHOLD = 6;

export class HungerSystem {
  food = MAX_FOOD;
  private decayTimer = 0;
  private regenTimer = 0;
  private starveTimer = 0;

  onFoodChange?: (food: number) => void;
  onRegen?: (amount: number) => void;
  onStarve?: (amount: number) => void;

  get maxFood(): number { return MAX_FOOD; }
  get isFull(): boolean { return this.food >= REGEN_FOOD_THRESHOLD; }
  get isLow(): boolean { return this.food < SLOW_FOOD_THRESHOLD; }
  get isStarving(): boolean { return this.food <= STARVE_FOOD_THRESHOLD; }
  get shouldSlow(): boolean { return this.food < SLOW_FOOD_THRESHOLD; }

  reset() {
    this.food = MAX_FOOD;
    this.decayTimer = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.onFoodChange?.(this.food);
  }

  setFood(v: number) {
    const clamped = Math.max(0, Math.min(MAX_FOOD, Math.floor(v)));
    if (clamped === this.food) return;
    this.food = clamped;
    this.onFoodChange?.(this.food);
  }

  eat(amount: number = 6): number {
    const before = this.food;
    this.food = Math.min(MAX_FOOD, this.food + amount);
    if (this.food !== before) {
      this.onFoodChange?.(this.food);
    }
    return this.food;
  }

  // Update each frame. `moving` = is the player walking, `sprinting` = is the player sprinting.
  update(dt: number, alive: boolean, moving: boolean = false, sprinting: boolean = false): {
    regen?: number;
    starve?: number;
  } {
    if (!alive) return {};
    const events: { regen?: number; starve?: number } = {};

    // Food decay — faster when moving
    const decayInterval = sprinting ? FOOD_DECAY_SPRINT : moving ? FOOD_DECAY_WALK : FOOD_DECAY_IDLE;
    this.decayTimer += dt;
    if (this.decayTimer >= decayInterval) {
      this.decayTimer -= decayInterval;
      if (this.food > 0) {
        this.food = Math.max(0, this.food - 1);
        this.onFoodChange?.(this.food);
      }
    }

    // Regen
    if (this.food >= REGEN_FOOD_THRESHOLD) {
      this.regenTimer += dt;
      if (this.regenTimer >= REGEN_INTERVAL) {
        this.regenTimer -= REGEN_INTERVAL;
        events.regen = 1;
        this.onRegen?.(1);
      }
    } else {
      this.regenTimer = 0;
    }

    // Starvation
    if (this.food <= STARVE_FOOD_THRESHOLD) {
      this.starveTimer += dt;
      if (this.starveTimer >= STARVE_INTERVAL) {
        this.starveTimer -= STARVE_INTERVAL;
        events.starve = 1;
        this.onStarve?.(1);
      }
    } else {
      this.starveTimer = 0;
    }

    return events;
  }
}

export { MAX_FOOD };
