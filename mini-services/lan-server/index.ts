// Minimal LAN multiplayer server for Minecraft.js
// Uses Socket.IO to sync player positions, block edits, chat messages,
// and damage events between players connected to the same server.
//
// Messages:
//   client → server: "join" { name }, "move" { x,y,z,yaw,pitch }, "block" { x,y,z,id },
//                    "chat" { message }, "damage" { target, amount }, "health" { health }
//   server → client: "players" [...], "player-joined" {...}, "player-moved" {...},
//                    "player-left" { id }, "block" {...}, "chat" { id, name, message },
//                    "damage" { from, fromName, amount }

import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
}

const players = new Map<string, PlayerState>();

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("join", (data: { name: string }) => {
    const player: PlayerState = {
      id: socket.id,
      name: data.name || "Player",
      x: 0.5,
      y: 30,
      z: 0.5,
      yaw: 0,
      pitch: 0,
      health: 20,
    };
    players.set(socket.id, player);
    // Send the current player list to the new player
    socket.emit("players", Array.from(players.values()));
    // Notify everyone else of the new player
    socket.broadcast.emit("player-joined", player);
    console.log(`${player.name} joined. ${players.size} players online.`);
  });

  socket.on("move", (data: { x: number; y: number; z: number; yaw: number; pitch: number; health?: number }) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.x = data.x;
    p.y = data.y;
    p.z = data.z;
    p.yaw = data.yaw;
    p.pitch = data.pitch;
    if (typeof data.health === "number") p.health = data.health;
    // Broadcast to everyone else (no need to echo back to sender)
    socket.broadcast.emit("player-moved", p);
  });

  socket.on("health", (data: { health: number }) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.health = data.health;
    // Don't need to broadcast every health tick; the move handler
    // already includes the latest health in player-moved payloads.
  });

  socket.on("block", (data: { x: number; y: number; z: number; id: number }) => {
    // Broadcast block edits to everyone else
    socket.broadcast.emit("block", data);
  });

  // Chat: broadcast to everyone (including the sender's name). The
  // sender's own client skips the echo since it already displays the
  // message locally.
  socket.on("chat", (data: { message: string }) => {
    const p = players.get(socket.id);
    if (!p) return;
    const payload = { id: socket.id, name: p.name, message: String(data.message || "").slice(0, 200) };
    socket.broadcast.emit("chat", payload);
    // Echo back to sender too (other tabs/devices on same id won't get it,
    // but the client ignores its own id anyway).
    socket.emit("chat", payload);
  });

  // Damage: a player is attacking another player. Forward the damage
  // event to the target so it can apply damage to its own life system.
  socket.on("damage", (data: { target: string; amount: number }) => {
    const attacker = players.get(socket.id);
    if (!attacker) return;
    const target = players.get(data.target);
    if (!target) return;
    io.to(data.target).emit("damage", {
      from: socket.id,
      fromName: attacker.name,
      amount: Math.max(0, Math.min(20, Math.floor(data.amount))),
    });
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    if (p) {
      players.delete(socket.id);
      socket.broadcast.emit("player-left", { id: socket.id });
      console.log(`${p.name} left. ${players.size} players online.`);
    }
  });

  socket.on("error", (error: unknown) => {
    console.error(`Socket error (${socket.id}):`, error);
  });
});

const PORT = 3003;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`MCJS LAN server running on port ${PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
