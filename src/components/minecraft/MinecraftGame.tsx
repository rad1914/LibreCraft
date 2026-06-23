"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Engine } from "@/lib/minecraft/engine";
import { BLOCKS, BlockType } from "@/lib/minecraft/blocks";
import { BASIC_RECIPES, RECIPES, type Recipe } from "@/lib/minecraft/crafting";
import { HOTBAR_SIZE, type InvSlot } from "@/lib/minecraft/inventory";
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
  submerged: boolean;
  breath: number;
  maxBreath: number;
  sprinting: boolean;
  fpsMode: number; // 60 or 120
  dimension: "overworld" | "sky";
  renderDistance: number; // chunk radius
  eventActive: boolean; // true when a red-moon-style event is running
}

const INITIAL: HudState = {
  fps: 0, x: 0, y: 0, z: 0, locked: false, selected: 0, timeOfDay: 0.25,
  saveStatus: "none", health: 20, maxHealth: 20, dead: false, selectedBlockId: BlockType.AIR,
  breakProgress: 0, lanStatus: "disconnected", lanPlayers: 0,
  food: 20, maxFood: 20, creative: false,
  submerged: false, breath: 10, maxBreath: 10,
  sprinting: false,
  fpsMode: 60,
  dimension: "overworld",
  renderDistance: 6,
  eventActive: false,
};

interface ChatMessage {
  id: number;
  sender: string;
  text: string;
  expiresAt: number;
}

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

// Pixel-perfect block icon used throughout the UI (hotbar, inventory,
// crafting rows). Memoized by id+face via the iconCache above.
function BlockIcon({ id, size = 28 }: { id: number; size?: number }) {
  return (
    <img src={blockIcon(id)} alt="" width={size} height={size} draggable={false}
      style={{ width: size, height: size, imageRendering: "pixelated", display: "block" }} />
  );
}

// A single crafting recipe row. Used by both the basic-crafting and
// crafting-table menus (saves ~80 LOC of duplicated JSX).
function RecipeRow({
  recipe,
  canCraft,
  invCount,
  onCraft,
}: {
  recipe: Recipe;
  canCraft: boolean;
  invCount: (id: number) => number;
  onCraft: (r: Recipe) => void;
}) {
  return (
    <div className={`flex items-center gap-3 p-2.5 rounded border ${
      canCraft ? "bg-emerald-900/30 border-emerald-600/50" : "bg-zinc-800/50 border-zinc-700/50 opacity-60"
    }`}>
      <div className="flex items-center gap-1 flex-1">
        <span className="text-[10px] text-white/50 font-mono mr-1">IN:</span>
        {recipe.ingredients.map((ing, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <div className="relative w-7 h-7 bg-black/40 border border-white/15 rounded-sm overflow-hidden">
              <BlockIcon id={ing.id} size={28} />
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
          <BlockIcon id={recipe.output.id} size={32} />
        </div>
        <span className="text-sm font-mono text-emerald-300">×{recipe.output.count}</span>
      </div>
      <button
        onClick={() => onCraft(recipe)}
        disabled={!canCraft}
        className={`ml-auto px-3 py-1.5 rounded text-xs font-bold transition-colors ${
          canCraft ? "bg-emerald-500 hover:bg-emerald-400 text-white cursor-pointer" : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
        }`}
      >
        CRAFT
      </button>
    </div>
  );
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
        if (i < fullHearts) cls = "text-rose-500";
        else if (i === fullHearts && halfHeart) cls = "text-rose-500 opacity-60";
        return (
          <span key={i} className={`text-sm leading-none ${cls}`} style={{ textShadow: "0 0 2px black" }}>
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
        if (i < full) cls = "text-amber-400";
        else if (i === full && half) cls = "text-amber-400 opacity-60";
        return (
          <span key={i} className={`text-sm leading-none ${cls}`} style={{ textShadow: "0 0 2px black" }}>
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
  const [tradeOpen, setTradeOpen] = useState(false);
  const [showLanPanel, setShowLanPanel] = useState(false);
  const [playerName, setPlayerName] = useState("Player");
  const [hostAddress, setHostAddress] = useState("");
  const [displayedHostAddr, setDisplayedHostAddr] = useState("");
  const [pickedUpSlot, setPickedUpSlot] = useState<number | null>(null);
  const [offhandSlot, setOffhandSlot] = useState<InvSlot>({ id: BlockType.AIR, count: 0 });
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
      onInventoryChange: (s) => {
        setSlots(s);
        // Keep the offhand slot UI in sync when the inventory changes.
        setOffhandSlot(engineRef.current?.getOffhandSlot() ?? { id: BlockType.AIR, count: 0 });
      },
      onCraftToggle: () => setMenuOpen((v) => !v),
      onCraftTableToggle: () => setCraftTableOpen((v) => !v),
      onTradeToggle: () => setTradeOpen((v) => !v),
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
      onSubmergedChange: (submerged, breath, maxBreath) => setHud((h) => ({ ...h, submerged, breath, maxBreath })),
      onToggleSprint: (sprinting) => setHud((h) => ({ ...h, sprinting })),
      onFpsModeChange: (fps) => setHud((h) => ({ ...h, fpsMode: fps })),
      onDimensionChange: (dimension) => setHud((h) => ({ ...h, dimension })),
      onRenderDistanceChange: (distance) => setHud((h) => ({ ...h, renderDistance: distance })),
      onEventChange: (active) => setHud((h) => ({ ...h, eventActive: active })),
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
      maxBreath: engine.getMaxBreath(),
      breath: engine.getMaxBreath(),
      fpsMode: engine.getTargetFps(),
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
      // Pick up (only if the slot has an item). If the item is a torch
      // or sword, send it to the offhand slot instead of picking it up.
      const s = slots[slotIndex];
      if (s && s.id !== BlockType.AIR) {
        if (s.id === BlockType.TORCH || s.id === BlockType.SWORD) {
          engineRef.current?.moveToOffhand(slotIndex);
          setOffhandSlot(engineRef.current?.getOffhandSlot() ?? { id: BlockType.AIR, count: 0 });
        } else {
          setPickedUpSlot(slotIndex);
        }
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

      {/* HUD top-left: compact dark panel with vital stats */}
      {hud.locked && (
        <div className="pointer-events-none absolute top-3 left-3 z-10">
          <div className="bg-zinc-950/70 backdrop-blur-md border border-zinc-700/60 rounded-md px-3 py-2 font-mono text-[11px] leading-tight text-zinc-200 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">FPS</span>
              <span className="text-zinc-100 font-semibold tabular-nums">{hud.fps}</span>
              <span className="text-zinc-700">·</span>
              <span className={isDay ? "text-amber-400" : "text-indigo-300"}>{timeStr}{isDay ? " ☀" : " ☾"}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-zinc-500">XYZ</span>
              <span className="text-zinc-300 tabular-nums">{hud.x.toFixed(1)} {hud.y.toFixed(1)} {hud.z.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
              {hud.creative && <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">CREATIVE</span>}
              {hud.dimension === "sky" && <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">SKY</span>}
              {hud.lanStatus === "connected" && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">LAN {hud.lanPlayers}</span>}
              {hud.sprinting && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">SPRINT</span>}
              {hud.eventActive && <span className="px-1.5 py-0.5 rounded bg-red-700/40 text-red-200 border border-red-500/60 animate-pulse font-bold">RED MOON</span>}
            </div>
          </div>
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
                className="font-mono text-[11px] text-zinc-200 leading-tight bg-zinc-950/40 px-1.5 py-0.5 rounded"
                style={{ opacity, textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}>
                {m.sender ? <span className="text-emerald-400">{m.sender}: </span> : null}
                <span>{m.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* HUD top-right: compact controls + save status */}
      {hud.locked && !menuOpen && (
        <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5" style={{ pointerEvents: "none" }}>
          <div className="bg-zinc-950/70 backdrop-blur-md border border-zinc-700/60 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-400 shadow-lg">
            {hud.saveStatus === "loaded" && <span className="text-emerald-400">💾 Loaded</span>}
            {hud.saveStatus === "saved" && <span className="text-emerald-400">💾 Saved</span>}
            {hud.saveStatus === "cleared" && <span className="text-rose-400">🗑 New world</span>}
            {hud.saveStatus === "none" && <span className="text-zinc-500">No save</span>}
          </div>
          {foodCount > 0 && (
            <div className="flex items-center gap-1.5 bg-zinc-950/70 backdrop-blur-md border border-zinc-700/60 rounded-md px-2 py-1 shadow-lg">
              <BlockIcon id={BlockType.FOOD} size={18} />
              <span className="text-zinc-200 text-[11px] font-mono tabular-nums">×{foodCount}</span>
            </div>
          )}
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => setShowLanPanel(true)}
              className={`text-[10px] px-2.5 py-1 rounded font-mono border backdrop-blur-md transition-colors ${
                hud.lanStatus === "connected"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                  : "bg-zinc-950/70 text-zinc-300 border-zinc-700/60 hover:bg-zinc-800/80"
              }`}
              style={{ pointerEvents: "auto" }}
            >
              {hud.lanStatus === "connected" ? `🌐 LAN ${hud.lanPlayers}` : "🌐 LAN"}
            </button>
            <button
              onClick={() => engineRef.current?.setTargetFps(hud.fpsMode === 60 ? 120 : 60)}
              className="text-[10px] px-2.5 py-1 rounded font-mono border bg-zinc-950/70 text-zinc-300 border-zinc-700/60 hover:bg-zinc-800/80 backdrop-blur-md transition-colors"
              style={{ pointerEvents: "auto" }}
              title="Toggle 60/120 FPS"
            >
              {hud.fpsMode} FPS
            </button>
            <button
              onClick={() => {
                const cur = engineRef.current?.getRenderDistance() ?? 6;
                // Cycle: 3 → 6 → 9 → 12 → 3
                const next = cur < 5 ? 6 : cur < 8 ? 9 : cur < 11 ? 12 : 3;
                engineRef.current?.setRenderDistance(next);
              }}
              className="text-[10px] px-2.5 py-1 rounded font-mono border bg-zinc-950/70 text-zinc-300 border-zinc-700/60 hover:bg-zinc-800/80 backdrop-blur-md transition-colors"
              style={{ pointerEvents: "auto" }}
              title="Chunk render distance"
            >
              {hud.renderDistance ?? 6} CH
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
              <button onClick={() => engineRef.current?.sendChat("/time set day")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/time set day</button>
              <button onClick={() => engineRef.current?.sendChat("/time set night")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/time set night</button>
              <button onClick={() => engineRef.current?.sendChat("/creative")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/creative</button>
              <button onClick={() => engineRef.current?.sendChat("/heal")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/heal</button>
              <button onClick={() => setChatInput("/teleport ")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/teleport ...</button>
              <button onClick={() => setChatInput("/spawn ")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/spawn ...</button>
              <button onClick={() => setChatInput("/give ")} className="text-[10px] px-2 py-1 bg-zinc-800/60 hover:bg-zinc-700/60 text-white/80 rounded border border-white/10 font-mono">/give ...</button>
            </div>
          </div>
        </div>
      )}

      {/* Status bars + selected block — compact bottom-center cluster above hotbar */}
      {hud.locked && !menuOpen && (
        <div className="pointer-events-none absolute z-10 flex flex-col items-center gap-1" style={{ left: "50%", bottom: "84px", transform: "translateX(-50%)" }}>
          {/* Selected block (left of bars) + bars in a compact row */}
          <div className="flex items-center gap-2">
            {hud.selectedBlockId !== BlockType.AIR && (
              <div className="flex items-center gap-1.5 bg-zinc-950/70 backdrop-blur-md border border-zinc-700/60 rounded px-2 py-1 shadow-lg">
                <BlockIcon id={hud.selectedBlockId} size={18} />
                <span className="text-zinc-200 text-[11px] font-mono">{selectedBlockName}</span>
              </div>
            )}
            <div className="bg-zinc-950/70 backdrop-blur-md border border-zinc-700/60 rounded px-2 py-1 flex items-center gap-2 shadow-lg">
              <HealthBar health={hud.health} max={hud.maxHealth} />
              <div className="w-px h-3 bg-zinc-700/60" />
              <FoodBar food={hud.food} max={hud.maxFood} />
            </div>
          </div>
          {/* Break progress bar — only visible while breaking */}
          <div data-break-progress className="w-32 h-1 bg-zinc-950/60 rounded-full overflow-hidden" style={{ opacity: 0 }}>
            <div data-break-progress-fill className="h-full bg-zinc-300 transition-none" style={{ width: "0%" }} />
          </div>
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
            <p className="text-white/80 text-sm">Respawning in 6 seconds...</p>
          </div>
        </div>
      )}

      {/* Underwater overlay: blue tint + breath meter */}
      {hud.locked && hud.submerged && !hud.dead && (
        <>
          <div className="pointer-events-none absolute inset-0 z-20"
            style={{ background: "rgba(40, 90, 180, 0.35)", boxShadow: "inset 0 0 120px rgba(0, 30, 80, 0.6)" }} />
          {/* Breath meter — small bubbles icon row near the hotbar */}
          {hud.breath < hud.maxBreath && (
            <div className="pointer-events-none absolute z-30 flex items-center gap-1"
              style={{ left: "50%", bottom: "120px", transform: "translateX(-50%)" }}>
              {Array.from({ length: Math.ceil(hud.maxBreath / 2) }).map((_, i) => {
                const filled = (hud.breath / 2) > i;
                const half = (hud.breath / 2) > i - 0.5 && (hud.breath / 2) <= i;
                const isLow = hud.breath < 3;
                const color = isLow ? "text-red-400" : "text-cyan-200";
                return (
                  <span key={i} className={`text-base leading-none ${color} ${filled ? "" : half ? "opacity-60" : "opacity-25"}`}
                    style={{ textShadow: "0 0 2px black" }}>
                    ◌
                  </span>
                );
              })}
            </div>
          )}
        </>
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
                      <BlockIcon id={s.id} size={48} />
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
                          <BlockIcon id={s.id} size={48} />
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

            {/* Offhand slot — dedicated torch/sword slot. Tap a torch or
                sword in the main inventory to move it here; tap the
                offhand slot to move its contents back. */}
            <div className="mb-4">
              <div className="text-[11px] text-white/60 font-mono mb-1.5">
                OFFHAND (torch = walking light, sword = +attack)
              </div>
              <div className="flex items-center gap-2 p-2 bg-black/40 rounded">
                <button
                  onClick={() => {
                    engineRef.current?.moveOffhandToMain();
                    setOffhandSlot(engineRef.current?.getOffhandSlot() ?? { id: BlockType.AIR, count: 0 });
                  }}
                  className={`relative w-12 h-12 rounded border-2 overflow-hidden transition-colors ${
                    offhandSlot.id !== BlockType.AIR ? "border-amber-400 bg-amber-900/30" : "border-white/15 bg-black/40"
                  }`}
                  title={offhandSlot.id !== BlockType.AIR ? `${BLOCKS[offhandSlot.id]?.name ?? "Item"} x${offhandSlot.count}` : "Offhand (torch/sword only)"}
                >
                  {offhandSlot.id !== BlockType.AIR && (
                    <>
                      <BlockIcon id={offhandSlot.id} size={48} />
                      {offhandSlot.count > 1 && (
                        <span className="absolute bottom-0 right-1 text-[10px] font-mono font-bold text-white"
                          style={{ textShadow: "0 0 2px black, 0 0 2px black" }}>{offhandSlot.count}</span>
                      )}
                    </>
                  )}
                </button>
                <span className="text-[10px] text-white/50 font-mono">
                  {offhandSlot.id === BlockType.TORCH
                    ? "Dynamic light while walking"
                    : offhandSlot.id === BlockType.SWORD
                    ? "+2 attack damage"
                    : "Tap a torch or sword above to equip"}
                </span>
              </div>
            </div>

            <div className="text-[11px] text-white/60 font-mono mb-1.5">BASIC CRAFTING (no table needed)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {BASIC_RECIPES.map((recipe) => (
                <RecipeRow
                  key={recipe.id}
                  recipe={recipe}
                  canCraft={recipe.ingredients.every((ing) => invCount(ing.id) >= ing.count)}
                  invCount={invCount}
                  onCraft={handleCraft}
                />
              ))}
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
                        <BlockIcon id={s.id} size={48} />
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
              {RECIPES.map((recipe) => (
                <RecipeRow
                  key={recipe.id}
                  recipe={recipe}
                  canCraft={recipe.ingredients.every((ing) => invCount(ing.id) >= ing.count)}
                  invCount={invCount}
                  onCraft={handleCraft}
                />
              ))}
            </div>
            <div className="mt-4 text-[11px] text-white/50 font-mono leading-relaxed">
              The crafting table gives access to all recipes. Basic recipes
              (planks, torches, cobblestone, crafting table) can be crafted
              from the inventory without a table.
            </div>
          </div>
        </div>
      )}

      {/* Trade UI — villager trading with ruby currency */}
      {hud.locked && tradeOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="bg-zinc-900/95 border-2 border-amber-700 rounded-lg p-5 max-w-md w-[92%] max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white text-xl font-bold">Villager Trade</h2>
              <button onClick={() => setTradeOpen(false)} className="text-white/70 hover:text-white text-2xl leading-none px-2" aria-label="Close">×</button>
            </div>
            <div className="mb-4 flex items-center gap-2 bg-black/40 rounded px-3 py-2 border border-red-400/30">
              <BlockIcon id={BlockType.RUBY} size={24} />
              <span className="text-red-300 text-sm font-mono">Rubies: {engineRef.current?.countRuby() ?? 0}</span>
            </div>
            <div className="flex flex-col gap-2">
              {engineRef.current?.getTradeOffers().map((trade) => {
                const rubyCount = engineRef.current?.countRuby() ?? 0;
                const canAfford = rubyCount >= trade.rubyCost;
                return (
                  <div key={trade.id} className={`flex items-center gap-3 p-2.5 rounded border ${
                    canAfford ? "bg-emerald-900/30 border-emerald-600/50" : "bg-zinc-800/50 border-zinc-700/50 opacity-60"
                  }`}>
                    <div className="flex items-center gap-1">
                      <BlockIcon id={trade.output.id} size={32} />
                      <span className="text-sm font-mono text-emerald-300">×{trade.output.count}</span>
                    </div>
                    <span className="text-white text-sm flex-1">{trade.name}</span>
                    <div className="flex items-center gap-1">
                      <BlockIcon id={BlockType.RUBY} size={20} />
                      <span className={`text-xs font-mono ${canAfford ? "text-emerald-300" : "text-red-300"}`}>×{trade.rubyCost}</span>
                    </div>
                    <button
                      onClick={() => {
                        const ok = engineRef.current?.executeTrade(trade.id);
                        if (!ok) {
                          pushChat("", "Not enough rubies!");
                        }
                      }}
                      disabled={!canAfford}
                      className={`px-3 py-1.5 rounded text-xs font-bold ${
                        canAfford ? "bg-emerald-500 hover:bg-emerald-400 text-white cursor-pointer" : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                      }`}
                    >
                      TRADE
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 text-[11px] text-white/50 font-mono leading-relaxed">
              Trade rubies (mined from ruby ore deep underground) for tools and
              resources. Ruby ore requires a diamond pickaxe to mine.
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
            <div><span className="text-emerald-300">Left stick / WASD</span> — Move</div>
            <div><span className="text-emerald-300">Right drag</span> — Look</div>
            <div><span className="text-emerald-300">Right tap</span> — Place / Attack</div>
            <div><span className="text-emerald-300">Right hold</span> — Break</div>
            <div><span className="text-emerald-300">CRAFT slot</span> — Inventory</div>
            <div><span className="text-emerald-300">CHAT btn</span> — Chat & commands</div>
            <div><span className="text-emerald-300">Space</span> — Jump / Swim</div>
            <div><span className="text-emerald-300">Shift</span> — Sneak (no edge-fall)</div>
            <div><span className="text-emerald-300">1-9 keys</span> — Select hotbar</div>
            <div><span className="text-emerald-300">F key</span> — Toggle 60/120 FPS</div>
            <div><span className="text-emerald-300">Long-press JUMP</span> — Creative fly</div>
            <div><span className="text-emerald-300">/creative /heal /time</span> — Commands</div>
            <div><span className="text-emerald-300">/spawn /give</span> — Spawn mob, give item</div>
            <div><span className="text-emerald-300">Stone ring 3x2/2x3/4x4</span> — Build portal</div>
            <div><span className="text-emerald-300">Step into portal</span> — Sky dimension</div>
            <div><span className="text-emerald-300">Tap villager</span> — Trade with rubies</div>
            <div><span className="text-emerald-300">Tap / touch door</span> — Open / close</div>
            <div><span className="text-emerald-300">+ iron ore + wool</span> — Summon golem</div>
            <div><span className="text-emerald-300">Explore</span> — Find procedural villages</div>
            <div><span className="text-emerald-300">Sky dimension</span> — Dragons spawn</div>
            <div><span className="text-emerald-300">Wolves</span> — Neutral, bite back if hit</div>
            <div><span className="text-emerald-300">Offhand slot</span> — Torch (light) / Sword (+dmg)</div>
            <div><span className="text-emerald-300">Red moon</span> — Mob swarm, random damage</div>
            <div><span className="text-emerald-300">CH button</span> — Pick render distance</div>
          </div>
        </div>
      )}
    </div>
  );
}
