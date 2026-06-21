"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Engine } from "@/lib/minecraft/engine";
import { BLOCKS, BlockType } from "@/lib/minecraft/blocks";
import { BASIC_RECIPES, RECIPES, type Recipe } from "@/lib/minecraft/crafting";
import type { InvSlot } from "@/lib/minecraft/inventory";
import { getBlockIconDataURL } from "@/lib/minecraft/textures";

interface HudState {
  fps: number;
  x: number;
  y: number;
  z: number;
  locked: boolean;
  selected: number;
  timeOfDay: number;
  saveStatus: "saved" | "loaded" | "cleared" | "none";
  health: number;
  maxHealth: number;
  dead: boolean;
  selectedBlockId: number;
  breakProgress: number;
  lanStatus: "connected" | "disconnected" | "connecting";
  lanPlayers: number;
  food: number;
  maxFood: number;
  creative: boolean;
}

const INITIAL: HudState = {
  fps: 0, x: 0, y: 0, z: 0, locked: false, selected: 0, timeOfDay: 0.25,
  saveStatus: "none", health: 20, maxHealth: 20, dead: false, selectedBlockId: BlockType.AIR,
  breakProgress: 0, lanStatus: "disconnected", lanPlayers: 0,
  food: 20, maxFood: 20, creative: false,
};

interface ChatMessage {
  id: number;
  sender: string;
  text: string;
  expiresAt: number;
}

const HOTBAR_SIZE = 9;

const iconCache = new Map<string, string>();
function blockIcon(id: number, face: "top" | "side" | "bottom" = "side"): string {
  if (id === BlockType.AIR) return "";
  const key = `${id}-${face}`;
  let url = iconCache.get(key);
  if (!url) {
    url = getBlockIconDataURL(id, face);
    iconCache.set(key, url);
  }
  return url;
}

function formatTime(t: number): string {
  const m = Math.floor(t * 24 * 60);
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

function HealthBar({ health, max }: { health: number; max: number }) {
  const hearts = Math.ceil(max / 2);
  const fullHearts = Math.floor(health / 2);
  const halfHeart = health % 2 === 1;
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: hearts }).map((_, i) => {
        let cls = "text-zinc-700";
        if (i < fullHearts) cls = "text-red-500";
        else if (i === fullHearts && halfHeart) cls = "text-red-500 opacity-60";
        return (
          <span key={i} className={`text-lg leading-none ${cls}`} style={{ textShadow: "0 0 2px black" }}>
            ♥
          </span>
        );
      })}
    </div>
  );
}

function FoodBar({ food, max }: { food: number; max: number }) {
  const icons = Math.ceil(max / 2);
  const full = Math.floor(food / 2);
  const half = food % 2 === 1;
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: icons }).map((_, i) => {
        let cls = "text-zinc-700";
        if (i < full) cls = "text-amber-500";
        else if (i === full && half) cls = "text-amber-500 opacity-60";
        return (
          <span key={i} className={`text-lg leading-none ${cls}`} style={{ textShadow: "0 0 2px black" }}>
            {/* drumstick-ish glyph */}
            ◉
          </span>
        );
      })}
    </div>
  );
}

export default function MinecraftGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL);
  const [slots, setSlots] = useState<InvSlot[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [craftTableOpen, setCraftTableOpen] = useState(false);
  const [showLanPanel, setShowLanPanel] = useState(false);
  const [playerName, setPlayerName] = useState("Player");
  const [hostAddress, setHostAddress] = useState("");
  const [displayedHostAddr, setDisplayedHostAddr] = useState("");
  const [pickedUpSlot, setPickedUpSlot] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatIdRef = useRef(0);

  const pushChat = useCallback((sender: string, text: string) => {
    if (!text) return;
    chatIdRef.current += 1;
    const id = chatIdRef.current;
    const msg: ChatMessage = { id, sender, text, expiresAt: Date.now() + 5000 };
    setChatMessages((prev) => [...prev.slice(-30), msg]);
  }, []);

  // Periodically prune expired chat messages so they fade out.
  useEffect(() => {
    if (chatMessages.length === 0) return;
    const t = window.setInterval(() => {
      const now = Date.now();
      setChatMessages((prev) => {
        const alive = prev.filter((m) => m.expiresAt > now);
        return alive.length !== prev.length ? alive : prev;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [chatMessages.length]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const engine = new Engine(canvasRef.current, containerRef.current, {
      onFps: (fps) => setHud((h) => ({ ...h, fps })),
      onPosition: (x, y, z) => setHud((h) => ({ ...h, x, y, z })),
      onLockChange: (locked) => setHud((h) => ({ ...h, locked })),
      onSlotChange: (selected) => setHud((h) => ({ ...h, selected })),
      onInventoryChange: (s) => setSlots(s),
      onCraftToggle: () => setMenuOpen((v) => !v),
      onCraftTableToggle: () => setCraftTableOpen((v) => !v),
      onTimeOfDay: (timeOfDay) => setHud((h) => ({ ...h, timeOfDay })),
      onSaveStatus: (saveStatus) => setHud((h) => ({ ...h, saveStatus })),
      onHealthChange: (health) => setHud((h) => ({ ...h, health })),
      onDeath: () => setHud((h) => ({ ...h, dead: true })),
      onRespawn: () => setHud((h) => ({ ...h, dead: false })),
      onSelectedBlockChange: (selectedBlockId) => setHud((h) => ({ ...h, selectedBlockId })),
      onBreakProgress: (breakProgress) => setHud((h) => ({ ...h, breakProgress })),
      onLanStatus: (status, playerCount) => setHud((h) => ({ ...h, lanStatus: status, lanPlayers: playerCount })),
      onFoodChange: (food) => setHud((h) => ({ ...h, food })),
      onCreativeChange: (creative) => setHud((h) => ({ ...h, creative })),
      onCommandResult: (result) => {
        pushChat("", result.message);
      },
      onChat: (sender, message) => {
        pushChat(sender, message);
      },
      onChatToggle: () => setChatOpen((v) => !v),
    });
    engineRef.current = engine;
    engine.start();
    setSlots(engine.getInventorySlots());
    setHud((h) => ({
      ...h,
      health: engine.getHealth(),
      maxHealth: engine.getMaxHealth(),
      food: engine.getFood(),
      maxFood: engine.getMaxFood(),
      creative: engine.isCreative(),
    }));

    const ctxHandler = (e: Event) => e.preventDefault();
    window.addEventListener("contextmenu", ctxHandler);
    return () => {
      window.removeEventListener("contextmenu", ctxHandler);
      engine.dispose();
      engineRef.current = null;
    };
  }, [pushChat]);

  const handlePlay = useCallback(() => engineRef.current?.requestLock(), []);
  const handleCraft = useCallback((r: Recipe) => { engineRef.current?.craftRecipe(r); }, []);
  const handleCloseMenu = useCallback(() => { setMenuOpen(false); setPickedUpSlot(null); }, []);
  const handleCloseCraftTable = useCallback(() => { setCraftTableOpen(false); setPickedUpSlot(null); }, []);
  const handleSelectSlot = useCallback((i: number) => {
    engineRef.current?.selectSlot(i);
    setHud((h) => ({ ...h, selected: i }));
  }, []);
  // Click a slot in the inventory UI: if nothing is picked up, pick up
  // this slot's item. If something is picked up, move/swap it to this slot.
  const handleSlotClick = useCallback((slotIndex: number) => {
    if (pickedUpSlot === null) {
      // Pick up (only if the slot has an item)
      if (slots[slotIndex] && slots[slotIndex].id !== BlockType.AIR) {
        setPickedUpSlot(slotIndex);
      }
    } else {
      // Move/swap
      engineRef.current?.moveItem(pickedUpSlot, slotIndex);
      setPickedUpSlot(null);
    }
  }, [pickedUpSlot, slots]);
  const handleNewWorld = useCallback(() => {
    if (window.confirm("Start a new world? This erases your saved game.")) {
      engineRef.current?.resetSave();
      window.location.reload();
    }
  }, []);
  const handleEat = useCallback(() => { engineRef.current?.eatFood(); }, []);
  const handleLeaveLan = useCallback(() => {
    engineRef.current?.leaveLan();
    setDisplayedHostAddr("");
  }, []);
  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (text) {
      engineRef.current?.sendChat(text);
    }
    setChatInput("");
    setChatOpen(false);
  }, [chatInput]);
  const handleToggleCreative = useCallback(() => {
    engineRef.current?.toggleCreative();
  }, []);
  const handleCommand = useCallback((cmd: string) => {
    engineRef.current?.runCommand(cmd);
  }, []);

  const invCount = (id: number): number => {
    let n = 0;
    for (const s of slots) if (s.id === id) n += s.count;
    return n;
  };

  const timeStr = formatTime(hud.timeOfDay);
  const isDay = hud.timeOfDay > 0.23 && hud.timeOfDay < 0.77;
  const selectedBlockName = BLOCKS[hud.selectedBlockId]?.name ?? "Empty";
  const foodCount = invCount(BlockType.FOOD);

  return (
    <div ref={containerRef} className="relative w-screen h-screen overflow-hidden bg-[#9ad0ff] select-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* Minimal crosshair */}
      {hud.locked && !menuOpen && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
          <div className="relative w-1.5 h-1.5 rounded-full bg-white" style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.8)" }} />
        </div>
      )}

      {/* HUD top-left */}
      {hud.locked && (
        <div className="pointer-events-none absolute top-3 left-3 font-mono text-[13px] leading-5 text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] z-10">
          <div>FPS: <span className="text-emerald-300">{hud.fps}</span></div>
          <div>XYZ: {hud.x.toFixed(1)} / {hud.y.toFixed(1)} / {hud.z.toFixed(1)}</div>
          <div>
            Time: <span className={isDay ? "text-yellow-300" : "text-indigo-300"}>{timeStr}</span>
            {isDay ? " ☀" : " ☾"}
          </div>
          {hud.lanStatus === "connected" && (
            <div className="text-emerald-300">LAN: {hud.lanPlayers} player(s)</div>
          )}
          {hud.creative && (
            <div className="text-purple-300">CREATIVE</div>
          )}
        </div>
      )}

      {/* Chat overlay: small list in the top-left below the HUD, fading after 5s */}
      {hud.locked && chatMessages.length > 0 && (
        <div className="pointer-events-none absolute top-24 left-3 z-10 max-w-[70vw] flex flex-col gap-0.5">
          {chatMessages.slice(-6).map((m) => {
            const msLeft = m.expiresAt - Date.now();
            const opacity = msLeft < 1000 ? Math.max(0.15, msLeft / 1000) : 1;
            return (
              <div key={m.id}
                className="font-mono text-[12px] text-white/95 leading-tight"
                style={{ opacity, textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}>
                {m.sender ? <span className="text-emerald-300">{m.sender}: </span> : null}
                <span>{m.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* HUD top-right */}
      {hud.locked && !menuOpen && (
        <div className="absolute top-3 right-3 z-30 text-right" style={{ pointerEvents: "none" }}>
          <div className="text-[10px] text-white/60 font-mono mb-1">
            {hud.saveStatus === "loaded" && "💾 Loaded save"}
            {hud.saveStatus === "saved" && "💾 Saved"}
            {hud.saveStatus === "cleared" && "🗑 New world"}
            {hud.saveStatus === "none" && "No save yet"}
          </div>
          {foodCount > 0 && (
            <div className="flex items-center gap-1.5 bg-black/50 rounded px-2 py-1 mb-1 border border-red-400/40">
              <img src={blockIcon(BlockType.FOOD)} alt="food" width={20} height={20} draggable={false}
                style={{ width: 20, height: 20, imageRendering: "pixelated", display: "block" }} />
              <span className="text-white text-xs font-mono">×{foodCount}</span>
            </div>
          )}
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => setShowLanPanel(true)}
              className={`text-[10px] px-2 py-1 rounded font-mono border ${
                hud.lanStatus === "connected"
                  ? "bg-emerald-600/60 text-white border-emerald-400/40"
                  : "bg-zinc-700/60 text-white/80 border-white/20"
              }`}
              style={{ pointerEvents: "auto" }}
            >
              {hud.lanStatus === "connected" ? `🌐 LAN (${hud.lanPlayers})` : "🌐 LAN"}
            </button>
          </div>
        </div>
      )}

      {/* Chat input panel — toggled by the CHAT button in the touch UI */}
      {hud.locked && chatOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setChatOpen(false)}>
          <div className="bg-zinc-900/95 border-2 border-zinc-700 rounded-lg p-4 max-w-md w-[90%] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-white text-sm font-bold">Chat / Commands</h3>
              <button onClick={() => setChatOpen(false)} className="text-white/70 hover:text-white text-xl leading-none px-2" aria-label="Close">×</button>
            </div>
            <p className="text-[11px] text-white/50 font-mono mb-2">
              Type a message to broadcast on LAN, or a command like <span className="text-emerald-300">/time set day</span>,
              <span className="text-emerald-300"> /creative</span>, <span className="text-emerald-300">/heal</span>,
              <span className="text-emerald-300"> /teleport x y z</span>.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSendChat(); }}
                placeholder="/time set day  or  hello everyone!"
                autoFocus
                maxLength={200}
                className="flex-1 px-3 py-2 bg-black/50 text-white text-sm rounded border border-white/20 font-mono"
              />
              <button
                onClick={handleSendChat}
                className="px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded font-bold text-sm"
              >
                Send
              </button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <button onClick={() => handleCommand("/time set day")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/time set day</button>
              <button onClick={() => handleCommand("/time set night")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/time set night</button>
              <button onClick={() => handleCommand("/creative")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/creative</button>
              <button onClick={() => handleCommand("/heal")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/heal</button>
              <button onClick={() => setChatInput("/teleport ")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/teleport ...</button>
            </div>
          </div>
        </div>
      )}

      {/* Health + Food bars */}
      {hud.locked && !menuOpen && (
        <div className="pointer-events-none absolute z-10 flex flex-col items-center gap-0.5" style={{ left: "50%", bottom: "76px", transform: "translateX(-50%)" }}>
          <HealthBar health={hud.health} max={hud.maxHealth} />
          <FoodBar food={hud.food} max={hud.maxFood} />
        </div>
      )}

      {/* Selected block display */}
      {hud.locked && !menuOpen && hud.selectedBlockId !== BlockType.AIR && (
        <div className="pointer-events-none absolute z-10 flex items-center gap-2 bg-black/40 rounded px-2 py-1"
          style={{ left: "50%", bottom: "78px", transform: "translateX(-180px)" }}>
          <img src={blockIcon(hud.selectedBlockId)} alt="" width={20} height={20} draggable={false}
            style={{ width: 20, height: 20, imageRendering: "pixelated", display: "block" }} />
          <span className="text-white text-xs font-mono">{selectedBlockName}</span>
        </div>
      )}

      {/* Break progress bar */}
      {hud.locked && !menuOpen && (
        <div data-break-progress className="pointer-events-none absolute z-10" style={{ left: "50%", bottom: "100px", transform: "translateX(-50%)" }}>
          <div className="w-32 h-1.5 bg-black/50 rounded-full overflow-hidden">
            <div data-break-progress-fill className="h-full bg-white/80 transition-none" style={{ width: "0%" }} />
          </div>
          <div data-break-progress-text className="text-[9px] text-white/50 font-mono text-center mt-0.5">0%</div>
        </div>
      )}

      {/* LAN panel: separate Host / Join / Quit */}
      {showLanPanel && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowLanPanel(false)}>
          <div className="bg-zinc-900/95 border-2 border-zinc-700 rounded-lg p-5 max-w-sm w-[90%] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-white text-lg font-bold mb-3">🌐 LAN Multiplayer</h2>
            {hud.lanStatus === "connected" ? (
              <div className="text-center">
                <p className="text-emerald-300 text-sm mb-2">Connected — {hud.lanPlayers} other player(s) online</p>
                {displayedHostAddr && (
                  <div className="bg-black/40 rounded p-2 mb-3 text-center">
                    <p className="text-white/60 text-[10px] font-mono mb-1">Your host address:</p>
                    <p className="text-emerald-300 text-sm font-mono font-bold select-all">{displayedHostAddr}</p>
                  </div>
                )}
                <button onClick={handleLeaveLan} className="w-full px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-bold text-sm">
                  Quit LAN
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 py-2 bg-black/50 text-white text-sm rounded border border-white/20 mb-3"
                  maxLength={16}
                />
                {/* Host button */}
                <button
                  onClick={() => {
                    const addr = engineRef.current?.getHostAddress() || "unknown:3003";
                    setDisplayedHostAddr(addr);
                    engineRef.current?.hostLan(playerName || "Player");
                  }}
                  disabled={hud.lanStatus === "connecting"}
                  className="w-full px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded font-bold text-sm disabled:opacity-50 mb-2"
                >
                  🏠 Host Game
                </button>
                {displayedHostAddr && hud.lanStatus !== "connected" && (
                  <div className="bg-black/40 rounded p-2 mb-2 text-center">
                    <p className="text-white/60 text-[10px] font-mono mb-1">Share this address with others:</p>
                    <p className="text-emerald-300 text-sm font-mono font-bold select-all">{displayedHostAddr}</p>
                  </div>
                )}
                {/* Join section */}
                <div className="border-t border-white/10 pt-3 mt-3">
                  <input
                    type="text"
                    value={hostAddress}
                    onChange={(e) => setHostAddress(e.target.value)}
                    placeholder="Host address (e.g. 192.168.1.5:3003)"
                    className="w-full px-3 py-2 bg-black/50 text-white text-sm rounded border border-white/20 mb-2"
                  />
                  <button
                    onClick={() => { if (hostAddress.trim()) { engineRef.current?.joinLanHost(playerName || "Player", hostAddress.trim()); setShowLanPanel(false); } }}
                    disabled={hud.lanStatus === "connecting" || !hostAddress.trim()}
                    className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white rounded font-bold text-sm disabled:opacity-50"
                  >
                    🔗 Join Game
                  </button>
                </div>
              </div>
            )}
            <button onClick={() => setShowLanPanel(false)} className="w-full mt-3 text-white/60 hover:text-white text-sm">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Death overlay */}
      {hud.locked && hud.dead && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/50 z-30 pointer-events-none">
          <div className="text-center">
            <h2 className="text-5xl font-extrabold text-red-300 mb-2" style={{ textShadow: "0 0 10px black" }}>You Died</h2>
            <p className="text-white/80 text-sm">Respawning in 15 seconds...</p>
          </div>
        </div>
      )}

      {/* Inventory menu */}
      {hud.locked && menuOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="bg-zinc-900/95 border-2 border-zinc-700 rounded-lg p-5 max-w-3xl w-[92%] max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white text-xl font-bold">Inventory</h2>
              <div className="flex items-center gap-3">
                {foodCount > 0 && (
                  <button onClick={handleEat} className="text-[11px] px-3 py-1 bg-red-600/60 hover:bg-red-500 text-white rounded border border-red-400/30">
                    Eat Food ({foodCount})
                  </button>
                )}
                <button onClick={handleNewWorld} className="text-[11px] px-2 py-1 bg-red-700/60 hover:bg-red-600 text-white rounded border border-red-400/30">
                  New World
                </button>
                <button onClick={handleCloseMenu} className="text-white/70 hover:text-white text-2xl leading-none px-2" aria-label="Close">×</button>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-[11px] text-white/60 font-mono mb-1.5">
                HOTBAR — tap to select, tap two slots to move items
                {pickedUpSlot !== null && <span className="text-yellow-300 ml-2">(holding item from slot {pickedUpSlot + 1})</span>}
              </div>
              <div className="flex gap-1.5 p-2 bg-black/40 rounded">
                {slots.slice(0, HOTBAR_SIZE).map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSlotClick(i)}
                    onContextMenu={(e) => { e.preventDefault(); handleSelectSlot(i); }}
                    className={`relative w-12 h-12 rounded border-2 overflow-hidden transition-colors ${
                      pickedUpSlot === i ? "border-yellow-400 bg-yellow-900/40" :
                      i === hud.selected ? "border-emerald-400 bg-emerald-900/40" : "border-white/20 bg-black/40 hover:border-white/50"
                    }`}
                    title={s.id !== BlockType.AIR ? `${BLOCKS[s.id]?.name ?? "Item"} x${s.count}` : "Empty"}
                  >
                    {s.id !== BlockType.AIR && (
                      <img src={blockIcon(s.id)} alt="" width={48} height={48} draggable={false}
                        style={{ width: 48, height: 48, imageRendering: "pixelated", display: "block" }} />
                    )}
                    {s.id !== BlockType.AIR && s.count > 1 && (
                      <span className="absolute bottom-0 right-1 text-[10px] font-mono font-bold text-white"
                        style={{ textShadow: "0 0 2px black, 0 0 2px black" }}>{s.count}</span>
                    )}
                    <span className="absolute bottom-0 left-1 text-[9px] font-mono text-white/50"
                      style={{ textShadow: "0 0 2px black" }}>{i + 1}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <div className="text-[11px] text-white/60 font-mono mb-1.5">MAIN INVENTORY</div>
              <div className="flex flex-wrap gap-1.5 p-2 bg-black/40 rounded">
                {slots.slice(HOTBAR_SIZE).map((s, i) => {
                  const slotIndex = i + HOTBAR_SIZE;
                  return (
                    <button
                      key={i}
                      onClick={() => handleSlotClick(slotIndex)}
                      className={`relative w-12 h-12 rounded border-2 overflow-hidden transition-colors ${
                        pickedUpSlot === slotIndex ? "border-yellow-400 bg-yellow-900/40" : "border-white/15 bg-black/40 hover:border-white/50"
                      }`}
                      title={s.id !== BlockType.AIR ? `${BLOCKS[s.id]?.name ?? "Item"} x${s.count}` : "Empty"}
                    >
                      {s.id !== BlockType.AIR && (
                        <>
                          <img src={blockIcon(s.id)} alt="" width={48} height={48} draggable={false}
                            style={{ width: 48, height: 48, imageRendering: "pixelated", display: "block" }} />
                          {s.count > 1 && (
                            <span className="absolute bottom-0 right-1 text-[10px] font-mono font-bold text-white"
                              style={{ textShadow: "0 0 2px black, 0 0 2px black" }}>{s.count}</span>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="text-[11px] text-white/60 font-mono mb-1.5">BASIC CRAFTING (no table needed)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {BASIC_RECIPES.map((recipe) => {
                const can = recipe.ingredients.every((ing) => invCount(ing.id) >= ing.count);
                return (
                  <div key={recipe.id} className={`flex items-center gap-3 p-2.5 rounded border ${
                    can ? "bg-emerald-900/30 border-emerald-600/50" : "bg-zinc-800/50 border-zinc-700/50 opacity-60"
                  }`}>
                    <div className="flex items-center gap-1 flex-1">
                      <span className="text-[10px] text-white/50 font-mono mr-1">IN:</span>
                      {recipe.ingredients.map((ing, i) => (
                        <div key={i} className="flex items-center gap-0.5">
                          <div className="relative w-7 h-7 bg-black/40 border border-white/15 rounded-sm overflow-hidden">
                            <img src={blockIcon(ing.id)} alt="" width={28} height={28} draggable={false}
                              style={{ width: 28, height: 28, imageRendering: "pixelated", display: "block" }} />
                          </div>
                          <span className={`text-xs font-mono ${invCount(ing.id) >= ing.count ? "text-emerald-300" : "text-red-300"}`}>
                            ×{ing.count}
                          </span>
                        </div>
                      ))}
                    </div>
                    <span className="text-white/40 text-lg">→</span>
                    <div className="flex items-center gap-0.5">
                      <div className="relative w-8 h-8 bg-black/40 border border-white/20 rounded-sm overflow-hidden">
                        <img src={blockIcon(recipe.output.id)} alt="" width={32} height={32} draggable={false}
                          style={{ width: 32, height: 32, imageRendering: "pixelated", display: "block" }} />
                      </div>
                      <span className="text-sm font-mono text-emerald-300">×{recipe.output.count}</span>
                    </div>
                    <button
                      onClick={() => handleCraft(recipe)}
                      disabled={!can}
                      className={`ml-auto px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                        can ? "bg-emerald-500 hover:bg-emerald-400 text-white cursor-pointer" : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                      }`}
                    >
                      CRAFT
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 text-[11px] text-white/50 font-mono leading-relaxed">
              Tap the right side to place blocks or attack mobs. Long-press to break.
              Tap a bed to skip the night. Select a sword in the hotbar for double attack damage.
              Craft a crafting table (4 Wood) and place it, then tap it to access all recipes.
              Craft torches to light up the dark.
            </div>
          </div>
        </div>
      )}

      {/* Crafting Table UI — shows ALL recipes */}
      {hud.locked && craftTableOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="bg-zinc-900/95 border-2 border-amber-700 rounded-lg p-5 max-w-3xl w-[92%] max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white text-xl font-bold">Crafting Table</h2>
              <button onClick={handleCloseCraftTable} className="text-white/70 hover:text-white text-2xl leading-none px-2" aria-label="Close">×</button>
            </div>

            {/* Inventory summary */}
            <div className="mb-4">
              <div className="text-[11px] text-white/60 font-mono mb-1.5">INVENTORY</div>
              <div className="flex flex-wrap gap-1.5 p-2 bg-black/40 rounded">
                {slots.map((s, i) => (
                  <div
                    key={i}
                    className="relative w-12 h-12 rounded border border-white/15 bg-black/40 overflow-hidden"
                    title={s.id !== BlockType.AIR ? `${BLOCKS[s.id]?.name ?? "Item"} x${s.count}` : "Empty"}
                  >
                    {s.id !== BlockType.AIR && (
                      <>
                        <img src={blockIcon(s.id)} alt="" width={48} height={48} draggable={false}
                          style={{ width: 48, height: 48, imageRendering: "pixelated", display: "block" }} />
                        {s.count > 1 && (
                          <span className="absolute bottom-0 right-1 text-[10px] font-mono font-bold text-white"
                            style={{ textShadow: "0 0 2px black, 0 0 2px black" }}>{s.count}</span>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ALL recipes */}
            <div className="text-[11px] text-white/60 font-mono mb-1.5">ALL RECIPES</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {RECIPES.map((recipe) => {
                const can = recipe.ingredients.every((ing) => invCount(ing.id) >= ing.count);
                return (
                  <div key={recipe.id} className={`flex items-center gap-3 p-2.5 rounded border ${
                    can ? "bg-emerald-900/30 border-emerald-600/50" : "bg-zinc-800/50 border-zinc-700/50 opacity-60"
                  }`}>
                    <div className="flex items-center gap-1 flex-1">
                      <span className="text-[10px] text-white/50 font-mono mr-1">IN:</span>
                      {recipe.ingredients.map((ing, i) => (
                        <div key={i} className="flex items-center gap-0.5">
                          <div className="relative w-7 h-7 bg-black/40 border border-white/15 rounded-sm overflow-hidden">
                            <img src={blockIcon(ing.id)} alt="" width={28} height={28} draggable={false}
                              style={{ width: 28, height: 28, imageRendering: "pixelated", display: "block" }} />
                          </div>
                          <span className={`text-xs font-mono ${invCount(ing.id) >= ing.count ? "text-emerald-300" : "text-red-300"}`}>
                            ×{ing.count}
                          </span>
                        </div>
                      ))}
                    </div>
                    <span className="text-white/40 text-lg">→</span>
                    <div className="flex items-center gap-0.5">
                      <div className="relative w-8 h-8 bg-black/40 border border-white/20 rounded-sm overflow-hidden">
                        <img src={blockIcon(recipe.output.id)} alt="" width={32} height={32} draggable={false}
                          style={{ width: 32, height: 32, imageRendering: "pixelated", display: "block" }} />
                      </div>
                      <span className="text-sm font-mono text-emerald-300">×{recipe.output.count}</span>
                    </div>
                    <button
                      onClick={() => handleCraft(recipe)}
                      disabled={!can}
                      className={`ml-auto px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                        can ? "bg-emerald-500 hover:bg-emerald-400 text-white cursor-pointer" : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                      }`}
                    >
                      CRAFT
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 text-[11px] text-white/50 font-mono leading-relaxed">
              The crafting table gives access to all recipes. Basic recipes
              (planks, torches, cobblestone, crafting table) can be crafted
              from the inventory without a table.
            </div>
          </div>
        </div>
      )}

      {/* Intro */}
      {!hud.locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center bg-black/55 backdrop-blur-md z-30">
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-white drop-shadow-[0_3px_8px_rgba(0,0,0,0.6)]">
            <span className="text-emerald-400">Mine</span>craft.js
          </h1>
          <p className="mt-3 text-white/80 text-sm sm:text-base max-w-md">
            Minimal voxel sandbox. Mobs, torches, swords, beds, crafting, LAN
            multiplayer, hunger system, commands, and persistence.
          </p>
          {hud.saveStatus === "loaded" && (
            <p className="mt-3 text-emerald-300 text-sm font-mono">💾 Saved game loaded</p>
          )}
          <button onClick={handlePlay} className="mt-7 px-7 py-3 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white text-lg font-bold rounded-md shadow-lg transition-colors">
            {hud.saveStatus === "loaded" ? "Continue" : "Tap to Play"}
          </button>
          <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-2 text-white/85 text-sm font-mono">
            <div><span className="text-emerald-300">Left stick</span> — Move</div>
            <div><span className="text-emerald-300">Right drag</span> — Look</div>
            <div><span className="text-emerald-300">Right tap</span> — Place / Attack</div>
            <div><span className="text-emerald-300">Right hold</span> — Break</div>
            <div><span className="text-emerald-300">CRAFT btn</span> — Inventory</div>
            <div><span className="text-emerald-300">CHAT btn</span> — Chat & commands</div>
            <div><span className="text-emerald-300">Long-press slot</span> — Eat food</div>
            <div><span className="text-emerald-300">Long-press JUMP</span> — Creative fly</div>
            <div><span className="text-emerald-300">/creative</span> — Toggle creative</div>
            <div><span className="text-emerald-300">/heal /time /teleport</span> — Commands</div>
            <div><span className="text-emerald-300">🌐 LAN</span> — Host / Join / Quit</div>
            <div><span className="text-emerald-300">Music</span> — /music folder</div>
          </div>
        </div>
      )}
    </div>
  );
}
