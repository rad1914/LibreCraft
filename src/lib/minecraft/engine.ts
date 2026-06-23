// Engine: owns the Three.js scene, renderer, camera, lights, world,
// and player. Integrates torches, mobs (passive + hostile), a life
// system, day/night cycle, sounds, and persistence.

import * as THREE from "three";
import { World, type Dimension } from "./world";
import { Player, InputState } from "./player";
import { BlockType, BLOCKS, getEffectiveHardness } from "./blocks";
import { createTouchControls } from "./touch";
import { getBlockIconDataURL } from "./textures";
import { Inventory, InvSlot, HOTBAR_SIZE } from "./inventory";
import { craft, type Recipe } from "./crafting";
import { playBreak, playPlace, playUiClick, playStep, playBreakTick, playHurt, playEat, playPortalAmbient, playPortalForm, playSpookyGlitch } from "./sound";
import { DayNightCycle } from "./daynight";
import { saveGame, loadGame, clearSave, clearGraves, saveGrave, loadGrave, removeGrave, type SaveData, type GraveEntry } from "./save";
import { MobManager, type MobType } from "./mobs";
import { LifeSystem, MAX_HEALTH } from "./life";
import { LanClient } from "./lan";
import { HungerSystem, MAX_FOOD } from "./hunger";
import { runCommand, type CommandResult } from "./commands";
import { EventManager } from "./events";

const SAVE_INTERVAL = 5;
const MAX_TORCH_LIGHTS = 16;
const STEP_INTERVAL = 0.35; // seconds between footstep sounds
const BREAK_TICK_INTERVAL = 0.15; // seconds between break tick sounds
const FOOD_HEAL = 6;
const MOB_ATTACK_DAMAGE = 2;
const SWORD_ATTACK_DAMAGE = 4; // double damage when a sword is equipped
const BED_SKIP_TIME = 0.25; // time-of-day target after sleeping (sunrise)
// Breath system: player can hold their breath for MAX_BREATH seconds
// while submerged. After that, they take DROWN_DAMAGE per second.
const MAX_BREATH = 10;
const DROWN_DAMAGE = 2; // 1 heart per second once out of breath
// Procedural villages: each region is a grid of VILLAGE_REGION_SIZE chunks.
const VILLAGE_REGION_SIZE = 4;
const VILLAGE_CHANCE = 0.25;
// Render distance (in chunks). Mutable so the player can pick a smaller
// radius on slower devices or a larger one on desktop. The fog far plane
// is recomputed when this changes.
const DEFAULT_RENDER_DISTANCE = 6;
const MIN_RENDER_DISTANCE = 3;
const MAX_RENDER_DISTANCE = 12;
// 1x1 transparent PNG — used as the empty-hotbar-slot icon.
const EMPTY_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

export interface EngineCallbacks {
  onFps?: (fps: number) => void;
  onPosition?: (x: number, y: number, z: number) => void;
  onLockChange?: (locked: boolean) => void;
  onSlotChange?: (slot: number) => void;
  onInventoryChange?: (slots: InvSlot[]) => void;
  onCraftToggle?: () => void;
  onCraftTableToggle?: () => void;
  onTradeToggle?: () => void; // open the villager trading UI
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
  // Submerged state (player's eye is in water) — drives the underwater
  // overlay and breath meter in the UI.
  onSubmergedChange?: (submerged: boolean, breath: number, maxBreath: number) => void;
  // FPS mode change — notifies the UI when the target frame rate changes.
  onFpsModeChange?: (fps: number) => void;
  // Dimension change — notifies the UI when the player travels between
  // the overworld and the sky dimension.
  onDimensionChange?: (dimension: Dimension) => void;
  // Sprint toggle — fired by the touch controls when the sprint button is pressed.
  onToggleSprint?: (sprinting: boolean) => void;
  // Render distance changed — fired when the player picks a new chunk radius.
  onRenderDistanceChange?: (distance: number) => void;
  // Event active state changed — fired when a gameplay event (red moon,
  // etc.) starts or ends. The UI shows a badge while active.
  onEventChange?: (active: boolean) => void;
}

export class Engine {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: World;
  // Sky dimension world — loaded lazily when the player first travels.
  // The active world (this.world) is swapped with this one on travel.
  skyWorld: World | null = null;
  // Current dimension: "overworld" (default) or "sky". Determines which
  // world is active and how the player spawns.
  currentDimension: Dimension = "overworld";
  // Portal travel cooldown — prevents rapid back-and-forth teleporting.
  private portalCooldown = 0;
  // Spawn point in the sky dimension (set on first travel).
  private skySpawnPoint = new THREE.Vector3(0.5, 40, 0.5);
  player: Player;
  callbacks: EngineCallbacks;

  private active = false;
  private touchControls: ReturnType<typeof createTouchControls> | null = null;

  inventory = new Inventory();
  mobs: MobManager;
  life: LifeSystem;
  food: HungerSystem;
  events: EventManager;
  // Tracks the previous event-active state so we only fire onEventChange
  // when it actually transitions.
  private wasEventActive = false;
  creative = false;
  flying = false;
  spawnPoint = new THREE.Vector3(0.5, 40, 0.5);
  lan: LanClient;
  private lanConnected = false;
  // Render distance in chunks — adjustable at runtime via setRenderDistance.
  renderDistance = DEFAULT_RENDER_DISTANCE;

  private torchLights = new Map<string, THREE.PointLight>();
  // Offhand torch light — a dynamic PointLight that follows the player
  // when a torch is in the offhand slot. Provides walking illumination.
  private offhandTorchLight: THREE.PointLight | null = null;
  // Procedural village sites — tracks which chunk regions have already
  // had their village attempt evaluated. Keyed by "regionCX,regionCZ"
  // where each region is VILLAGE_REGION_SIZE chunks. One village attempt
  // per region; the deterministic hash decides if it actually spawns.
  private villageRegionsTried = new Set<string>();

  // Breath meter: counts down while submerged, refills while above water.
  private breath = MAX_BREATH;
  private wasSubmerged = false;
  private drownAccum = 0; // accumulator for drowning damage ticks

  // FPS limiter: target frame rate (60 or 120). The loop skips rendering
  // if not enough time has elapsed since the last frame, reducing GPU/CPU
  // load on high-refresh-rate displays that don't need 120fps.
  private targetFps = 60;
  private frameInterval = 1000 / 60;
  private lastFrameTime = 0;

  private input: InputState = {
    forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false,
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
  // Portal ambient sound timer — plays a spooky whisper every few seconds
  // when the player is near a portal block.
  private portalAmbientTimer = 0;
  // Spooky glitch sound timer — ultra-rare eerie sounds at night or while
  // mining deep underground. Fires roughly once every 60-120s when
  // conditions are met (night OR deep underground).
  private spookyGlitchTimer = 30 + Math.random() * 60;
  private running = false;

  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private ambient: THREE.AmbientLight;
  private fog: THREE.Fog;
  private dayNight: DayNightCycle;
  // Visual sun sphere + cloud group (decorative sky elements).
  private sunMesh: THREE.Mesh;
  private cloudGroup: THREE.Group;

  private onResize = () => this.handleResize();

  // Keyboard input: WASD moves, Space jumps, Shift sneaks, 1-9 selects hotbar.
  // These complement the on-screen touch controls (which work via mouse/touch).
  private onKeyDown = (e: KeyboardEvent) => {
    // Don't intercept typing in input fields (chat, etc.)
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.input.forward = true; break;
      case "KeyS": case "ArrowDown": this.input.back = true; break;
      case "KeyA": case "ArrowLeft": this.input.left = true; break;
      case "KeyD": case "ArrowRight": this.input.right = true; break;
      case "Space": this.input.jump = true; e.preventDefault(); break;
      case "ShiftLeft": case "ShiftRight": this.input.sneak = true; break;
      case "Digit1": case "Digit2": case "Digit3": case "Digit4": case "Digit5":
      case "Digit6": case "Digit7": case "Digit8": case "Digit9": {
        const slot = parseInt(e.code.slice(5), 10) - 1;
        if (slot >= 0 && slot < HOTBAR_SIZE) {
          this.inventory.selected = slot;
          this.callbacks.onSlotChange?.(slot);
          this.callbacks.onSelectedBlockChange?.(this.inventory.getSelectedBlock());
        }
        break;
      }
      case "KeyF": this.setTargetFps(this.targetFps === 60 ? 120 : 60); break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.input.forward = false; break;
      case "KeyS": case "ArrowDown": this.input.back = false; break;
      case "KeyA": case "ArrowLeft": this.input.left = false; break;
      case "KeyD": case "ArrowRight": this.input.right = false; break;
      case "Space": this.input.jump = false; break;
      case "ShiftLeft": case "ShiftRight": this.input.sneak = false; break;
    }
  };

  constructor(canvas: HTMLCanvasElement, container: HTMLElement, callbacks: EngineCallbacks = {}) {
    this.canvas = canvas;
    this.container = container;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    // Use the full device pixel ratio (capped at 2 for perf on 3x phones)
    // to keep textures crisp on high-DPI / Retina displays.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ad0ff);
    this.fog = new THREE.Fog(0x9ad0ff, this.renderDistance * 12, this.renderDistance * 16 + 16);
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

    // Sun: a bright yellow sphere placed far away in the sky. It follows
    // the directional light position so it visually matches the sun angle.
    const sunGeo = new THREE.SphereGeometry(8, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sunMesh);
    // Register the sun mesh + add moon + stars to the scene via the
    // day/night cycle (it manages night-only sky elements).
    this.dayNight.addSkyElements(this.scene, this.sunMesh);

    // Clouds: a few flat white puff clusters at high altitude. They're
    // static (no wind) for simplicity — just decorative.
    this.cloudGroup = new THREE.Group();
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      fog: false,
    });
    for (let i = 0; i < 12; i++) {
      const cloud = new THREE.Group();
      const puffCount = 3 + Math.floor(Math.random() * 4);
      for (let p = 0; p < puffCount; p++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(2 + Math.random() * 2, 8, 6),
          cloudMat,
        );
        puff.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 1, (Math.random() - 0.5) * 8);
        puff.scale.y = 0.5; // flatten puffs
        cloud.add(puff);
      }
      // Spread clouds across a large area around the player.
      cloud.position.set(
        (Math.random() - 0.5) * 200,
        70 + Math.random() * 20,
        (Math.random() - 0.5) * 200,
      );
      this.cloudGroup.add(cloud);
    }
    this.scene.add(this.cloudGroup);

    // Mob manager with callbacks for damage and kills
    this.mobs = new MobManager(this.scene, this.world, {
      onDamagePlayer: (amount) => {
        if (!this.life.dead) {
          this.life.takeDamage(amount);
          playHurt();
        }
      },
      onMobKilled: (mob) => {
        // All passive mobs drop food. Sheep also drops wool.
        if (mob.type === "pig" || mob.type === "cow" || mob.type === "sheep") {
          this.inventory.add(BlockType.FOOD, 1);
          if (mob.type === "sheep") this.inventory.add(BlockType.WOOL, 1);
          this.callbacks.onInventoryChange?.(this.inventory.list());
          this.refreshHotbarIcons();
        }
        // Iron golems drop iron ore when killed.
        if (mob.type === "iron_golem") {
          this.inventory.add(BlockType.IRON_ORE, 2);
          this.callbacks.onInventoryChange?.(this.inventory.list());
          this.refreshHotbarIcons();
        }
        // Villagers drop nothing (they're NPCs). Night mobs drop nothing.
      },
      onKnockbackPlayer: (dx, dy, dz) => {
        // Apply an impulse to the player's velocity — flying mobs shove.
        if (!this.life.dead) {
          this.player.velocity.x += dx;
          this.player.velocity.y += dy;
          this.player.velocity.z += dz;
        }
      },
    });

    this.life = new LifeSystem();
    this.life.onHealthChange = (h) => this.callbacks.onHealthChange?.(h);
    this.life.onDeath = () => {
      // Drop the entire inventory into a grave at the death location.
      // The grave block is placed (and the items stored in localStorage)
      // so the player can return to recover their gear after respawning.
      this.dropInventoryAsGrave();
      // If the player died in the sky dimension, force them back to the
      // overworld on respawn. The respawn() method checks currentDimension.
      if (this.currentDimension === "sky") {
        this.swapToOverworld();
      }
      this.callbacks.onDeath?.();
      setTimeout(() => this.respawn(), 6000); // 6s death cooldown
    };
    this.life.onRespawn = () => this.callbacks.onRespawn?.();

    this.food = new HungerSystem();
    this.food.onFoodChange = (f) => this.callbacks.onFoodChange?.(f);

    // Event manager — handles periodic gameplay events (red moon, etc.).
    this.events = new EventManager({
      spawnHostileMob: () => {
        // Spawn a hostile mob (goblin or shade) near the player.
        const type: MobType = Math.random() < 0.5 ? "goblin" : "flying";
        this.mobs.spawnMobAt(
          this.player.position.x + (Math.random() - 0.5) * 10,
          this.player.position.y,
          this.player.position.z + (Math.random() - 0.5) * 10,
          type,
        );
        return true;
      },
      damagePlayer: (amount, dx, dy, dz) => {
        if (!this.life.dead) {
          this.life.takeDamage(amount);
          this.player.velocity.x += dx;
          this.player.velocity.y += dy;
          this.player.velocity.z += dz;
          playHurt();
        }
      },
      getPlayerHealth: () => this.life.health,
    });

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
      onDamageReceived: (amount, _fromId, fromName) => {
        // A remote player attacked us — apply damage to our own life system.
        if (!this.life.dead) {
          this.life.takeDamage(amount);
          playHurt();
          this.callbacks.onChat?.("", `${fromName} hit you for ${amount} dmg`);
        }
      },
    });

    // Pre-generate spawn area.
    this.world.update(0, 0, this.renderDistance);
    this.player.spawn(this.world);
    this.spawnPoint.copy(this.player.position);

    // Build a small starting shelter near spawn so the player has
    // somewhere to hide from mobs on their first night.
    this.buildSpawnShelter();
    // Note: villages are NOT spawned at a fixed location. They're
    // generated procedurally as the player explores — see
    // maybeSpawnProceduralVillage() in the main loop. This spreads
    // villages across the world instead of clustering one at spawn.

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
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

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
        onToggleSprint: (sprinting) => this.callbacks.onToggleSprint?.(sprinting),
      }
    );

    this.refreshHotbarIcons();
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.callbacks.onHealthChange?.(this.life.health);
    this.callbacks.onSelectedBlockChange?.(this.inventory.getSelectedBlock());
    this.callbacks.onFoodChange?.(this.food.food);
    this.callbacks.onCreativeChange?.(this.creative);

    // Position the camera at the spawn point so the intro/title screen
    // shows the player's actual spawn area (not a blank void at origin).
    // The camera looks slightly downward and outward at the terrain.
    this.camera.position.set(
      this.player.position.x,
      this.player.position.y + 1.62,
      this.player.position.z
    );
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.player.yaw;
    this.camera.rotation.x = this.player.pitch;
    // Render one frame so the intro background shows the spawn area.
    this.renderer.render(this.scene, this.camera);
  }

  private refreshHotbarIcons() {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = this.inventory.slots[i];
      const id = slot?.id ?? BlockType.AIR;
      const count = slot?.count ?? 0;
      const dataUrl = id === BlockType.AIR ? EMPTY_ICON : getBlockIconDataURL(id, "side");
      (this.container as unknown as { __mcSetHotbarIcon?: (slot: number, dataUrl: string) => void }).__mcSetHotbarIcon?.(i, dataUrl);
      (this.container as unknown as { __mcSetHotbarCount?: (slot: number, count: number) => void }).__mcSetHotbarCount?.(i, count);
    }
  }

  dispose() {
    this.saveToStorage();
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.touchControls) {
      this.touchControls.dispose();
      this.touchControls = null;
    }
    this.lan.disconnect();
    this.mobs.dispose();
    this.disposeAllTorchLights();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.renderer.dispose();
  }

  requestLock() {
    this.active = true;
    this.callbacks.onLockChange?.(true);
  }

  // --- Public API ---
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
    // Slot 0 is reserved for FOOD. Prevent moving anything out of slot 0
    // or moving non-FOOD items into slot 0. This guarantees the player
    // always has a food slot they can eat from via long-press.
    const FOOD_SLOT = 0;
    if (fromSlot === FOOD_SLOT) return; // can't pick up from food slot
    if (toSlot === FOOD_SLOT && from.id !== BlockType.FOOD) return; // only food goes into slot 0
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

  // --- Offhand slot (slot -1) ---
  // Move an item from main slot `index` to the offhand slot. Only torches
  // and swords are accepted. Returns true on success.
  moveToOffhand(index: number): boolean {
    const ok = this.inventory.moveToOffhand(index);
    if (ok) {
      this.callbacks.onInventoryChange?.(this.inventory.list());
      this.refreshHotbarIcons();
    }
    return ok;
  }
  // Move the offhand item back to the main inventory.
  moveOffhandToMain(): boolean {
    const ok = this.inventory.moveOffhandToMain();
    if (ok) {
      this.callbacks.onInventoryChange?.(this.inventory.list());
      this.refreshHotbarIcons();
    }
    return ok;
  }
  // Get the current offhand slot contents (for UI rendering).
  getOffhandSlot(): InvSlot {
    return { ...this.inventory.offhand };
  }

  resetSave() {
    clearSave();
    clearGraves();
    this.callbacks.onSaveStatus?.("cleared");
  }
  getHealth(): number { return this.life.health; }
  getMaxHealth(): number { return MAX_HEALTH; }
  getFood(): number { return this.food.food; }
  getMaxFood(): number { return MAX_FOOD; }
  getMaxBreath(): number { return MAX_BREATH; }
  isCreative(): boolean { return this.creative; }
  getTargetFps(): number { return this.targetFps; }
  setTargetFps(fps: number) {
    if (fps !== 60 && fps !== 120) return;
    this.targetFps = fps;
    this.frameInterval = 1000 / fps;
    this.callbacks.onFpsModeChange?.(fps);
  }

  // --- Render distance (chunk radius) ---
  getRenderDistance(): number { return this.renderDistance; }
  setRenderDistance(d: number) {
    const clamped = Math.max(MIN_RENDER_DISTANCE, Math.min(MAX_RENDER_DISTANCE, Math.floor(d)));
    if (clamped === this.renderDistance) return;
    this.renderDistance = clamped;
    // Recompute fog far/near planes so distant chunks fade smoothly.
    this.fog.near = this.renderDistance * 12;
    this.fog.far = this.renderDistance * 16 + 16;
    this.callbacks.onRenderDistanceChange?.(this.renderDistance);
  }

  // --- Trading system ---
  // Returns the list of available trades. Each trade costs N rubies and
  // gives the player an item. Ruby is the currency (mined from ruby ore).
  getTradeOffers(): Array<{ id: string; name: string; rubyCost: number; output: { id: number; count: number } }> {
    return [
      { id: "buy_iron_pickaxe", name: "Iron Pickaxe", rubyCost: 3, output: { id: BlockType.IRON_PICKAXE, count: 1 } },
      { id: "buy_diamond_pickaxe", name: "Diamond Pickaxe", rubyCost: 8, output: { id: BlockType.DIAMOND_PICKAXE, count: 1 } },
      { id: "buy_sword", name: "Sword", rubyCost: 2, output: { id: BlockType.SWORD, count: 1 } },
      { id: "buy_food", name: "10 Food", rubyCost: 1, output: { id: BlockType.FOOD, count: 10 } },
      { id: "buy_iron_ore", name: "5 Iron Ore", rubyCost: 2, output: { id: BlockType.IRON_ORE, count: 5 } },
      { id: "buy_diamond_ore", name: "3 Diamond Ore", rubyCost: 5, output: { id: BlockType.DIAMOND_ORE, count: 3 } },
      { id: "buy_wood", name: "32 Wood", rubyCost: 1, output: { id: BlockType.WOOD, count: 32 } },
      { id: "buy_glass", name: "16 Glass", rubyCost: 2, output: { id: BlockType.GLASS, count: 16 } },
    ];
  }

  // Execute a trade by id. Returns true if the trade succeeded (enough
  // rubies + inventory space), false otherwise.
  executeTrade(tradeId: string): boolean {
    const offers = this.getTradeOffers();
    const trade = offers.find((o) => o.id === tradeId);
    if (!trade) return false;
    // Check if the player has enough rubies.
    if (this.inventory.count(BlockType.RUBY) < trade.rubyCost) return false;
    // Remove rubies and add the output item.
    this.inventory.remove(BlockType.RUBY, trade.rubyCost);
    this.inventory.add(trade.output.id, trade.output.count);
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.refreshHotbarIcons();
    playUiClick();
    return true;
  }

  // Count how many rubies the player has (for the trade UI display).
  countRuby(): number {
    return this.inventory.count(BlockType.RUBY);
  }

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
    const result = runCommand(input, {
      setTime: (t) => this.setTime(t),
      toggleCreative: () => this.toggleCreative(),
      setCreative: (on) => this.setCreative(on),
      heal: () => this.healFull(),
      teleport: (x, y, z) => this.teleport(x, y, z),
      spawnMob: (type) => this.spawnMobByName(type),
      giveItem: (name, count) => this.giveItemByName(name, count),
    });
    this.callbacks.onCommandResult?.(result);
    return result;
  }

  // Spawn a mob by name near the player. Used by the /spawn command.
  // Returns true if the name resolved to a known mob type.
  private spawnMobByName(type: string): boolean {
    const valid: Record<string, MobType> = {
      pig: "pig", cow: "cow", sheep: "sheep", wolf: "wolf",
      goblin: "goblin", flying: "flying", shade: "flying", shades: "flying",
      dragon: "dragon",
      iron_golem: "iron_golem", golem: "iron_golem",
      villager: "villager",
    };
    const t = valid[type.toLowerCase()];
    if (!t) return false;
    // Spawn 2 blocks in front of the player at ground level.
    const dx = Math.sin(this.player.yaw) * 2;
    const dz = Math.cos(this.player.yaw) * 2;
    const x = Math.floor(this.player.position.x + dx) + 0.5;
    const z = Math.floor(this.player.position.z + dz) + 0.5;
    // Find ground level at the spawn point.
    let y = Math.floor(this.player.position.y);
    for (let yy = y; yy > 1; yy--) {
      if (this.world.isSolidAt(Math.floor(x), yy, Math.floor(z))) { y = yy + 1; break; }
    }
    this.mobs.spawnMobAt(x, y, z, t);
    return true;
  }

  // Give the player `count` of the block/item named `name`. Used by
  // the /give command. Matches against BLOCKS names (case-insensitive,
  // spaces→underscores). Returns true if the name resolved.
  private giveItemByName(name: string, count: number): boolean {
    const query = name.toLowerCase().replace(/\s+/g, "_");
    // Look up the block id by name.
    for (const id in BLOCKS) {
      const def = BLOCKS[Number(id)];
      if (!def) continue;
      const blockName = def.name.toLowerCase().replace(/\s+/g, "_");
      if (blockName === query) {
        this.inventory.add(Number(id), count);
        this.callbacks.onInventoryChange?.(this.inventory.list());
        this.refreshHotbarIcons();
        return true;
      }
    }
    return false;
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

  // Drop the entire inventory at the player's current position, stored
  // inside a GRAVE block. The items are persisted in localStorage keyed
  // by grave position so the player can recover them by breaking the
  // grave block after respawning.
  private dropInventoryAsGrave() {
    const items = this.inventory.list().filter((s) => s.id !== BlockType.AIR && s.count > 0);
    if (items.length === 0) return;

    // Find a safe place for the grave: try the player's current block
    // first; if it's solid, scan upward for the first air block.
    let gx = Math.floor(this.player.position.x);
    let gy = Math.floor(this.player.position.y);
    let gz = Math.floor(this.player.position.z);
    for (let i = 0; i < 10; i++) {
      if (this.world.getBlock(gx, gy, gz) === BlockType.AIR) break;
      gy++;
    }

    // Place the grave block and record it in the world edits so it
    // persists across saves.
    this.world.setBlock(gx, gy, gz, BlockType.GRAVE);

    // Store the items in localStorage keyed by grave position.
    const grave: GraveEntry = {
      x: gx, y: gy, z: gz,
      items,
      timestamp: Date.now(),
    };
    saveGrave(grave);

    // Clear the player's inventory — they respawn empty-handed.
    for (let i = 0; i < this.inventory.slots.length; i++) {
      this.inventory.slots[i] = { id: BlockType.AIR, count: 0 };
    }
    this.inventory.selected = 0;
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.refreshHotbarIcons();
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
  private attackDamage(): number {
    // Sword in the hotbar: double damage. Sword in the offhand: +2 bonus
    // on top of the base damage (the offhand sword is a passive buff).
    const hasHotbarSword = this.inventory.getSelectedBlock() === BlockType.SWORD;
    const hasOffhandSword = this.inventory.getOffhand() === BlockType.SWORD;
    let dmg = hasHotbarSword ? SWORD_ATTACK_DAMAGE : MOB_ATTACK_DAMAGE;
    if (hasOffhandSword) dmg += 2;
    return dmg;
  }

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
      // Villagers: tap to trade (don't attack).
      if (mob.type === "villager") {
        this.callbacks.onTradeToggle?.();
        playUiClick();
        return;
      }
      // Iron golems: if the player is holding iron ore and the golem is
      // damaged, feed the ore to heal it instead of attacking.
      if (mob.type === "iron_golem" && this.inventory.getSelectedBlock() === BlockType.IRON_ORE && mob.health < mob.maxHealth) {
        this.inventory.consumeSelected();
        this.callbacks.onInventoryChange?.(this.inventory.list());
        this.refreshHotbarIcons();
        mob.heal(10); // 5 hearts per iron ore
        playUiClick();
        return;
      }
      // Sword-equipped players deal more damage
      this.mobs.damageMob(mob, this.attackDamage());
      playBreakTick(1);
      return;
    }

    // Check if we hit a remote LAN player (attack it). Send a damage
    // event over the LAN; the target client applies damage to itself.
    const remote = this.lan.getPlayerAt(origin, dir, 5);
    if (remote) {
      this.lan.sendDamage(remote.id, this.attackDamage());
      playBreakTick(1);
      return;
    }

    // Check if the player tapped an existing bed, crafting table, or door
    const blockHit = this.player.raycast(this.world);
    if (blockHit) {
      const hitId = this.world.getBlock(blockHit.x, blockHit.y, blockHit.z);
      if (hitId === BlockType.BED) {
        // Beds don't work in the sky dimension — the sky has no day/night
        // cycle to skip, and sleeping in the void feels wrong.
        if (this.currentDimension === "sky") {
          playUiClick(); // "can't sleep" feedback
          return;
        }
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
      if (hitId === BlockType.DOOR) {
        // Toggle the door open/closed. Open doors are tracked in a Set
        // (the block id stays DOOR; the Set records whether it's open).
        this.toggleDoor(blockHit.x, blockHit.y, blockHit.z);
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
    // Don't place non-placeable items (FOOD, SWORD, pickaxes, AXE, SHOVEL, COAL, RUBY, GRAVE, PORTAL, PORTAL_SKY)
    // All inventory-only items have id >= 100; GRAVE/PORTAL/PORTAL_SKY are also non-placeable.
    if (blockId >= 100 || blockId === BlockType.GRAVE || blockId === BlockType.PORTAL || blockId === BlockType.PORTAL_SKY) return;
    // Doors are 2 blocks tall — require air above the placement target.
    if (blockId === BlockType.DOOR) {
      if (this.world.getBlock(px, py + 1, pz) !== BlockType.AIR) return;
      this.world.setBlock(px, py, pz, BlockType.DOOR);
      this.world.setBlock(px, py + 1, pz, BlockType.DOOR);
      this.lan.sendBlock(px, py, pz, BlockType.DOOR);
      this.lan.sendBlock(px, py + 1, pz, BlockType.DOOR);
    } else {
      this.world.setBlock(px, py, pz, blockId);
      this.lan.sendBlock(px, py, pz, blockId);
    }
    // Place the block. In creative mode, don't consume the item (unlimited).
    if (!this.creative) {
      this.inventory.consumeSelected();
    }
    this.callbacks.onInventoryChange?.(this.inventory.list());
    this.refreshHotbarIcons();
    this.callbacks.onSelectedBlockChange?.(this.inventory.getSelectedBlock());
    playPlace(blockId);
    if (blockId === BlockType.TORCH) {
      this.addTorchLight(px, py, pz);
    }
    // Check if placing this block completed a 4x4 stone ring portal.
    this.checkPortalFormation(px, py, pz);
    // Check if placing this block completed a + (cross) of iron ore —
    // the iron golem summon pattern. The cross is a vertical column of
    // 3 IRON_ORE with two arms extending left+right at the middle row,
    // and a WOOL block (pumpkin-equivalent) on top. The golem spawns
    // and the iron ore is consumed.
    this.checkIronGolemFormation(px, py, pz);
  }

  // Detect a + (cross) of IRON_ORE with a WOOL head on top:
  //
  //            [WOOL]
  //            [ORE ]
  //   [ORE ]   [ORE ]   [ORE ]
  //            [ORE ]
  //
  // When found, all 5 iron ore + the wool are removed (replaced with AIR)
  // and an iron golem mob spawns in their place. Uses iron ore (not a
  // separate iron block) since IRON_BLOCK was removed from the game.
  private checkIronGolemFormation(bx: number, by: number, bz: number) {
    // The placed block could be any of the 6 blocks in the pattern.
    // Scan vertical offsets dy in [-3..0] (the cross is 4 tall, with the
    // head on top — so the bottom of the column could be at by-3..by).
    for (let dy = -3; dy <= 0; dy++) {
      const baseY = by + dy;
      const isOre = (id: number) => id === BlockType.IRON_ORE;
      // Layout:
      //   y=baseY+3: WOOL (head)
      //   y=baseY+2: IRON_ORE (top of column)
      //   y=baseY+1: IRON_ORE (middle, with arms left+right)
      //   y=baseY:   IRON_ORE (bottom of column)
      //   arms at (bx-1, baseY+1, bz) and (bx+1, baseY+1, bz)
      if (!isOre(this.world.getBlock(bx, baseY, bz))) continue;
      if (!isOre(this.world.getBlock(bx, baseY + 1, bz))) continue;
      if (!isOre(this.world.getBlock(bx, baseY + 2, bz))) continue;
      if (this.world.getBlock(bx, baseY + 3, bz) !== BlockType.WOOL) continue;
      if (!isOre(this.world.getBlock(bx - 1, baseY + 1, bz))) continue;
      if (!isOre(this.world.getBlock(bx + 1, baseY + 1, bz))) continue;
      // Pattern complete — consume the blocks and spawn the golem.
      for (const [x, y, z] of [
        [bx, baseY, bz], [bx, baseY + 1, bz], [bx, baseY + 2, bz],
        [bx, baseY + 3, bz], [bx - 1, baseY + 1, bz], [bx + 1, baseY + 1, bz],
      ] as const) {
        this.world.setBlock(x, y, z, BlockType.AIR);
        this.lan.sendBlock(x, y, z, BlockType.AIR);
      }
      this.mobs.spawnMobAt(bx + 0.5, baseY + 1, bz + 0.5, "iron_golem");
      playUiClick();
      return;
    }
  }

  // Check if a stone ring portal was formed at/around the given block
  // position. Accepts three sizes:
  //   - 4x4 frame (2x2 interior) — the original large portal
  //   - 4x3 frame (2x1 interior) — a "3x2" portal (3 wide, 2 tall)
  //   - 3x4 frame (1x2 interior) — a "2x3" portal (2 wide, 3 tall)
  // Scans both X-Y and Z-Y orientations. When a complete ring is found,
  // fills the interior with PORTAL blocks.
  private checkPortalFormation(bx: number, by: number, bz: number) {
    // Try each size. For each, scan offsets so the placed block could be
    // at any position within the frame.
    const sizes: Array<{ w: number; h: number }> = [
      { w: 4, h: 4 }, // 2x2 interior
      { w: 4, h: 3 }, // 2x1 interior (3x2 portal)
      { w: 3, h: 4 }, // 1x2 interior (2x3 portal)
    ];
    for (const { w, h } of sizes) {
      for (let dx = -(w - 1); dx <= 0; dx++) {
        for (let dy = -(h - 1); dy <= 0; dy++) {
          if (this.tryFormPortal(bx + dx, by + dy, bz, true, w, h)) return;
          if (this.tryFormPortal(bx, by + dy, bz + dx, false, w, h)) return;
        }
      }
    }
  }

  // Check if a w×h ring exists with its bottom-left corner at (ox, oy, oz).
  // If `xyPlane` is true, the ring extends in X and Y (fixed Z); otherwise
  // it extends in Z and Y (fixed X). Frame must be STONE or COBBLE; interior
  // must be AIR. If complete, fills the interior with PORTAL blocks.
  private tryFormPortal(ox: number, oy: number, oz: number, xyPlane: boolean, w: number, h: number): boolean {
    const isFrame = (id: number): boolean =>
      id === BlockType.STONE || id === BlockType.COBBLE;
    // Check the w×h perimeter: every block on the edge must be a frame
    // block; every interior block must be AIR (or already PORTAL).
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        const isEdge = (i === 0 || i === w - 1 || j === 0 || j === h - 1);
        const x = xyPlane ? ox + i : ox;
        const y = oy + j;
        const z = xyPlane ? oz : oz + i;
        const id = this.world.getBlock(x, y, z);
        if (isEdge) {
          if (!isFrame(id)) return false;
        } else {
          if (id !== BlockType.AIR && id !== BlockType.PORTAL) return false;
        }
      }
    }
    // Complete ring found — fill the interior with PORTAL blocks.
    for (let i = 1; i < w - 1; i++) {
      for (let j = 1; j < h - 1; j++) {
        const x = xyPlane ? ox + i : ox;
        const y = oy + j;
        const z = xyPlane ? oz : oz + i;
        this.world.setBlock(x, y, z, BlockType.PORTAL);
        this.lan.sendBlock(x, y, z, BlockType.PORTAL);
      }
    }
    playPortalForm(); // ancient-spooky portal activation sound
    return true;
  }

  // Sleep in a bed: skip the night by advancing time to sunrise (0.25 = noon
  // is too far; 0.0 = sunrise). Also clears nearby hostile mobs.
  private sleepInBed() {
    this.dayNight.setTime(BED_SKIP_TIME);
    this.callbacks.onTimeOfDay?.(this.dayNight.getTime());
    // Clear all hostile mobs (they despawn in daylight)
    this.mobs.despawnAggressive();
    // End any active event (sleeping breaks a red moon).
    this.events.forceEnd();
    playUiClick();
  }

  // Travel to the other dimension (overworld ↔ sky). Swaps the active
  // world, repositions the player to the spawn point of the new dimension,
  // and notifies the UI. The sky world is created lazily on first travel.
  travelToDimension() {
    const newDim: Dimension = this.currentDimension === "overworld" ? "sky" : "overworld";
    // Remove all current-world chunk meshes from the scene so they don't
    // render while we're in the other dimension. Mark them dirty so they
    // get rebuilt (re-added to the scene) when we return.
    for (const c of this.world.chunks.values()) {
      if (c.opaqueMesh) this.scene.remove(c.opaqueMesh);
      if (c.transparentMesh) this.scene.remove(c.transparentMesh);
      c.dirty = true;
    }
    // Also remove torch lights from the old world (they'll be re-added
    // when we return, via updateTorchLights scanning the new world).
    this.disposeAllTorchLights();
    // Create the sky world lazily if needed.
    if (newDim === "sky" && !this.skyWorld) {
      // Store the overworld reference before swapping so we can return.
      this.overworldRef = this.world;
      this.skyWorld = new World(this.scene, this.world.seed + 99999, "sky");
    }
    // Swap worlds.
    if (newDim === "sky") {
      if (!this.overworldRef) this.overworldRef = this.world;
      this.world = this.skyWorld!;
    } else {
      this.world = this.overworldRef!;
    }
    this.currentDimension = newDim;
    // Update the mob manager's world reference so mobs spawn/check
    // collision against the new dimension's terrain.
    this.mobs.world = this.world;
    // Clear all mobs from the old dimension so they don't float in the
    // new dimension's empty air (especially important when going to sky).
    this.mobs.dispose();
    // Reposition the player to the spawn point of the new dimension.
    if (newDim === "sky") {
      // Find a safe spawn on a sky island. Islands are sparse, so we
      // search outward in a spiral from (0,0) until we find a solid column.
      const skySpawn = this.findSkySpawn();
      this.player.position.copy(skySpawn);
      this.player.velocity.set(0, 0, 0);
    } else {
      this.player.position.set(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z);
      this.player.velocity.set(0, 0, 0);
    }
    // Pre-generate spawn area for the new world.
    this.world.update(this.player.position.x, this.player.position.z, this.renderDistance);
    if (newDim !== "sky") {
      // Use normal spawn (scans downward for first solid block).
      this.player.spawn(this.world);
    }
    if (newDim === "sky") {
      this.skySpawnPoint.copy(this.player.position);
    }
    // Set the portal cooldown so the player doesn't immediately teleport back.
    this.portalCooldown = 2; // 2 seconds
    this.callbacks.onDimensionChange?.(newDim);
    this.callbacks.onChat?.("", `Traveled to ${newDim === "sky" ? "Sky Dimension" : "Overworld"}`);
    playUiClick();
  }

  // Reference to the original overworld world, stored on first travel so
  // we can swap back to it.
  private overworldRef: World | null = null;

  // Swap to the overworld without repositioning the player. Used when the
  // player dies in the sky dimension — the respawn() call will then place
  // them at the overworld spawn point.
  private swapToOverworld() {
    if (this.currentDimension === "overworld") return;
    // Remove sky-world chunk meshes from the scene.
    for (const c of this.world.chunks.values()) {
      if (c.opaqueMesh) this.scene.remove(c.opaqueMesh);
      if (c.transparentMesh) this.scene.remove(c.transparentMesh);
      c.dirty = true;
    }
    this.disposeAllTorchLights();
    if (!this.overworldRef) this.overworldRef = this.world;
    this.world = this.overworldRef!;
    this.currentDimension = "overworld";
    this.mobs.world = this.world;
    this.mobs.dispose();
    this.callbacks.onDimensionChange?.("overworld");
  }

  // Find a safe spawn point on a sky island. Searches outward in a spiral
  // from (0,0) until a solid column is found, then scans downward for the
  // topmost solid block. Returns the spawn position (0.5 + blockX, y+1, 0.5 + blockZ).
  private findSkySpawn(): THREE.Vector3 {
    const maxRadius = 64;
    for (let r = 0; r <= maxRadius; r++) {
      // Check positions at radius r in a square spiral.
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // only check the ring
          // Pre-generate the chunk at this position so getBlock works.
          const cx = Math.floor(dx / 16);
          const cz = Math.floor(dz / 16);
          this.world.ensureChunk(cx, cz);
          // Scan downward from y=50 for the first solid block.
          for (let y = 50; y > 10; y--) {
            if (this.world.isSolidAt(dx, y, dz)) {
              return new THREE.Vector3(dx + 0.5, y + 1, dz + 0.5);
            }
          }
        }
      }
    }
    // Fallback: spawn at a fixed high point (player will fall, but at
    // least they're in the dimension).
    return new THREE.Vector3(0.5, 45, 0.5);
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
    // Doors are 2 tall — also remove the other half. Only one half drops
    // a door item (so the player doesn't get 2 doors from one placement).
    if (id === BlockType.DOOR) {
      const isTop = this.world.getBlock(x, y - 1, z) === BlockType.DOOR;
      if (isTop) {
        // Tapped the top — clear the bottom too, and remove its open state.
        this.world.setBlock(x, y - 1, z, BlockType.AIR);
        this.lan.sendBlock(x, y - 1, z, BlockType.AIR);
        this.world.openDoors.delete(`${x},${y - 1},${z}`);
      } else {
        // Tapped the bottom — clear the top too, and remove its open state.
        this.world.setBlock(x, y + 1, z, BlockType.AIR);
        this.lan.sendBlock(x, y + 1, z, BlockType.AIR);
        this.world.openDoors.delete(`${x},${y},${z}`);
      }
    }
    // Breaking a GRAVE block restores the items stored inside it (the
    // player's dropped inventory from a previous death). The grave block
    // itself is NOT added to the inventory — only its contents.
    if (id === BlockType.GRAVE) {
      const grave = loadGrave(x, y, z);
      if (grave) {
        for (const item of grave.items) {
          if (item.id !== BlockType.AIR && item.count > 0) {
            this.inventory.add(item.id, item.count);
          }
        }
        removeGrave(x, y, z);
      }
      this.callbacks.onInventoryChange?.(this.inventory.list());
      this.refreshHotbarIcons();
      playBreak(id);
      this.resetBreak();
      return;
    }
    // Coal ore drops coal; ruby ore drops ruby (any pickaxe works).
    // Everything else drops itself. In creative mode, no drops.
    if (!this.creative) {
      const dropId = id === BlockType.COAL_ORE ? BlockType.COAL
        : id === BlockType.RUBY_ORE ? BlockType.RUBY
        : id;
      this.inventory.add(dropId, 1);
    }
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
  // The bar is hidden (opacity:0) when progress is 0, and fades in as
  // soon as the player starts breaking a block.
  private updateBreakProgressDom(progress: number) {
    const container = this.container.querySelector('[data-break-progress]') as HTMLElement | null;
    if (container) {
      const fill = container.querySelector('[data-break-progress-fill]') as HTMLElement | null;
      if (fill) {
        fill.style.width = `${Math.min(100, progress * 100)}%`;
      }
      container.style.opacity = progress > 0 ? "1" : "0";
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

  // Auto-open doors the player walks into. Scans the 1-block column ahead
  // of the player (in the direction of movement) for a closed DOOR block
  // and opens it. This complements the tap-to-toggle interaction — the
  // player can also just walk through a door and it opens automatically.
  private autoOpenDoors() {
    if (!this.player.onGround) return;
    const moving = this.input.forward || this.input.back || this.input.left || this.input.right;
    if (!moving) return;
    // Direction vector from input (normalized in the XZ plane).
    let dx = 0, dz = 0;
    if (this.input.forward) dz -= 1;
    if (this.input.back) dz += 1;
    if (this.input.left) dx -= 1;
    if (this.input.right) dx += 1;
    const len = Math.hypot(dx, dz);
    if (len === 0) return;
    dx /= len; dz /= len;
    // Sample the block 1 unit ahead of the player at foot and head height.
    const px = Math.floor(this.player.position.x + dx * 0.8);
    const pz = Math.floor(this.player.position.z + dz * 0.8);
    const py = Math.floor(this.player.position.y);
    for (const y of [py, py + 1]) {
      if (this.world.getBlock(px, y, pz) === BlockType.DOOR && !this.world.isDoorOpen(px, y, pz)) {
        this.world.toggleDoor(px, y, pz);
        this.world.markDirtyAt(px, y, pz);
        playUiClick();
        return;
      }
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

  // Toggle a door between open and closed. Open doors are pass-through
  // (handled by World.isSolidAt); closed doors block movement.
  // The block id stays DOOR either way — only the World.openDoors Set
  // changes, and the chunk is marked dirty so the mesh rebuilds.
  private toggleDoor(x: number, y: number, z: number) {
    this.world.toggleDoor(x, y, z);
    // Mark the door's chunks dirty so they re-mesh (the texture/mesh
    // can reflect the open state in a future extension).
    this.world.markDirtyAt(x, y, z);
    this.world.markDirtyAt(x, y + 1, z);
    playUiClick();
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
    // Re-apply pixel ratio in case the window moved to a different-DPI display.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  // Procedural village generation: called from the main loop as the player
  // explores. Each VILLAGE_REGION_SIZE×VILLAGE_REGION_SIZE chunk region
  // gets one village attempt; a deterministic hash picks whether it
  // spawns (~25% chance). Once a region is evaluated, it's never tried
  // again — even if the village didn't spawn (so the world is stable
  // across reloads). Villages are placed at a viable build site near the
  // region's center, not at a fixed offset from spawn.
  private maybeSpawnProceduralVillage() {
    const pcx = Math.floor(this.player.position.x / 16);
    const pcz = Math.floor(this.player.position.z / 16);
    const rcx = Math.floor(pcx / VILLAGE_REGION_SIZE);
    const rcz = Math.floor(pcz / VILLAGE_REGION_SIZE);
    const key = `${rcx},${rcz}`;
    if (this.villageRegionsTried.has(key)) return;
    this.villageRegionsTried.add(key);
    // Only attempt villages in the overworld (not the sky dimension).
    if (this.currentDimension !== "overworld") return;
    // Deterministic hash: same region → same decision every reload.
    // Uses the world seed so different worlds have different village layouts.
    let h = (rcx * 374761393 + rcz * 668265263 + this.world.seed * 1442695040) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = (h ^ (h >>> 16)) >>> 0;
    const roll = h / 0xFFFFFFFF;
    if (roll > VILLAGE_CHANCE) return;
    // Spawn the village near the region's center chunk.
    const vcx = rcx * VILLAGE_REGION_SIZE * 16 + (VILLAGE_REGION_SIZE * 16) / 2;
    const vcz = rcz * VILLAGE_REGION_SIZE * 16 + (VILLAGE_REGION_SIZE * 16) / 2;
    this.generateVillage(vcx, vcz);
  }

  // Build a village centered near (vcx, vcz). Scans for a viable build
  // site (flat, dry, above sea level), then lays out a central plaza with
  // a well, 4-7 houses around it, lamp posts, a farm plot, a market
  // stall, and an iron golem guarding the plaza.
  private generateVillage(vcx: number, vcz: number) {
    // Probe the area: find a viable plaza center by scanning outward in a
    // spiral from (vcx, vcz). A site is viable if the 5x5 area around it
    // is above sea level, solid ground, and roughly flat (height variance
    // ≤ 2 blocks). This fixes houses spawning in water, on cliffs, or
    // floating in the air.
    const plaza = this.findViableSite(vcx, vcz, 12);
    if (!plaza) return; // no viable site — skip this village
    const { x: px, z: pz, y: py } = plaza;

    // Plaza floor: 5x5 of COBBLE with a stone rim. Removes any tall grass
    // or flowers that were on the surface so the plaza reads as paved.
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        this.world.setBlock(px + dx, py + 1, pz + dz, BlockType.COBBLE);
        // Clear anything above the floor (grass/flowers) up to headroom.
        for (let dy = 2; dy <= 4; dy++) {
          if (this.world.getBlock(px + dx, py + dy, pz + dz) !== BlockType.AIR) {
            this.world.setBlock(px + dx, py + dy, pz + dz, BlockType.AIR);
          }
        }
      }
    }

    // Central well: a 3x3 stone-rimmed hole with water in the middle.
    this.buildWell(px, py + 1, pz);

    // Houses: 4-7 around the plaza. Each is placed at a viable build
    // spot near the plaza (checked for flatness + dry ground). If no
    // viable spot is found, that house is skipped (better than spawning
    // in a lake). Each house gets a villager.
    const houseCount = 4 + Math.floor(Math.random() * 4); // 4..7
    const placedHouses: Array<{ x: number; z: number; y: number }> = [];
    for (let h = 0; h < houseCount; h++) {
      const angle = (h / houseCount) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 9 + Math.floor(Math.random() * 4); // 9..12 blocks from plaza
      const hx = Math.floor(px + Math.cos(angle) * dist);
      const hz = Math.floor(pz + Math.sin(angle) * dist);
      const site = this.findViableSite(hx, hz, 3);
      if (!site) continue; // skip if no flat dry ground
      // Don't overlap with another house.
      const tooClose = placedHouses.some((p) => Math.abs(p.x - site.x) < 6 && Math.abs(p.z - site.z) < 6);
      if (tooClose) continue;
      placedHouses.push(site);
      const variant = h % 3; // 3 house variants cycle
      this.buildVillageHouse(site.x, site.y, site.z, variant);
      this.mobs.spawnMobAt(site.x + 0.5, site.y + 1, site.z + 0.5, "villager");
      this.buildPath(site.x, site.z, px, pz);
    }

    // Lamp posts at the 4 plaza corners.
    this.buildLampPost(px + 3, py + 1, pz);
    this.buildLampPost(px - 3, py + 1, pz);
    this.buildLampPost(px, py + 1, pz + 3);
    this.buildLampPost(px, py + 1, pz - 3);

    // Farm plot: 5x5 tilled field with rows of HAY (wheat-equivalent) and
    // a water channel down the middle. Placed near the plaza.
    const farmX = px + 7;
    const farmZ = pz + 7;
    const farmSite = this.findViableSite(farmX, farmZ, 3);
    if (farmSite) this.buildFarm(farmSite.x, farmSite.y, farmSite.z);

    // Market stall: a small open-front structure with a wool canopy and
    // a crafting table counter. Placed opposite the farm.
    const marketX = px - 7;
    const marketZ = pz - 7;
    const marketSite = this.findViableSite(marketX, marketZ, 3);
    if (marketSite) this.buildMarketStall(marketSite.x, marketSite.y, marketSite.z);

    // Iron golem: spawn one in the plaza to protect the villagers.
    this.mobs.spawnMobAt(px + 0.5, py + 2, pz + 0.5, "iron_golem");
  }

  // Find a viable build site near (cx, cz): scans a `radius`-block area
  // for a 3x3 flat, dry, solid surface. Returns the center coords + the
  // ground Y, or null if no viable site is found.
  private findViableSite(cx: number, cz: number, radius: number): { x: number; y: number; z: number } | null {
    let best: { x: number; y: number; z: number } | null = null;
    let bestScore = Infinity; // lower = flatter
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const x = cx + dx;
        const z = cz + dz;
        const y = this.findGroundY(x, z);
        if (y < 0) continue;
        // Reject waterlogged or too-low ground (below sea level).
        if (y < 24) continue;
        // Sample a 3x3 footprint — measure height variance and water content.
        let minY = 64, maxY = 0;
        let ok = true;
        for (let sx = -1; sx <= 1 && ok; sx++) {
          for (let sz = -1; sz <= 1 && ok; sz++) {
            const sy = this.findGroundY(x + sx, z + sz);
            if (sy < 0 || sy < 24) { ok = false; break; }
            const surface = this.world.getBlock(x + sx, sy + 1, z + sz);
            // Reject if surface is water or the ground is too far below/above the center.
            if (surface === BlockType.WATER) { ok = false; break; }
            if (Math.abs(sy - y) > 2) { ok = false; break; }
            minY = Math.min(minY, sy);
            maxY = Math.max(maxY, sy);
          }
        }
        if (!ok) continue;
        const score = maxY - minY; // flatness (0 = perfectly flat)
        if (score < bestScore) {
          bestScore = score;
          best = { x, y, z };
        }
      }
    }
    return best;
  }

  // Find the highest solid block at (x, z) — the ground surface Y.
  private findGroundY(x: number, z: number): number {
    for (let y = 60; y > 1; y--) {
      if (this.world.isSolidAt(x, y, z)) return y;
    }
    return -1;
  }

  // Central well: 3x3 stone-rimmed hole with water in the middle.
  private buildWell(cx: number, baseY: number, cz: number) {
    // Rim: cobblestone around a 1x1 water source.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) {
          // Carve a 2-deep hole and fill with water.
          this.world.setBlock(cx, baseY, cz, BlockType.WATER);
          this.world.setBlock(cx, baseY - 1, cz, BlockType.WATER);
        } else {
          this.world.setBlock(cx + dx, baseY, cz + dz, BlockType.COBBLE);
        }
      }
    }
    // Four corner posts (cobblestone pillars, 2 blocks tall) for a
    // simple well-house look.
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      this.world.setBlock(cx + ox, baseY + 1, cz + oz, BlockType.COBBLE);
      this.world.setBlock(cx + ox, baseY + 2, cz + oz, BlockType.WOOD);
    }
    // Roof beams connecting the posts.
    this.world.setBlock(cx, baseY + 3, cz - 1, BlockType.PLANKS);
    this.world.setBlock(cx, baseY + 3, cz + 1, BlockType.PLANKS);
    this.world.setBlock(cx - 1, baseY + 3, cz, BlockType.PLANKS);
    this.world.setBlock(cx + 1, baseY + 3, cz, BlockType.PLANKS);
    this.world.setBlock(cx, baseY + 3, cz, BlockType.PLANKS);
  }

  // Farm plot: 5x5 with alternating HAY rows and a water channel.
  private buildFarm(cx: number, baseY: number, cz: number) {
    // Border: cobblestone fence-like (1-tall cobble) around the plot.
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (Math.abs(dx) === 3 || Math.abs(dz) === 3) {
          this.world.setBlock(cx + dx, baseY + 1, cz + dz, BlockType.COBBLE);
        }
      }
    }
    // Interior: tilled dirt (use DIRT) with rows of HAY (wheat) and a
    // central water channel for irrigation.
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0) {
          // Water channel down the middle.
          this.world.setBlock(cx + dx, baseY + 1, cz + dz, BlockType.WATER);
        } else {
          this.world.setBlock(cx + dx, baseY + 1, cz + dz, BlockType.DIRT);
          // Hay bale on top of every other row (ripe wheat).
          if ((Math.abs(dx) + dz) % 2 === 0) {
            this.world.setBlock(cx + dx, baseY + 2, cz + dz, BlockType.HAY);
          }
        }
      }
    }
    // A hay-bale stack near the corner (decoration, looks like harvest storage).
    this.world.setBlock(cx + 3, baseY + 1, cz + 3, BlockType.HAY);
    this.world.setBlock(cx + 3, baseY + 2, cz + 3, BlockType.HAY);
    this.world.setBlock(cx + 3, baseY + 3, cz + 3, BlockType.HAY);
  }

  // Market stall: open-front shop with a wool canopy and a counter.
  private buildMarketStall(cx: number, baseY: number, cz: number) {
    // 4 corner posts (wood), 3 blocks tall — open sides, no walls.
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      for (let dy = 0; dy < 3; dy++) {
        this.world.setBlock(cx + ox, baseY + 1 + dy, cz + oz, BlockType.WOOD);
      }
    }
    // Wool canopy on top — a 3x3 sheet.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.world.setBlock(cx + dx, baseY + 4, cz + dz, BlockType.WOOL);
      }
    }
    // Counter: a crafting table at the front for the "shopkeeper".
    this.world.setBlock(cx, baseY + 1, cz + 1, BlockType.CRAFTING_TABLE);
    // Behind the counter: a chest-equivalent (wool block) with a torch.
    this.world.setBlock(cx, baseY + 1, cz - 1, BlockType.WOOL);
    this.world.setBlock(cx, baseY + 2, cz - 1, BlockType.TORCH);
    this.addTorchLight(cx, baseY + 2, cz - 1);
  }

  // Build a cobblestone path from (x1,z1) to (x2,z2). Replaces the
  // surface block itself with COBBLE (at floor level), so paths are
  // flush with the ground instead of floating one block above.
  private buildPath(x1: number, z1: number, x2: number, z2: number) {
    const dx = Math.abs(x2 - x1);
    const dz = Math.abs(z2 - z1);
    const sx = x1 < x2 ? 1 : -1;
    const sz = z1 < z2 ? 1 : -1;
    let x = x1, z = z1;
    let err = dx - dz;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const y = this.findGroundY(x, z);
      // Replace the surface block with COBBLE so the path is at floor level.
      if (y > 0) this.world.setBlock(x, y, z, BlockType.COBBLE);
      if (x === x2 && z === z2) break;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; x += sx; }
      if (e2 < dx) { err += dx; z += sz; }
    }
  }

  // Lamp post: a cobblestone column with a torch on top.
  private buildLampPost(cx: number, baseY: number, cz: number) {
    this.world.setBlock(cx, baseY, cz, BlockType.COBBLE);
    this.world.setBlock(cx, baseY + 1, cz, BlockType.COBBLE);
    this.world.setBlock(cx, baseY + 2, cz, BlockType.COBBLE);
    this.world.setBlock(cx, baseY + 3, cz, BlockType.TORCH);
    this.addTorchLight(cx, baseY + 3, cz);
  }

  // Build a village house at (cx, baseY, cz) — `baseY` is the ground Y
  // (the floor of the house is at baseY+1). Three variants cycle through
  // different wall/roof materials and interior furnishings so villages
  // look varied rather than copy-pasted.
  private buildVillageHouse(cx: number, baseY: number, cz: number, variant: number) {
    const half = 2; // 5x5 footprint
    const floorY = baseY + 1;
    // Wall + roof material per variant.
    const wall = variant === 0 ? BlockType.COBBLE : variant === 1 ? BlockType.PLANKS : BlockType.BRICK;
    const roof = variant === 0 ? BlockType.PLANKS : variant === 1 ? BlockType.WOOD : BlockType.STONE;

    // Walls — 4 blocks tall, with a door on the +Z side (centered).
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        const isEdge = dx === -half || dx === half || dz === -half || dz === half;
        if (isEdge) {
          for (let dy = 0; dy < 4; dy++) {
            // Place a 2-tall DOOR block on the +Z side, centered.
            // dy=0 is the bottom half, dy=1 is the top half. Villagers
            // and the player can tap the door to open/close it.
            if (dx === 0 && dz === half && dy < 2) {
              this.world.setBlock(cx + dx, floorY + dy, cz + dz, BlockType.DOOR);
            } else {
              this.world.setBlock(cx + dx, floorY + dy, cz + dz, wall);
            }
          }
        }
      }
    }

    // Floor: replace the dirt/grass under the house with PLANKS so the
    // interior reads as a wooden floor.
    for (let dx = -half + 1; dx <= half - 1; dx++) {
      for (let dz = -half + 1; dz <= half - 1; dz++) {
        this.world.setBlock(cx + dx, floorY - 1, cz + dz, BlockType.PLANKS);
      }
    }

    // Roof: gabled (sloped). Two layers — a 5x5 flat layer, then a 3x3
    // ridge on top, then a single cap block. Gives a peaked-roof look.
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        this.world.setBlock(cx + dx, floorY + 4, cz + dz, roof);
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.world.setBlock(cx + dx, floorY + 5, cz + dz, roof);
      }
    }
    this.world.setBlock(cx, floorY + 6, cz, roof);

    // Clear the interior (air for walk-in space, 3 blocks tall).
    for (let dx = -half + 1; dx <= half - 1; dx++) {
      for (let dz = -half + 1; dz <= half - 1; dz++) {
        for (let dy = 0; dy < 3; dy++) {
          this.world.setBlock(cx + dx, floorY + dy, cz + dz, BlockType.AIR);
        }
      }
    }

    // Furnishings — vary by variant.
    // Bed (against back wall, -Z side).
    this.world.setBlock(cx - 1, floorY, cz - half + 1, BlockType.BED);
    // Crafting table (opposite corner).
    this.world.setBlock(cx + 1, floorY, cz - half + 1, BlockType.CRAFTING_TABLE);
    // Variant-specific extra furnishing.
    if (variant === 0) {
      // Variant 0: a furnace-equivalent (cobblestone block) with a torch above.
      this.world.setBlock(cx - half + 1, floorY, cz + half - 1, BlockType.COBBLE);
      this.world.setBlock(cx - half + 1, floorY + 1, cz + half - 1, BlockType.TORCH);
      this.addTorchLight(cx - half + 1, floorY + 1, cz + half - 1);
    } else if (variant === 1) {
      // Variant 1: a hay-bale storage seat by the door.
      this.world.setBlock(cx, floorY, cz + half - 1, BlockType.HAY);
    } else {
      // Variant 2: a flower pot (flower on top of a brick block) by the window.
      this.world.setBlock(cx + half - 1, floorY, cz + half - 1, BlockType.BRICK);
      this.world.setBlock(cx + half - 1, floorY + 1, cz + half - 1, BlockType.FLOWER);
    }
    // Wall torch for lighting (all variants).
    this.world.setBlock(cx - half, floorY + 3, cz, BlockType.TORCH);
    this.addTorchLight(cx - half, floorY + 3, cz);
    // Window: a glass block on the -X wall, at head height.
    this.world.setBlock(cx - half, floorY + 1, cz - 1, BlockType.GLASS);
  }

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    // FPS limiter: skip this frame if not enough time has elapsed since
    // the last rendered frame. We still keep requesting animation frames
    // so we wake up promptly when the interval expires.
    if (now - this.lastFrameTime < this.frameInterval) return;
    this.lastFrameTime = now;
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.active && !this.life.dead) {
      // Hunger-driven slow effect: when food < 6, player walks at 60%.
      this.player.speedMultiplier = this.food.shouldSlow ? 0.6 : 1;
      // Detect submerged state: is the player's eye inside a water block?
      // The eye is at position.y + 1.62 — sample that voxel.
      const eyeBlock = this.world.getBlock(
        Math.floor(this.player.position.x),
        Math.floor(this.player.position.y + 1.62),
        Math.floor(this.player.position.z),
      );
      const submerged = eyeBlock === BlockType.WATER;
      this.player.submerged = submerged;
      // Breath: tick down while submerged, refill while above water.
      if (submerged && !this.creative) {
        this.breath = Math.max(0, this.breath - dt);
        if (this.breath <= 0) {
          // Drowning: take damage every second once out of breath.
          this.drownAccum = (this.drownAccum ?? 0) + dt;
          if (this.drownAccum >= 1) {
            this.life.takeDamage(DROWN_DAMAGE);
            this.drownAccum = 0;
          }
        }
      } else {
        // Refill breath twice as fast as it drains.
        this.breath = Math.min(MAX_BREATH, this.breath + dt * 2);
        this.drownAccum = 0;
      }
      // Notify UI when submerged state changes (or breath ticks down).
      if (submerged !== this.wasSubmerged || submerged) {
        this.callbacks.onSubmergedChange?.(submerged, this.breath, MAX_BREATH);
      }
      this.wasSubmerged = submerged;
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
      // Tick portal cooldown.
      if (this.portalCooldown > 0) this.portalCooldown -= dt;
      // Portal entry: if the player's body is inside a PORTAL (or PORTAL_SKY)
      // block and the cooldown is 0, travel to the other dimension.
      if (this.portalCooldown <= 0) {
        const px = Math.floor(this.player.position.x);
        const py = Math.floor(this.player.position.y);
        const pz = Math.floor(this.player.position.z);
        const blockHere = this.world.getBlock(px, py, pz);
        if (blockHere === BlockType.PORTAL || blockHere === BlockType.PORTAL_SKY) {
          this.travelToDimension();
        }
      }
      this.updateBreak(dt);
      // Void death: if the player falls below the world (especially when
      // falling off a sky-dimension island), kill them instantly. The
      // death handler will return them to the overworld if in sky dimension.
      if (this.player.position.y < -10 && !this.creative && !this.life.dead) {
        this.life.takeDamage(MAX_HEALTH); // instant death
      }
      this.updateWalking(dt);
      this.autoOpenDoors();
      // Fall damage is skipped in creative mode AND while submerged
      // (water breaks your fall). When submerged, force onGround so the
      // LifeSystem doesn't accumulate a fall-distance that would all
      // apply the moment the player touches the bottom of a lake.
      if (!this.creative) {
        if (submerged) {
          // Cancel any pending fall-damage tracking.
          this.life.update(this.player.position.y, true);
        } else {
          this.life.update(this.player.position.y, this.player.onGround);
        }
      }
      // Hunger tick: applies regen / starvation effects.
      const moving = this.input.forward || this.input.back || this.input.left || this.input.right;
      const ev = this.food.update(dt, !this.life.dead, moving, this.input.sprint && moving && !submerged);
      if (ev.regen && !this.creative) {
        this.life.health = Math.min(MAX_HEALTH, this.life.health + ev.regen);
        this.callbacks.onHealthChange?.(this.life.health);
      }
      if (ev.starve && !this.creative) {
        // Hunger damages the player but NEVER kills them — stop at 1 HP.
        if (this.life.health > 1) {
          const dmg = Math.min(ev.starve, this.life.health - 1);
          this.life.takeDamage(dmg);
        }
      }
      // In creative mode, always regen hunger + health to full — the
      // player never starves and is always at max health.
      if (this.creative) {
        if (this.food.food < MAX_FOOD) {
          this.food.food = MAX_FOOD;
          this.callbacks.onFoodChange?.(this.food.food);
        }
        if (this.life.health < MAX_HEALTH) {
          this.life.health = MAX_HEALTH;
          this.callbacks.onHealthChange?.(this.life.health);
        }
      }
    } else {
      // Reset the slow multiplier when paused so sprinting on resume feels right.
      this.player.speedMultiplier = 1;
    }
    // LAN: send local player position
    this.lan.update(dt, this.player.position.x, this.player.position.y, this.player.position.z, this.player.yaw, this.player.pitch);
    this.world.update(this.player.position.x, this.player.position.z, this.renderDistance);
    this.world.processDirtyBudget(8); // increased budget for faster chunk loading
    // Procedural village spawn check — runs once per region the player enters.
    this.maybeSpawnProceduralVillage();
    this.dayNight.update(dt);
    // Dark caves: if the player is underground (a solid block exists
    // anywhere above them within 30 blocks), reduce ambient + hemi
    // intensity further so caves are actually dark. Torches become
    // essential for visibility. The check is cheap (one column scan,
    // early-exit on first solid block).
    const px = Math.floor(this.player.position.x);
    const pz = Math.floor(this.player.position.z);
    const py = Math.floor(this.player.position.y);
    let underground = false;
    for (let y = py + 2; y < py + 30 && y < 64; y++) {
      if (this.world.isSolidAt(px, y, pz)) { underground = true; break; }
    }
    if (underground) {
      this.ambient.intensity = Math.min(this.ambient.intensity, 0.06);
      this.hemi.intensity = Math.min(this.hemi.intensity, 0.08);
    }
    // Offhand torch dynamic light: if the offhand slot has a torch,
    // attach a PointLight to the player so they get walking illumination.
    // Remove the light when the torch is gone.
    if (this.inventory.getOffhand() === BlockType.TORCH) {
      if (!this.offhandTorchLight) {
        this.offhandTorchLight = new THREE.PointLight(0xffaa44, 2.5, 14, 1.2);
        this.scene.add(this.offhandTorchLight);
      }
      this.offhandTorchLight.position.set(
        this.player.position.x,
        this.player.position.y + 1.5,
        this.player.position.z,
      );
    } else if (this.offhandTorchLight) {
      this.scene.remove(this.offhandTorchLight);
      this.offhandTorchLight = null;
    }
    // Position the visual sun sphere at the directional light's location
    // (scaled out so it appears far away in the sky).
    this.sunMesh.position.copy(this.sun.position).multiplyScalar(3);
    // Move clouds to follow the player horizontally (so they're always
    // visible in the sky, not just near origin).
    this.cloudGroup.position.x = Math.floor(this.player.position.x / 50) * 50;
    this.cloudGroup.position.z = Math.floor(this.player.position.z / 50) * 50;

    const dayFactor = this.dayNight.getDayFactor();
    this.mobs.update(dt, this.player.position, dayFactor, this.currentDimension);
    // Event manager tick — handles red moon and other periodic events.
    this.events.update(dt, this.dayNight, dayFactor);
    // Fire onEventChange only when the active state transitions.
    const eventActive = this.events.isActive();
    if (eventActive !== this.wasEventActive) {
      this.wasEventActive = eventActive;
      this.callbacks.onEventChange?.(eventActive);
    }

    this.torchUpdateTimer += dt;
    if (this.torchUpdateTimer > 0.5) {
      this.updateTorchLights();
      this.torchUpdateTimer = 0;
    }

    // Portal ambient sound — if the player is within 4 blocks of a portal,
    // play a spooky whisper every ~4 seconds.
    this.portalAmbientTimer += dt;
    if (this.portalAmbientTimer > 4) {
      this.portalAmbientTimer = 0;
      const p = this.player.position;
      let nearPortal = false;
      for (let dy = -2; dy <= 2 && !nearPortal; dy++) {
        for (let dx = -4; dx <= 4 && !nearPortal; dx++) {
          for (let dz = -4; dz <= 4 && !nearPortal; dz++) {
            const id = this.world.getBlock(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz);
            if (id === BlockType.PORTAL || id === BlockType.PORTAL_SKY) nearPortal = true;
          }
        }
      }
      if (nearPortal) playPortalAmbient();
    }

    // Ultra-rare spooky glitch sound — at night or while deep underground.
    // Fires roughly once every 60-120s when conditions are met.
    this.spookyGlitchTimer -= dt;
    if (this.spookyGlitchTimer <= 0) {
      this.spookyGlitchTimer = 60 + Math.random() * 60; // next check in 60-120s
      const isNight = this.dayNight.getDayFactor() < 0.3;
      const isDeep = this.player.position.y < 20; // underground
      if (isNight || isDeep) playSpookyGlitch();
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
