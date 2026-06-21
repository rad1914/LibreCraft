// Engine: owns the Three.js scene, renderer, camera, lights, world,
// and player. Integrates torches, mobs (passive + aggressive), a life
// system, day/night cycle, sounds, and persistence.

import * as THREE from "three";
import { World } from "./world";
import { Player, InputState } from "./player";
import { BlockType, BLOCKS, getEffectiveHardness } from "./blocks";
import { createTouchControls } from "./touch";
import { getBlockIconDataURL } from "./textures";
import { Inventory, InvSlot } from "./inventory";
import { RECIPES, craft, canCraft, type Recipe } from "./crafting";
import { playBreak, playPlace, playUiClick, playStep, playBreakTick, playHurt, playEat, startMusic, stopMusic } from "./sound";
import { DayNightCycle } from "./daynight";
import { saveGame, loadGame, clearSave, type SaveData } from "./save";
import { MobManager, Mob } from "./mobs";
import { LifeSystem, MAX_HEALTH } from "./life";
import { LanClient, RemotePlayer } from "./lan";
import { HungerSystem, MAX_FOOD } from "./hunger";
import { Commands, type CommandResult } from "./commands";

const RENDER_DISTANCE = 6;
const SAVE_INTERVAL = 5;
const HOTBAR_SIZE = 9;
const MAX_TORCH_LIGHTS = 16;
const STEP_INTERVAL = 0.35; // seconds between footstep sounds
const BREAK_TICK_INTERVAL = 0.15; // seconds between break tick sounds
const FOOD_HEAL = 6;
const MOB_ATTACK_DAMAGE = 2;
const SWORD_ATTACK_DAMAGE = 4; // double damage when a sword is equipped
const BED_SKIP_TIME = 0.25; // time-of-day target after sleeping (sunrise)

export interface EngineCallbacks {
  onFps?: (fps: number) => void;
  onPosition?: (x: number, y: number, z: number) => void;
  onLockChange?: (locked: boolean) => void;
  onSlotChange?: (slot: number) => void;
  onInventoryChange?: (slots: InvSlot[]) => void;
  onCraftToggle?: () => void;
  onCraftTableToggle?: () => void;
  onTimeOfDay?: (time: number) => void;
  onSaveStatus?: (status: "saved" | "loaded" | "cleared" | "none") => void;
  onHealthChange?: (health: number) => void;
  onDeath?: () => void;
  onRespawn?: () => void;
  onSelectedBlockChange?: (blockId: number) => void;
  onBreakProgress?: (progress: number) => void;
  onLanStatus?: (status: "connected" | "disconnected" | "connecting", playerCount: number) => void;
  onFoodChange?: (food: number) => void;
  onCreativeChange?: (on: boolean) => void;
  onCommandResult?: (result: CommandResult) => void;
  onChat?: (sender: string, message: string) => void;
  onChatToggle?: () => void;
}

export class Engine {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: World;
  player: Player;
  callbacks: EngineCallbacks;

  private active = false;
  private touchControls: ReturnType<typeof createTouchControls> | null = null;

  inventory = new Inventory();
  mobs: MobManager;
  life: LifeSystem;
  food: HungerSystem;
  creative = false;
  flying = false;
  commands = new Commands();
  spawnPoint = new THREE.Vector3(0.5, 40, 0.5);
  lan: LanClient;
  private lanConnected = false;

  private torchLights = new Map<string, THREE.PointLight>();

  private input: InputState = {
    forward: false, back: false, left: false, right: false, jump: false, sprint: false,
  };

  private crackOverlay: THREE.LineSegments;
  private breakHeld = false;
  private breakProgress = 0;
  private breakTarget: { x: number; y: number; z: number } | null = null;
  private breakTickTimer = 0;
  private lastBreakProgressReported = 0;

  // Walking sound timer
  private stepTimer = 0;

  private raf = 0;
  private lastTime = 0;
  private fpsAcc = 0;
  private fpsCount = 0;
  private fpsTimer = 0;
  private saveTimer = 0;
  private torchUpdateTimer = 0;
  private running = false;

  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private ambient: THREE.AmbientLight;
  private fog: THREE.Fog;
  private dayNight: DayNightCycle;

  private onResize = () => this.handleResize();

  constructor(canvas: HTMLCanvasElement, container: HTMLElement, callbacks: EngineCallbacks = {}) {
    this.canvas = canvas;
    this.container = container;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ad0ff);
    this.fog = new THREE.Fog(0x9ad0ff, RENDER_DISTANCE * 12, RENDER_DISTANCE * 16 + 16);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 1000);

    this.hemi = new THREE.HemisphereLight(0xcfeeff, 0x5a6b3a, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4d6, 0.85);
    this.sun.position.set(80, 140, 60);
    this.scene.add(this.sun);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambient);

    this.world = new World(this.scene, 1337);
    this.player = new Player(this.camera);

    // Cracking overlay
    const crackGeo = new THREE.BoxGeometry(1.05, 1.05, 1.05);
    const crackEdges = new THREE.EdgesGeometry(crackGeo);
    const crackMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 });
    this.crackOverlay = new THREE.LineSegments(crackEdges, crackMat);
    this.crackOverlay.visible = false;
    this.scene.add(this.crackOverlay);

    this.dayNight = new DayNightCycle(
      { sun: this.sun, hemi: this.hemi, ambient: this.ambient, scene: this.scene },
      this.fog
    );

    // Mob manager with callbacks for damage and kills
    this.mobs = new MobManager(this.scene, this.world, {
      onDamagePlayer: (amount) => {
        if (!this.life.dead) {
          this.life.takeDamage(amount);
          playHurt();
        }
      },
      onMobKilled: (mob) => {
        // Passive mobs drop food; aggressive mobs drop nothing.
        if (mob.type === "passive") {
          this.inventory.add(BlockType.FOOD, 1);
          this.callbacks.onInventoryChange?.(this.inventory.list());
          this.refreshHotbarIcons();
        }
      },
    });

    this.life = new LifeSystem();
    this.life.onHealthChange = (h) => this.callbacks.onHealthChange?.(h);
    this.life.onDeath = () => {
      this.callbacks.onDeath?.();
      setTimeout(() => this.respawn(), 5000); // 5s death cooldown
    };
    this.life.onRespawn = () => this.callbacks.onRespawn?.();

    this.food = new HungerSystem();
    this.food.onFoodChange = (f) => this.callbacks.onFoodChange?.(f);

    // LAN client (not connected until the player chooses to host/join)
    this.lan = new LanClient(this.scene, {
      onConnected: () => {
        this.lanConnected = true;
        this.callbacks.onLanStatus?.("connected", 0);
      },
      onDisconnected: () => {
        this.lanConnected = false;
        this.callbacks.onLanStatus?.("disconnected", 0);
      },
      onPlayersChange: (players) => {
        this.callbacks.onLanStatus?.(this.lanConnected ? "connected" : "disconnected", players.length);
      },
      onRemoteBlock: (x, y, z, id) => {
        // Apply remote block edit without re-broadcasting
        this.world.setBlock(x, y, z, id);
      },
      onChat: (sender, message) => {
        this.callbacks.onChat?.(sender, message);
      },
      onPlayerHealthChange: (id, health) => {
        // Update the remote player's health (for kill tracking).
        // No UI callback needed here; the engine just records the value.
        void id; void health;
      },
      onDamageReceived: (amount, fromId, fromName) => {
        // A remote player attacked us — apply damage to our own life system.
        if (!this.life.dead) {
          this.life.takeDamage(amount);
          playHurt();
          this.callbacks.onChat?.("", `${fromName} hit you for ${amount} dmg`);
        }
      },
    });

    // Pre-generate spawn area.
    this.world.update(0, 0, RENDER_DISTANCE);
    this.player.spawn(this.world);
    this.spawnPoint.copy(this.player.position);

    // Build a small starting shelter near spawn so the player has
    // somewhere to hide from mobs on their first night.
    this.buildSpawnShelter();

    // Load save.
    const save = loadGame();
    if (save) {
      this.world.applyEdits(save.blockEdits);
      this.player.position.set(save.player.x, save.player.y, save.player.z);
      this.player.yaw = save.player.yaw;
      this.player.pitch = save.player.pitch;
      this.inventory.selected = save.selectedSlot;
      for (let i = 0; i < this.inventory.slots.length && i < save.inventory.length; i++) {
        this.inventory.slots[i] = { ...save.inventory[i] };
      }
      this.dayNight.setTime(save.timeOfDay);
      if (typeof save.food === "number") this.food.setFood(save.food);
      if (typeof save.creative === "boolean") this.setCreative(save.creative);
      this.callbacks.onSaveStatus?.("loaded");
    } else {
      this.callbacks.onSaveStatus?.("none");
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    window.addEventListener("resize", this.onResize);

    this.touchControls = createTouchControls(
      this.container,
      this.input,
      HOTBAR_SIZE,
      {
        onPlace: () => this.doPlace(),
        onBreakStart: () => { this.breakHeld = true; },
        onBreakEnd: () => { this.breakHeld = false; this.resetBreak(); },
        onSlotChange: (slot) => {
          this.inventory.selected = slot;
          this.callbacks.onSlotChange?.(slot);
          this.callbacks.onSelectedBlockChange?.(this.inventory.getSelectedBlock());
        },
        onLook: (yawDelta, pitchDelta) => {
          if (!this.active || this.life.dead) return;
          this.player.yaw += yawDelta;
          this.player.pitch += pitchDelta;
          const limit = Math.PI / 2 - 0.001;
          this.player.pitch = Math.max(-limit, Math.min(limit, this.player.pitch));
        },
        onCraft: () => this.callbacks.onCraftToggle?.(),
        onChat: () => this.callbacks.onChatToggle?.(),
        onEat: () => this.eatFood(),
        onJumpLongPress: () => {
          // Toggle creative fly mode (only works in creative)
          if (this.creative) {
            this.flying = !this.flying;
            if (this.flying) {
              this.player.velocity.y = 0;
            }
          }
        },
      }
    );

    this.refreshHotbarIcons();
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.callbacks.onHealthChange?.(this.life.health);
    this.callbacks.onSelectedBlockChange?.(this.inventory.getSelectedBlock());
    this.callbacks.onFoodChange?.(this.food.food);
    this.callbacks.onCreativeChange?.(this.creative);
  }

  private refreshHotbarIcons() {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = this.inventory.slots[i];
      const id = slot?.id ?? BlockType.AIR;
      const dataUrl = id === BlockType.AIR
        ? this.emptyIcon()
        : getBlockIconDataURL(id, "side");
      (this.container as unknown as { __mcSetHotbarIcon?: (slot: number, dataUrl: string) => void }).__mcSetHotbarIcon?.(i, dataUrl);
    }
  }

  private emptyIcon(): string {
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  }

  dispose() {
    this.saveToStorage();
    this.running = false;
    cancelAnimationFrame(this.raf);
    stopMusic();
    if (this.touchControls) {
      this.touchControls.dispose();
      this.touchControls = null;
    }
    this.lan.disconnect();
    this.mobs.dispose();
    this.disposeAllTorchLights();
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
  }

  requestLock() {
    this.active = true;
    this.callbacks.onLockChange?.(true);
    // Start procedural background music when the player enters the world.
    startMusic();
  }

  // --- Public API ---
  getRecipes(): Recipe[] { return RECIPES; }
  canCraft(recipe: Recipe): boolean { return canCraft(this.inventory, recipe); }
  craftRecipe(recipe: Recipe): boolean {
    const ok = craft(this.inventory, recipe);
    if (ok) {
      playUiClick();
      this.callbacks.onInventoryChange?.(this.inventory.list());
      this.refreshHotbarIcons();
    }
    return ok;
  }
  getInventorySlots(): InvSlot[] { return this.inventory.list(); }
  selectSlot(i: number) {
    this.inventory.selectSlot(i);
    this.callbacks.onSlotChange?.(i);
    this.callbacks.onSelectedBlockChange?.(this.inventory.getSelectedBlock());
  }
  setHotbarSlot(slot: number, blockId: number) {
    if (slot < 0 || slot >= HOTBAR_SIZE) return;
    this.inventory.slots[slot] = { id: blockId, count: blockId === BlockType.AIR ? 0 : 1 };
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.refreshHotbarIcons();
    if (slot === this.inventory.selected) {
      this.callbacks.onSelectedBlockChange?.(blockId);
    }
  }
  // Move/swap items between any two inventory slots (hotbar or main).
  // If the source is empty, nothing happens. If the target is empty,
  // the item moves. If both have the same id, they stack. Otherwise
  // they swap.
  moveItem(fromSlot: number, toSlot: number) {
    if (fromSlot === toSlot) return;
    if (fromSlot < 0 || fromSlot >= this.inventory.slots.length) return;
    if (toSlot < 0 || toSlot >= this.inventory.slots.length) return;
    const from = this.inventory.slots[fromSlot];
    const to = this.inventory.slots[toSlot];
    if (from.id === BlockType.AIR) return; // nothing to move
    if (to.id === BlockType.AIR) {
      // Move
      this.inventory.slots[toSlot] = { ...from };
      this.inventory.slots[fromSlot] = { id: BlockType.AIR, count: 0 };
    } else if (to.id === from.id) {
      // Stack
      const total = to.count + from.count;
      const max = 64;
      this.inventory.slots[toSlot].count = Math.min(max, total);
      const leftover = total - Math.min(max, total);
      if (leftover > 0) {
        this.inventory.slots[fromSlot].count = leftover;
      } else {
        this.inventory.slots[fromSlot] = { id: BlockType.AIR, count: 0 };
      }
    } else {
      // Swap
      this.inventory.slots[toSlot] = { ...from };
      this.inventory.slots[fromSlot] = { ...to };
    }
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.refreshHotbarIcons();
    if (fromSlot === this.inventory.selected || toSlot === this.inventory.selected) {
      this.callbacks.onSelectedBlockChange?.(this.inventory.getSelectedBlock());
    }
  }
  resetSave() {
    clearSave();
    this.callbacks.onSaveStatus?.("cleared");
  }
  getHealth(): number { return this.life.health; }
  getMaxHealth(): number { return MAX_HEALTH; }
  getFood(): number { return this.food.food; }
  getMaxFood(): number { return MAX_FOOD; }
  isCreative(): boolean { return this.creative; }

  setCreative(on: boolean) {
    if (this.creative === on) return;
    this.creative = on;
    if (on) {
      this.life.health = MAX_HEALTH;
      this.callbacks.onHealthChange?.(this.life.health);
    } else {
      // Leaving creative: stop flying
      this.flying = false;
    }
    this.callbacks.onCreativeChange?.(on);
  }

  toggleCreative() {
    this.setCreative(!this.creative);
  }

  // Heal to full health instantly (used by /heal command).
  healFull() {
    this.life.health = MAX_HEALTH;
    this.life.dead = false;
    this.callbacks.onHealthChange?.(this.life.health);
    this.callbacks.onRespawn?.();
  }

  // Teleport the player to the given world coordinates.
  teleport(x: number, y: number, z: number) {
    this.player.position.set(x, y, z);
    this.player.velocity.set(0, 0, 0);
  }

  // Set the world time of day (0..1). 0.25 = noon, 0.75 = midnight.
  setTime(t: number) {
    this.dayNight.setTime(t);
    this.callbacks.onTimeOfDay?.(this.dayNight.getTime());
  }

  // Run a command string. Returns the command result and fires the
  // onCommandResult callback so the UI can show a message.
  runCommand(input: string): CommandResult {
    const result = this.commands.run(input, {
      setTime: (t) => this.setTime(t),
      toggleCreative: () => this.toggleCreative(),
      setCreative: (on) => this.setCreative(on),
      heal: () => this.healFull(),
      teleport: (x, y, z) => this.teleport(x, y, z),
    });
    this.callbacks.onCommandResult?.(result);
    return result;
  }

  // Send a chat message over LAN. If the line starts with "/", it is
  // treated as a command and executed locally (and not broadcast).
  // Otherwise it is broadcast to all LAN players as a chat message.
  sendChat(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/")) {
      this.runCommand(trimmed);
      return;
    }
    this.lan.sendChat(trimmed);
    this.callbacks.onChat?.("You", trimmed);
  }

  respawn() {
    this.life.respawn(this.player, this.spawnPoint, this.world);
    this.food.reset();
  }

  // --- LAN multiplayer ---
  hostLan(name: string): boolean {
    this.callbacks.onLanStatus?.("connecting", 0);
    return this.lan.connect(name, 3003);
  }

  // Returns the host address that other players can use to join.
  // Uses the browser's hostname + port 3003.
  getHostAddress(): string {
    if (typeof window === "undefined") return "localhost:3003";
    return `${window.location.hostname}:3003`;
  }

  joinLanHost(name: string, hostAddress: string): boolean {
    this.callbacks.onLanStatus?.("connecting", 0);
    return this.lan.joinHost(name, hostAddress);
  }

  leaveLan() {
    this.lan.disconnect();
    this.lanConnected = false;
    this.callbacks.onLanStatus?.("disconnected", 0);
  }

  isLanConnected(): boolean {
    return this.lanConnected;
  }

  // Eat food: consume 1 FOOD from inventory, restore 6 food (not health).
  // The hunger system handles health regen when food is high enough.
  eatFood(): boolean {
    if (!this.inventory.has(BlockType.FOOD, 1)) return false;
    if (this.food.food >= MAX_FOOD) return false; // already full
    this.inventory.remove(BlockType.FOOD, 1);
    this.food.eat(FOOD_HEAL);
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.refreshHotbarIcons();
    playEat();
    return true;
  }

  // --- Place: tap on look zone ---
  // Also handles attacking mobs AND remote LAN players: if the tap hits
  // a mob or player, damage it instead of placing a block.
  private doPlace() {
    if (!this.active || this.life.dead) return;

    // First check if we hit a mob (attack it)
    const origin = new THREE.Vector3(
      this.player.position.x,
      this.player.position.y + 1.62,
      this.player.position.z
    );
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.player.pitch, this.player.yaw, 0, "YXZ"));
    dir.normalize();
    const mob = this.mobs.getMobAt(origin, dir, 5);
    if (mob) {
      // Sword-equipped players deal more damage
      const dmg = this.inventory.getSelectedBlock() === BlockType.SWORD
        ? SWORD_ATTACK_DAMAGE
        : MOB_ATTACK_DAMAGE;
      this.mobs.damageMob(mob, dmg);
      playBreakTick(1);
      return;
    }

    // Check if we hit a remote LAN player (attack it). Send a damage
    // event over the LAN; the target client applies damage to itself.
    const remote = this.lan.getPlayerAt(origin, dir, 5);
    if (remote) {
      const dmg = this.inventory.getSelectedBlock() === BlockType.SWORD
        ? SWORD_ATTACK_DAMAGE
        : MOB_ATTACK_DAMAGE;
      this.lan.sendDamage(remote.id, dmg);
      playBreakTick(1);
      return;
    }

    // Check if the player tapped an existing bed or crafting table
    const blockHit = this.player.raycast(this.world);
    if (blockHit) {
      const hitId = this.world.getBlock(blockHit.x, blockHit.y, blockHit.z);
      if (hitId === BlockType.BED) {
        // Only allow sleeping at night (dayFactor < 0.4)
        const dayFactor = this.dayNight.getDayFactor();
        if (dayFactor < 0.4) {
          this.sleepInBed();
        } else {
          playUiClick(); // feedback "can't sleep now"
        }
        return;
      }
      if (hitId === BlockType.CRAFTING_TABLE) {
        // Open the crafting table UI (shows all recipes)
        this.callbacks.onCraftTableToggle?.();
        return;
      }
    }

    // Otherwise, place a block
    if (!blockHit) return;
    const px = blockHit.x + blockHit.nx;
    const py = blockHit.y + blockHit.ny;
    const pz = blockHit.z + blockHit.nz;
    const p = this.player.position;
    const half = 0.3;
    if (
      px + 1 > p.x - half && px < p.x + half &&
      py + 1 > p.y && py < p.y + 1.8 &&
      pz + 1 > p.z - half && pz < p.z + half
    ) return;
    // Check the selected slot has items
    if (!this.inventory.hasSelected()) return;
    const blockId = this.inventory.getSelectedBlock();
    if (blockId === BlockType.AIR) return;
    // Don't place non-placeable items (FOOD, SWORD, PICKAXE, AXE, SHOVEL)
    if (
      blockId === BlockType.FOOD ||
      blockId === BlockType.SWORD ||
      blockId === BlockType.PICKAXE ||
      blockId === BlockType.AXE ||
      blockId === BlockType.SHOVEL
    ) return;
    // Place the block and consume 1 from the selected slot
    this.world.setBlock(px, py, pz, blockId);
    this.lan.sendBlock(px, py, pz, blockId);
    this.inventory.consumeSelected();
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.refreshHotbarIcons();
    this.callbacks.onSelectedBlockChange?.(this.inventory.getSelectedBlock());
    playPlace(blockId);
    if (blockId === BlockType.TORCH) {
      this.addTorchLight(px, py, pz);
    }
  }

  // Sleep in a bed: skip the night by advancing time to sunrise (0.25 = noon
  // is too far; 0.0 = sunrise). Also clears nearby aggressive mobs.
  private sleepInBed() {
    this.dayNight.setTime(BED_SKIP_TIME);
    this.callbacks.onTimeOfDay?.(this.dayNight.getTime());
    // Clear all aggressive mobs (they despawn in daylight)
    this.mobs.despawnAggressive();
    playUiClick();
  }

  // --- Break: long-press, with cracking animation ---
  private updateBreak(dt: number) {
    if (!this.breakHeld || this.life.dead) { this.resetBreak(); return; }
    const hit = this.player.raycast(this.world);
    if (!hit) { this.resetBreak(); return; }
    const id = this.world.getBlock(hit.x, hit.y, hit.z);
    // In creative mode, blocks break instantly regardless of hardness.
    const hardness = this.creative ? 0 : getEffectiveHardness(id, this.inventory.getSelectedBlock());
    if (hardness < 0 || id === BlockType.AIR || id === BlockType.WATER) {
      this.resetBreak();
      return;
    }
    if (!this.breakTarget || this.breakTarget.x !== hit.x || this.breakTarget.y !== hit.y || this.breakTarget.z !== hit.z) {
      this.breakTarget = { x: hit.x, y: hit.y, z: hit.z };
      this.breakProgress = 0;
    }
    if (hardness === 0) { this.completeBreak(hit.x, hit.y, hit.z, id); return; }
    this.breakProgress += dt / hardness;

    // Play break tick sound periodically (pitch rises with progress)
    this.breakTickTimer += dt;
    if (this.breakTickTimer >= BREAK_TICK_INTERVAL) {
      playBreakTick(Math.min(1, this.breakProgress));
      this.breakTickTimer = 0;
    }

    // Update cracking overlay
    this.crackOverlay.visible = true;
    this.crackOverlay.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    const scale = 1.0 - 0.7 * Math.min(1, this.breakProgress);
    this.crackOverlay.scale.set(scale, scale, scale);
    (this.crackOverlay.material as THREE.LineBasicMaterial).opacity = 0.4 + 0.5 * Math.min(1, this.breakProgress);

    // Fire progress callback only when progress changes by >= 0.05
    // (avoids flooding React with state updates every frame).
    const progressVal = Math.min(1, this.breakProgress);
    if (Math.abs(progressVal - this.lastBreakProgressReported) >= 0.02 || progressVal === 0) {
      this.callbacks.onBreakProgress?.(progressVal);
      this.lastBreakProgressReported = progressVal;
      // Also update the DOM directly for immediate visual feedback
      // (React state updates can lag behind rapid break progress changes).
      this.updateBreakProgressDom(progressVal);
    }

    if (this.breakProgress >= 1) this.completeBreak(hit.x, hit.y, hit.z, id);
  }

  private completeBreak(x: number, y: number, z: number, id: number) {
    this.world.setBlock(x, y, z, BlockType.AIR);
    this.lan.sendBlock(x, y, z, BlockType.AIR);
    this.inventory.add(id, 1);
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.refreshHotbarIcons();
    playBreak(id);
    if (id === BlockType.TORCH) {
      this.removeTorchLight(x, y, z);
    }
    this.resetBreak();
  }

  private resetBreak() {
    this.breakProgress = 0;
    this.breakTarget = null;
    this.breakTickTimer = 0;
    this.lastBreakProgressReported = 0;
    this.crackOverlay.visible = false;
    this.callbacks.onBreakProgress?.(0);
    this.updateBreakProgressDom(0);
  }

  // Directly update the break progress bar in the DOM (bypasses React
  // state for immediate visual feedback during rapid progress changes).
  private updateBreakProgressDom(progress: number) {
    const container = this.container.querySelector('[data-break-progress]');
    if (container) {
      const fill = container.querySelector('[data-break-progress-fill]') as HTMLElement | null;
      if (fill) {
        fill.style.width = `${Math.min(100, progress * 100)}%`;
      }
      const text = container.querySelector('[data-break-progress-text]') as HTMLElement | null;
      if (text) {
        text.textContent = `${Math.round(progress * 100)}%`;
      }
    }
  }

  // --- Walking sound ---
  private updateWalking(dt: number) {
    if (!this.player.onGround) return;
    const moving = this.input.forward || this.input.back || this.input.left || this.input.right;
    if (!moving) return;
    this.stepTimer += dt;
    const interval = this.input.sprint ? STEP_INTERVAL * 0.7 : STEP_INTERVAL;
    if (this.stepTimer >= interval) {
      playStep();
      this.stepTimer = 0;
    }
  }

  // --- Torch light management ---
  private torchKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private addTorchLight(x: number, y: number, z: number) {
    if (this.torchLights.size >= MAX_TORCH_LIGHTS) return;
    const key = this.torchKey(x, y, z);
    if (this.torchLights.has(key)) return;
    // Bright torch light: high intensity, large radius, warm color.
    const light = new THREE.PointLight(0xffaa44, 3.0, 18, 1.0);
    light.position.set(x + 0.5, y + 0.7, z + 0.5);
    this.scene.add(light);
    this.torchLights.set(key, light);
  }

  private removeTorchLight(x: number, y: number, z: number) {
    const key = this.torchKey(x, y, z);
    const light = this.torchLights.get(key);
    if (light) {
      this.scene.remove(light);
      this.torchLights.delete(key);
    }
  }

  private disposeAllTorchLights() {
    for (const light of this.torchLights.values()) {
      this.scene.remove(light);
    }
    this.torchLights.clear();
  }

  private updateTorchLights() {
    for (const [key, light] of this.torchLights) {
      const [x, y, z] = key.split(",").map(Number);
      if (this.world.getBlock(x, y, z) !== BlockType.TORCH) {
        this.scene.remove(light);
        this.torchLights.delete(key);
      }
    }
    const p = this.player.position;
    const r = 16;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.floor(p.x) + dx;
          const y = Math.floor(p.y) + dy;
          const z = Math.floor(p.z) + dz;
          if (this.world.getBlock(x, y, z) === BlockType.TORCH) {
            this.addTorchLight(x, y, z);
          }
        }
      }
    }
  }

  private handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- Persistence ---
  private saveToStorage() {
    const data: SaveData = {
      version: 3,
      seed: this.world.seed,
      player: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
      },
      inventory: this.inventory.list(),
      selectedSlot: this.inventory.selected,
      timeOfDay: this.dayNight.getTime(),
      blockEdits: this.world.getEdits(),
      food: this.food.food,
      creative: this.creative,
    };
    if (saveGame(data)) this.callbacks.onSaveStatus?.("saved");
  }

  // --- Spawn shelter: a small 3x3 wood/plank hut near spawn ---
  private buildSpawnShelter() {
    // Find a flat spot a few blocks away from the player so the shelter
    // doesn't trap them at spawn. Use the spawn column's surface height.
    const sx = Math.floor(this.spawnPoint.x) + 3;
    const sz = Math.floor(this.spawnPoint.z) + 3;
    // Find ground level (top solid block).
    let groundY = -1;
    for (let y = 60; y > 1; y--) {
      if (this.world.isSolidAt(sx, y, sz)) { groundY = y; break; }
    }
    if (groundY < 0) return;

    const baseY = groundY + 1; // first air block above ground
    // 4 wood pillars at the corners of a 3x3 footprint, 3 blocks tall.
    for (const [ox, oz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
      for (let dy = 0; dy < 3; dy++) {
        this.world.setBlock(sx + ox, baseY + dy, sz + oz, BlockType.WOOD);
      }
    }
    // Plank roof: 3x3 on top of the pillars.
    for (let dx = 0; dx <= 2; dx++) {
      for (let dz = 0; dz <= 2; dz++) {
        this.world.setBlock(sx + dx, baseY + 3, sz + dz, BlockType.PLANKS);
      }
    }
    // Crafting table inside, on the floor.
    this.world.setBlock(sx + 1, baseY, sz + 1, BlockType.CRAFTING_TABLE);
    // Torch on one of the interior walls.
    this.world.setBlock(sx, baseY + 1, sz + 1, BlockType.TORCH);
    this.addTorchLight(sx, baseY + 1, sz + 1);
  }

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.active && !this.life.dead) {
      // Hunger-driven slow effect: when food < 6, player walks at 60%.
      this.player.speedMultiplier = this.food.shouldSlow ? 0.6 : 1;
      // In creative mode, the player is invincible.
      if (this.creative && this.life.health < MAX_HEALTH) {
        this.life.health = MAX_HEALTH;
        this.callbacks.onHealthChange?.(this.life.health);
      }
      // Creative fly: holding JUMP elevates, no gravity
      if (this.flying) {
        if (this.input.jump) {
          this.player.velocity.y = 6.0; // rise
        } else {
          this.player.velocity.y *= 0.85; // slow descent
        }
      }
      this.player.update(dt, this.input, this.world);
      // In creative fly, skip ground collision on Y so the player can fly up
      if (this.flying) {
        // Override onGround so fly doesn't trigger fall damage
        this.player.onGround = true;
      }
      this.updateBreak(dt);
      this.updateWalking(dt);
      // Skip fall damage in creative mode
      if (!this.creative) {
        this.life.update(this.player.position.y, this.player.onGround);
      }
      // Hunger tick: applies regen / starvation effects.
      const moving = this.input.forward || this.input.back || this.input.left || this.input.right;
      const ev = this.food.update(dt, !this.life.dead, moving, this.input.sprint && moving);
      if (ev.regen && !this.creative) {
        this.life.health = Math.min(MAX_HEALTH, this.life.health + ev.regen);
        this.callbacks.onHealthChange?.(this.life.health);
      }
      if (ev.starve && !this.creative) {
        this.life.takeDamage(ev.starve);
      }
    } else {
      // Reset the slow multiplier when paused so sprinting on resume feels right.
      this.player.speedMultiplier = 1;
    }
    // LAN: send local player position
    this.lan.update(dt, this.player.position.x, this.player.position.y, this.player.position.z, this.player.yaw, this.player.pitch);
    // LAN: broadcast our health so other clients can render it / know
    // when we died. Throttled inside the client.
    this.lan.broadcastHealth(dt, this.life.health);
    this.world.update(this.player.position.x, this.player.position.z, RENDER_DISTANCE);
    this.world.processDirtyBudget(8); // increased budget for faster chunk loading
    this.dayNight.update(dt);

    const dayFactor = this.dayNight.getDayFactor();
    this.mobs.update(dt, this.player.position, dayFactor);

    this.torchUpdateTimer += dt;
    if (this.torchUpdateTimer > 0.5) {
      this.updateTorchLights();
      this.torchUpdateTimer = 0;
    }

    this.renderer.render(this.scene, this.camera);

    this.fpsAcc += 1 / Math.max(dt, 1e-4);
    this.fpsCount++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.callbacks.onFps?.(Math.round(this.fpsAcc / this.fpsCount));
      this.callbacks.onPosition?.(
        this.player.position.x,
        this.player.position.y,
        this.player.position.z
      );
      this.callbacks.onTimeOfDay?.(this.dayNight.getTime());
      this.fpsAcc = 0;
      this.fpsCount = 0;
      this.fpsTimer = 0;
    }

    this.saveTimer += dt;
    if (this.saveTimer >= SAVE_INTERVAL && this.active) {
      this.saveToStorage();
      this.saveTimer = 0;
    }
  };
}
