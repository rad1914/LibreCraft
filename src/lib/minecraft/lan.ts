// LAN multiplayer client. Connects to the Socket.IO server and syncs
// player positions, block edits, chat messages, and damage events.
// Other players are rendered as colored cubes in the world.

import { io, type Socket } from "socket.io-client";
import * as THREE from "three";

export interface RemotePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  mesh: THREE.Group;
}

// Ray-vs-entity hit test used for attacking mobs and remote players.
// `yLift` raises the sampled center above the entity's feet (player eyes).
function rayHitsEntity<E extends { x: number; y: number; z: number }>(
  entities: Iterable<E>,
  rayOrigin: THREE.Vector3,
  rayDir: THREE.Vector3,
  maxDist: number,
  yLift: number,
  threshold = 0.92,
): E | null {
  let closest: E | null = null;
  let closestDist = maxDist;
  for (const e of entities) {
    const dx = e.x - rayOrigin.x;
    const dy = (e.y + yLift) - rayOrigin.y;
    const dz = e.z - rayOrigin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > closestDist) continue;
    const dot = (dx * rayDir.x + dy * rayDir.y + dz * rayDir.z) / (dist || 1);
    if (dot > threshold) {
      closest = e;
      closestDist = dist;
    }
  }
  return closest;
}

export interface LanClientCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onPlayersChange?: (players: RemotePlayer[]) => void;
  onRemoteBlock?: (x: number, y: number, z: number, id: number) => void;
  onChat?: (sender: string, message: string) => void;
  onDamageReceived?: (amount: number, fromId: string, fromName: string) => void;
}

const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c];
const REMOTE_PLAYER_MAX_HEALTH = 20;

export class LanClient {
  private socket: Socket | null = null;
  private scene: THREE.Scene;
  private callbacks: LanClientCallbacks;
  private players = new Map<string, RemotePlayer>();
  private myId: string | null = null;
  private myName = "Player";
  private connected = false;
  private moveTimer = 0;

  constructor(scene: THREE.Scene, callbacks: LanClientCallbacks = {}) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  // Host: connect via the Caddy gateway on port 81 with XTransformPort=3003.
  connect(name: string, port: number = 3003): boolean {
    return this.connectUrl(
      `http://${window.location.hostname}:81/?XTransformPort=${port}`,
      name
    );
  }

  // Join: connect directly to a host address (e.g. "192.168.1.5:3003").
  joinHost(name: string, hostAddress: string): boolean {
    return this.connectUrl(`http://${hostAddress}`, name);
  }

  private connectUrl(url: string, name: string): boolean {
    if (this.socket) this.disconnect();
    this.myName = name || "Player";
    try {
      this.socket = io(url, {
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: 5,
        timeout: 5000,
      });
    } catch {
      this.callbacks.onDisconnected?.();
      return false;
    }

    this.socket.on("connect", () => {
      this.connected = true;
      this.myId = this.socket!.id;
      this.socket!.emit("join", { name: this.myName });
      this.callbacks.onConnected?.();
    });

    this.socket.on("disconnect", () => {
      this.connected = false;
      this.callbacks.onDisconnected?.();
    });

    this.socket.on("connect_error", () => {
      this.connected = false;
      this.callbacks.onDisconnected?.();
    });

    // Receive full player list (on join)
    this.socket.on("players", (list: Array<Omit<RemotePlayer, "mesh" | "health"> & { health?: number }>) => {
      for (const p of list) {
        if (p.id !== this.myId) {
          this.addPlayer(p, p.health);
        }
      }
      this.notifyPlayers();
    });

    // New player joined
    this.socket.on("player-joined", (p: Omit<RemotePlayer, "mesh" | "health"> & { health?: number }) => {
      if (p.id !== this.myId) {
        this.addPlayer(p, p.health);
        this.notifyPlayers();
      }
    });

    // Player moved
    this.socket.on("player-moved", (p: Omit<RemotePlayer, "mesh"> & { health?: number }) => {
      if (p.id === this.myId) return;
      const existing = this.players.get(p.id);
      if (existing) {
        existing.x = p.x;
        existing.y = p.y;
        existing.z = p.z;
        existing.yaw = p.yaw;
        existing.pitch = p.pitch;
        existing.mesh.position.set(p.x, p.y, p.z);
        existing.mesh.rotation.y = p.yaw;
        if (typeof p.health === "number") existing.health = p.health;
      }
    });

    // Player left
    this.socket.on("player-left", (data: { id: string }) => {
      const p = this.players.get(data.id);
      if (p) {
        this.scene.remove(p.mesh);
        disposeGroup(p.mesh);
        this.players.delete(data.id);
        this.notifyPlayers();
      }
    });

    // Remote block edit
    this.socket.on("block", (data: { x: number; y: number; z: number; id: number }) => {
      this.callbacks.onRemoteBlock?.(data.x, data.y, data.z, data.id);
    });

    // Chat: broadcast to everyone
    this.socket.on("chat", (data: { id: string; name: string; message: string }) => {
      if (data.id === this.myId) return; // don't echo our own messages
      this.callbacks.onChat?.(data.name, data.message);
    });

    // Damage: another player attacked us. Apply it to our own life system.
    this.socket.on("damage", (data: { from: string; fromName: string; amount: number }) => {
      this.callbacks.onDamageReceived?.(data.amount, data.from, data.fromName);
    });

    return true;
  }

  private addPlayer(p: Omit<RemotePlayer, "mesh" | "health">, health?: number) {
    if (this.players.has(p.id)) return;
    const color = PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
    const mesh = buildPlayerModel(color, p.name || "Player");
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = p.yaw;
    this.scene.add(mesh);
    this.players.set(p.id, {
      ...p,
      health: typeof health === "number" ? health : REMOTE_PLAYER_MAX_HEALTH,
      mesh,
    });
  }

  private notifyPlayers() {
    this.callbacks.onPlayersChange?.(Array.from(this.players.values()));
  }

  // Send local player position to the server (throttled).
  update(dt: number, x: number, y: number, z: number, yaw: number, pitch: number) {
    if (!this.socket || !this.connected) return;
    this.moveTimer += dt;
    if (this.moveTimer >= 0.1) {
      this.socket.emit("move", { x, y, z, yaw, pitch });
      this.moveTimer = 0;
    }
  }

  // Send a block edit to the server.
  sendBlock(x: number, y: number, z: number, id: number) {
    if (!this.socket || !this.connected) return;
    this.socket.emit("block", { x, y, z, id });
  }

  // Send a chat message to the server (broadcasts to everyone).
  sendChat(message: string) {
    if (!this.socket || !this.connected) return;
    this.socket.emit("chat", { message });
  }

  // Send a damage event to the server. The server will broadcast it to
  // the target player, who applies damage to its own life system.
  sendDamage(targetId: string, amount: number) {
    if (!this.socket || !this.connected) return;
    this.socket.emit("damage", { target: targetId, amount });
  }

  // Raycast hit test against remote players: returns the closest remote
  // player the ray points at, within maxDist. Used for attacking players.
  getPlayerAt(rayOrigin: THREE.Vector3, rayDir: THREE.Vector3, maxDist: number): RemotePlayer | null {
    return rayHitsEntity(this.players.values(), rayOrigin, rayDir, maxDist, 0.8);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    for (const p of this.players.values()) {
      this.scene.remove(p.mesh);
      disposeGroup(p.mesh);
    }
    this.players.clear();
  }
}

// Dispose all meshes in a Group.
function disposeGroup(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
    }
  });
}

// Build a multi-part player model (Steve-like figure with head, body, arms, legs).
function buildPlayerModel(color: number, _name: string): THREE.Group {
  const group = new THREE.Group();
  const main = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf0c090, emissive: 0x332211, emissiveIntensity: 0.15 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3a3a, emissive: 0x111111, emissiveIntensity: 0.15 });

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), skin);
  head.position.set(0, 1.45, 0);
  group.add(head);

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.25), main);
  body.position.set(0, 0.95, 0);
  group.add(body);

  // Arms
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.12), main);
  armL.position.set(-0.27, 0.97, 0);
  group.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.12), main);
  armR.position.set(0.27, 0.97, 0);
  group.add(armR);

  // Legs
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.65, 0.15), dark);
  legL.position.set(-0.1, 0.32, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.65, 0.15), dark);
  legR.position.set(0.1, 0.32, 0);
  group.add(legR);

  return group;
}
