// localStorage persistence. Saves player position/yaw/pitch, inventory
// (unified slots array), player-modified blocks, time-of-day, food and
// creative-mode state.
//
// Block edits are stored as a list of {x,y,z,id} entries — only blocks
// that differ from the procedural baseline. This keeps save size small.
//
// Save format version history:
//   1 — initial
//   2 — inventory changed from entry list to slots array
//   3 — added food (hunger system) and creative mode flag

import type { InvSlot } from "./inventory";

const SAVE_KEY = "mcjs_save_v3";
const GRAVES_KEY = "mcjs_graves_v1";

export interface GraveEntry {
  x: number;
  y: number;
  z: number;
  items: InvSlot[];
  timestamp: number;
}

export interface SaveData {
  version: 3;
  seed: number;
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  inventory: InvSlot[];
  selectedSlot: number;
  timeOfDay: number;
  blockEdits: Array<{ x: number; y: number; z: number; id: number }>;
  food: number;
  creative: boolean;
}

export function saveGame(data: SaveData): boolean {
  if (typeof window === "undefined") return false;
  try {
    const json = JSON.stringify(data);
    window.localStorage.setItem(SAVE_KEY, json);
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): SaveData | null {
  if (typeof window === "undefined") return null;
  try {
    // Try the current save key first.
    let json = window.localStorage.getItem(SAVE_KEY);
    // Fall back to the v2 key so older saves can still be loaded
    // (they just won't have food / creative fields).
    if (!json) json = window.localStorage.getItem("mcjs_save_v2");
    if (!json) return null;
    const data = JSON.parse(json) as Partial<SaveData> & { version?: number };
    if (!data.version) return null;
    // Bump any older save to v3 shape with defaults for the new fields.
    if (data.version !== 3) {
      // Migrate forward — accept v2 saves, reject unknown future versions.
      if (data.version !== 2) return null;
    }
    return {
      version: 3,
      seed: data.seed ?? 1337,
      player: data.player ?? { x: 0.5, y: 40, z: 0.5, yaw: 0, pitch: 0 },
      inventory: data.inventory ?? [],
      selectedSlot: data.selectedSlot ?? 0,
      timeOfDay: data.timeOfDay ?? 0.25,
      blockEdits: data.blockEdits ?? [],
      food: typeof data.food === "number" ? data.food : 20,
      creative: typeof data.creative === "boolean" ? data.creative : false,
    };
  } catch {
    return null;
  }
}

export function clearSave(): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(SAVE_KEY);
    // Also clear the legacy v2 key in case it still exists.
    window.localStorage.removeItem("mcjs_save_v2");
    return true;
  } catch {
    return false;
  }
}

// --- Graveyard: stores items dropped on death, keyed by grave position. ---

export function saveGrave(grave: GraveEntry): boolean {
  if (typeof window === "undefined") return false;
  try {
    const graves = loadGraves();
    const key = `${grave.x},${grave.y},${grave.z}`;
    graves[key] = grave;
    window.localStorage.setItem(GRAVES_KEY, JSON.stringify(graves));
    return true;
  } catch {
    return false;
  }
}

export function loadGraves(): Record<string, GraveEntry> {
  if (typeof window === "undefined") return {};
  try {
    const json = window.localStorage.getItem(GRAVES_KEY);
    if (!json) return {};
    return JSON.parse(json) as Record<string, GraveEntry>;
  } catch {
    return {};
  }
}

export function loadGrave(x: number, y: number, z: number): GraveEntry | null {
  const graves = loadGraves();
  return graves[`${x},${y},${z}`] ?? null;
}

export function removeGrave(x: number, y: number, z: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    const graves = loadGraves();
    const key = `${x},${y},${z}`;
    if (!(key in graves)) return false;
    delete graves[key];
    window.localStorage.setItem(GRAVES_KEY, JSON.stringify(graves));
    return true;
  } catch {
    return false;
  }
}

export function clearGraves(): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(GRAVES_KEY);
    return true;
  } catch {
    return false;
  }
}
