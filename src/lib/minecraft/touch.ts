// Touch controls for ALL devices. On touch hardware, real touch events
// drive the joystick/look/buttons. On desktop, mouse events are mapped
// to the same handlers.
//
// Layout (modern, uniform design — all buttons share the same glassy
// dark-blur style with rounded corners and consistent sizing):
//   - Left half of the screen: virtual movement joystick (floating).
//   - Right half of the screen: look drag + tap-to-place + long-press-to-break.
//   - Bottom-right: large JUMP button (primary action).
//   - Bottom-left cluster: SPRINT + CRAFT buttons.
//   - Top-center: CHAT button.
//   - Bottom-center: hotbar 1..9 (tap to select).
//
// There is no crosshair, no BREAK button, no PLACE button.

import { InputState } from "./player";

export interface TouchControllerCallbacks {
  onPlace: () => void;
  onBreakStart: () => void;
  onBreakEnd: () => void;
  onSlotChange: (slot: number) => void;
  onLook: (yawDelta: number, pitchDelta: number) => void;
  onToggleSprint?: (sprinting: boolean) => void;
  onCraft?: () => void;
  onChat?: () => void;
  onJumpStart?: () => void;
  onJumpEnd?: () => void;
  onJumpLongPress?: () => void; // creative fly toggle
  onEat?: () => void; // long-press food slot to eat
}

export interface TouchController {
  dispose: () => void;
}

interface PointerState {
  active: boolean;
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
  moved: boolean;
}

const TAP_MAX_DIST = 8;
const TAP_MAX_TIME = 250;
const LONG_PRESS_TIME = 350;

// Shared style constants — uniform "modern glass" look across all controls.
const GLASS_BG = "rgba(20, 24, 32, 0.55)";
const GLASS_BG_ACTIVE = "rgba(40, 80, 130, 0.75)";
const GLASS_BORDER = "1.5px solid rgba(255, 255, 255, 0.18)";
const GLASS_SHADOW = "0 4px 14px rgba(0, 0, 0, 0.35)";
const GLASS_BLUR = "backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);";
const FONT_FAMILY = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export function createTouchControls(
  container: HTMLElement,
  input: InputState,
  hotbarSlots: number,
  callbacks: TouchControllerCallbacks
): TouchController {
  const ui = document.createElement("div");
  ui.className = "mc-touch-ui";
  // IMPORTANT: do NOT apply backdrop-filter to this full-screen parent
  // div — it would blur the entire game canvas behind it. Only individual
  // buttons (which cover a small area) get the glass blur effect.
  ui.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:20;touch-action:none;`;
  ui.innerHTML = `
    <!-- Left joystick zone (full bottom-left quadrant) -->
    <div class="mc-joystick-zone" style="position:absolute;left:0;bottom:0;width:50%;height:65%;pointer-events:auto;touch-action:none;">
      <div class="mc-joystick-base" style="position:absolute;left:60px;bottom:60px;width:120px;height:120px;border-radius:50%;background:${GLASS_BG};border:${GLASS_BORDER};box-shadow:${GLASS_SHADOW};pointer-events:none;opacity:0.55;transition:opacity 0.15s;"></div>
      <div class="mc-joystick-knob" style="position:absolute;left:100px;bottom:100px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.45);border:1.5px solid rgba(255,255,255,0.85);box-shadow:${GLASS_SHADOW};pointer-events:none;opacity:0.55;transition:opacity 0.15s;"></div>
    </div>

    <!-- Right interaction zone: look drag + tap-to-place + long-press-to-break -->
    <div class="mc-look-zone" style="position:absolute;right:0;top:0;width:50%;height:100%;pointer-events:auto;touch-action:none;"></div>

    <!-- CHAT button (top-center) -->
    <div style="position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:25;pointer-events:none;">
      <button class="mc-btn mc-chat" data-act="chat" style="
        width:72px;height:36px;border-radius:10px;
        background:${GLASS_BG};border:${GLASS_BORDER};
        box-shadow:${GLASS_SHADOW};color:rgba(255,255,255,0.95);
        font:600 12px ${FONT_FAMILY};letter-spacing:0.5px;
        pointer-events:auto;touch-action:none;cursor:pointer;${GLASS_BLUR}
      ">CHAT</button>
    </div>

    <!-- Right-side action cluster: JUMP (primary, larger) -->
    <div class="mc-actions" style="position:absolute;right:20px;bottom:104px;display:flex;flex-direction:column;gap:12px;pointer-events:none;">
      <button class="mc-btn mc-jump" data-act="jump" style="
        width:80px;height:80px;border-radius:50%;
        background:rgba(60, 110, 200, 0.55);border:1.5px solid rgba(180, 210, 255, 0.5);
        box-shadow:${GLASS_SHADOW};color:white;
        font:700 14px ${FONT_FAMILY};letter-spacing:1px;
        pointer-events:auto;touch-action:none;cursor:pointer;${GLASS_BLUR}
      ">JUMP</button>
    </div>

    <!-- Left-side action cluster: SPRINT + SNEAK (CRAFT is now in the hotbar) -->
    <div class="mc-move-actions" style="position:absolute;left:200px;bottom:108px;display:flex;flex-direction:column;gap:10px;pointer-events:none;">
      <button class="mc-btn mc-sprint" data-act="sprint" style="
        width:62px;height:48px;border-radius:12px;
        background:rgba(255, 180, 60, 0.45);border:1.5px solid rgba(255, 230, 180, 0.45);
        box-shadow:${GLASS_SHADOW};color:white;
        font:700 11px ${FONT_FAMILY};letter-spacing:0.8px;
        pointer-events:auto;touch-action:none;cursor:pointer;${GLASS_BLUR}
      ">SPRINT</button>
      <button class="mc-btn mc-sneak" data-act="sneak" style="
        width:62px;height:48px;border-radius:12px;
        background:rgba(120, 120, 140, 0.45);border:1.5px solid rgba(200, 200, 220, 0.45);
        box-shadow:${GLASS_SHADOW};color:white;
        font:700 11px ${FONT_FAMILY};letter-spacing:0.8px;
        pointer-events:auto;touch-action:none;cursor:pointer;${GLASS_BLUR}
      ">SNEAK</button>
    </div>

    <!-- Hotbar (bottom-center) — uniform glass panel, with CRAFT as 10th slot -->
    <div class="mc-hotbar" style="
      position:absolute;left:50%;bottom:20px;transform:translateX(-50%);
      display:flex;gap:6px;padding:6px;align-items:center;
      background:${GLASS_BG};border:${GLASS_BORDER};
      border-radius:12px;box-shadow:${GLASS_SHADOW};
      pointer-events:auto;touch-action:none;${GLASS_BLUR}
    "></div>
  `;
  container.appendChild(ui);

  // Populate hotbar
  const hotbarEl = ui.querySelector<HTMLElement>(".mc-hotbar")!;
  const slotEls: HTMLElement[] = [];
  for (let i = 0; i < hotbarSlots; i++) {
    const el = document.createElement("button");
    el.dataset.slot = String(i);
    const selected = i === 0;
    el.style.cssText =
      `width:48px;height:48px;border-radius:8px;padding:0;overflow:hidden;` +
      `border:${selected ? "2px solid rgba(180,210,255,0.95)" : "1.5px solid rgba(255,255,255,0.18)"};` +
      `background:rgba(0,0,0,0.35);position:relative;cursor:pointer;touch-action:none;transition:border-color 0.12s;`;
    const img = document.createElement("img");
    img.style.cssText = "width:100%;height:100%;display:block;image-rendering:pixelated;image-rendering:-moz-crisp-edges;image-rendering:crisp-edges;";
    img.draggable = false;
    el.appendChild(img);
    const badge = document.createElement("div");
    badge.textContent = String(i + 1);
    badge.style.cssText =
      `position:absolute;bottom:1px;right:3px;font:700 10px ${FONT_FAMILY};` +
      `color:white;text-shadow:0 0 2px black,0 0 2px black;pointer-events:none;`;
    el.appendChild(badge);
    // Item count badge (bottom-left) — shown when count > 1.
    const countBadge = document.createElement("div");
    countBadge.style.cssText =
      `position:absolute;bottom:1px;left:3px;font:700 11px ${FONT_FAMILY};` +
      `color:white;text-shadow:0 0 2px black,0 0 2px black;pointer-events:none;display:none;`;
    el.appendChild(countBadge);
    hotbarEl.appendChild(el);
    slotEls.push(el);
  }

  // 10th hotbar slot: CRAFT button (visually integrated into the hotbar
  // as the last slot, styled distinctly with a purple accent and a
  // separator gap before it).
  const craftSlot = document.createElement("button");
  craftSlot.dataset.act = "craft";
  craftSlot.style.cssText =
    `width:48px;height:48px;border-radius:8px;padding:0;overflow:hidden;` +
    `border:1.5px solid rgba(220, 200, 255, 0.5);` +
    `background:rgba(140, 90, 200, 0.55);position:relative;cursor:pointer;touch-action:none;` +
    `margin-left:6px;display:flex;align-items:center;justify-content:center;${GLASS_BLUR}`;
  // Craft icon — a simple grid/plus symbol drawn with CSS
  const craftIcon = document.createElement("div");
  craftIcon.style.cssText =
    `width:22px;height:22px;position:relative;`;
  craftIcon.innerHTML = `
    <div style="position:absolute;left:50%;top:0;width:3px;height:100%;background:white;border-radius:1px;transform:translateX(-50%);"></div>
    <div style="position:absolute;top:50%;left:0;height:3px;width:100%;background:white;border-radius:1px;transform:translateY(-50%);"></div>
  `;
  craftSlot.appendChild(craftIcon);
  hotbarEl.appendChild(craftSlot);

  (ui as unknown as { setHotbarIcon: (slot: number, dataUrl: string) => void }).setHotbarIcon = (slot: number, dataUrl: string) => {
    if (slotEls[slot]) {
      const img = slotEls[slot].querySelector("img");
      if (img) img.src = dataUrl;
    }
  };
  (ui as unknown as { setHotbarCount: (slot: number, count: number) => void }).setHotbarCount = (slot: number, count: number) => {
    if (slotEls[slot]) {
      const cb = slotEls[slot].querySelectorAll("div")[1] as HTMLElement | null;
      if (cb) {
        if (count > 1) {
          cb.textContent = String(count);
          cb.style.display = "block";
        } else {
          cb.style.display = "none";
        }
      }
    }
  };

  // ---- Joystick (left zone) ----
  const joystick: PointerState = { active: false, id: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, startTime: 0, moved: false };
  const look: PointerState = { active: false, id: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, startTime: 0, moved: false };
  const JOY_RADIUS = 50;
  const DEAD_ZONE = 12;

  const joystickZone = ui.querySelector<HTMLElement>(".mc-joystick-zone")!;
  const lookZone = ui.querySelector<HTMLElement>(".mc-look-zone")!;
  const knob = ui.querySelector<HTMLElement>(".mc-joystick-knob")!;
  const base = ui.querySelector<HTMLElement>(".mc-joystick-base")!;

  let longPressTimer: number | null = null;
  let isBreaking = false;

  const updateJoystickVisual = (dx: number, dy: number) => {
    const rect = joystickZone.getBoundingClientRect();
    const knobX = joystick.startX - rect.left + dx;
    const knobY = rect.bottom - joystick.startY - dy;
    knob.style.left = `${knobX - 20}px`;
    knob.style.bottom = `${knobY - 20}px`;
  };

  const resetJoystick = () => {
    const baseLeft = parseFloat(base.style.left) || 60;
    const baseBottom = parseFloat(base.style.bottom) || 60;
    knob.style.left = `${baseLeft + 60 - 20}px`;
    knob.style.bottom = `${baseBottom + 60 - 20}px`;
    input.forward = false;
    input.back = false;
    input.left = false;
    input.right = false;
  };

  const joyStart = (clientX: number, clientY: number, id: number) => {
    if (joystick.active) return;
    joystick.active = true;
    joystick.id = id;
    joystick.startX = clientX;
    joystick.startY = clientY;
    joystick.lastX = clientX;
    joystick.lastY = clientY;
    joystick.startTime = performance.now();
    joystick.moved = false;
    const rect = joystickZone.getBoundingClientRect();
    base.style.left = `${clientX - rect.left - 60}px`;
    base.style.bottom = `${rect.bottom - clientY - 60}px`;
    knob.style.left = `${clientX - rect.left - 20}px`;
    knob.style.bottom = `${rect.bottom - clientY - 20}px`;
    base.style.opacity = "1";
    knob.style.opacity = "1";
  };

  const joyMove = (clientX: number, clientY: number) => {
    if (!joystick.active) return;
    let dx = clientX - joystick.startX;
    let dy = clientY - joystick.startY;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS;
      dy = (dy / len) * JOY_RADIUS;
    }
    if (len > DEAD_ZONE) joystick.moved = true;
    updateJoystickVisual(dx, dy);
    input.forward = dy < -DEAD_ZONE;
    input.back = dy > DEAD_ZONE;
    input.left = dx < -DEAD_ZONE;
    input.right = dx > DEAD_ZONE;
  };

  const joyEnd = () => {
    joystick.active = false;
    joystick.id = -1;
    resetJoystick();
    base.style.opacity = "0.55";
    knob.style.opacity = "0.55";
  };

  // ---- Look zone: drag to look + tap to place + long-press to break ----
  const clearLongPressTimer = () => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const lookStart = (clientX: number, clientY: number, id: number) => {
    if (look.active) return;
    look.active = true;
    look.id = id;
    look.startX = clientX;
    look.startY = clientY;
    look.lastX = clientX;
    look.lastY = clientY;
    look.startTime = performance.now();
    look.moved = false;
    isBreaking = false;
    clearLongPressTimer();
    longPressTimer = window.setTimeout(() => {
      if (look.active && !look.moved) {
        isBreaking = true;
        callbacks.onBreakStart();
      }
    }, LONG_PRESS_TIME);
  };

  const lookMove = (clientX: number, clientY: number) => {
    if (!look.active) return;
    const dx = clientX - look.lastX;
    const dy = clientY - look.lastY;
    const totalDx = clientX - look.startX;
    const totalDy = clientY - look.startY;
    if (Math.hypot(totalDx, totalDy) > TAP_MAX_DIST) {
      look.moved = true;
      if (isBreaking) {
        isBreaking = false;
        callbacks.onBreakEnd();
      }
      clearLongPressTimer();
    }
    look.lastX = clientX;
    look.lastY = clientY;
    if (look.moved) {
      const sens = 0.004;
      callbacks.onLook(-dx * sens, -dy * sens);
    }
  };

  const lookEnd = () => {
    clearLongPressTimer();
    const elapsed = performance.now() - look.startTime;
    if (isBreaking) {
      callbacks.onBreakEnd();
      isBreaking = false;
    } else if (!look.moved && elapsed < TAP_MAX_TIME) {
      callbacks.onPlace();
    }
    look.active = false;
    look.id = -1;
  };

  // Touch listeners (joystick + look)
  const joyTouchStart = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    joyStart(t.clientX, t.clientY, t.identifier);
    e.preventDefault();
  };
  const joyTouchMove = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joystick.id) {
        joyMove(t.clientX, t.clientY);
        e.preventDefault();
        return;
      }
    }
  };
  const joyTouchEnd = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joystick.id) {
        joyEnd();
        e.preventDefault();
        return;
      }
    }
  };
  joystickZone.addEventListener("touchstart", joyTouchStart, { passive: false });
  joystickZone.addEventListener("touchmove", joyTouchMove, { passive: false });
  joystickZone.addEventListener("touchend", joyTouchEnd, { passive: false });
  joystickZone.addEventListener("touchcancel", joyTouchEnd, { passive: false });

  const lookTouchStart = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    lookStart(t.clientX, t.clientY, t.identifier);
    e.preventDefault();
  };
  const lookTouchMove = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === look.id) {
        lookMove(t.clientX, t.clientY);
        e.preventDefault();
        return;
      }
    }
  };
  const lookTouchEnd = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === look.id) {
        lookEnd();
        e.preventDefault();
        return;
      }
    }
  };
  lookZone.addEventListener("touchstart", lookTouchStart, { passive: false });
  lookZone.addEventListener("touchmove", lookTouchMove, { passive: false });
  lookZone.addEventListener("touchend", lookTouchEnd, { passive: false });
  lookZone.addEventListener("touchcancel", lookTouchEnd, { passive: false });

  // Mouse listeners (desktop)
  const joyMouseDown = (e: MouseEvent) => {
    if (joystick.active) return;
    joyStart(e.clientX, e.clientY, -1);
    e.preventDefault();
  };
  const joyMouseMove = (e: MouseEvent) => {
    if (joystick.active && joystick.id === -1) joyMove(e.clientX, e.clientY);
  };
  const joyMouseUp = () => {
    if (joystick.active && joystick.id === -1) joyEnd();
  };
  joystickZone.addEventListener("mousedown", joyMouseDown);
  window.addEventListener("mousemove", joyMouseMove);
  window.addEventListener("mouseup", joyMouseUp);

  const lookMouseDown = (e: MouseEvent) => {
    if (look.active) return;
    lookStart(e.clientX, e.clientY, -1);
    e.preventDefault();
  };
  const lookMouseMove = (e: MouseEvent) => {
    if (look.active && look.id === -1) lookMove(e.clientX, e.clientY);
  };
  const lookMouseUp = () => {
    if (look.active && look.id === -1) lookEnd();
  };
  lookZone.addEventListener("mousedown", lookMouseDown);
  window.addEventListener("mousemove", lookMouseMove);
  window.addEventListener("mouseup", lookMouseUp);

  // ---- JUMP / SPRINT / SNEAK / CRAFT / CHAT buttons ----
  const jumpBtn = ui.querySelector<HTMLElement>('.mc-btn[data-act="jump"]')!;
  const sprintBtn = ui.querySelector<HTMLElement>('.mc-btn[data-act="sprint"]')!;
  const sneakBtn = ui.querySelector<HTMLElement>('.mc-btn[data-act="sneak"]')!;
  const craftBtn = hotbarEl.querySelector<HTMLElement>('button[data-act="craft"]')!;
  const chatBtn = ui.querySelector<HTMLElement>('.mc-btn[data-act="chat"]')!;

  // Helper: visual press-down feedback — scale the button slightly while
  // pressed and add a brighter background. Returns a restore function.
  const pressFx = (el: HTMLElement, pressedBg: string) => {
    const orig = el.style.background;
    const origTrans = el.style.transform;
    el.style.background = pressedBg;
    el.style.transform = "translateY(1px) scale(0.97)";
    return () => {
      el.style.background = orig;
      el.style.transform = origTrans;
    };
  };

  const bindButton = (el: HTMLElement, onDown: () => void, onUp?: () => void) => {
    let restore: (() => void) | null = null;
    el.addEventListener("touchstart", (e) => {
      restore = pressFx(el, GLASS_BG_ACTIVE);
      onDown();
      e.preventDefault();
    }, { passive: false });
    el.addEventListener("touchend", (e) => {
      restore?.();
      onUp?.();
      e.preventDefault();
    }, { passive: false });
    el.addEventListener("touchcancel", (e) => {
      restore?.();
      onUp?.();
      e.preventDefault();
    }, { passive: false });
    el.addEventListener("mousedown", (e) => {
      restore = pressFx(el, GLASS_BG_ACTIVE);
      onDown();
      e.preventDefault();
    });
    if (onUp) {
      el.addEventListener("mouseup", (e) => { restore?.(); onUp(); e.preventDefault(); });
      el.addEventListener("mouseleave", () => { restore?.(); onUp(); });
    }
  };

  // JUMP: short press = jump (hold continuous), long press = creative fly toggle
  let jumpLongPressTimer: number | null = null;
  const JUMP_LONG_PRESS_TIME = 500;
  const startJump = () => {
    input.jump = true;
    callbacks.onJumpStart?.();
    clearJumpLongPress();
    jumpLongPressTimer = window.setTimeout(() => {
      callbacks.onJumpLongPress?.();
      jumpLongPressTimer = null;
    }, JUMP_LONG_PRESS_TIME);
  };
  const endJump = () => {
    input.jump = false;
    callbacks.onJumpEnd?.();
    clearJumpLongPress();
  };
  const clearJumpLongPress = () => {
    if (jumpLongPressTimer !== null) {
      clearTimeout(jumpLongPressTimer);
      jumpLongPressTimer = null;
    }
  };
  bindButton(jumpBtn, startJump, endJump);

  let sprinting = false;
  bindButton(sprintBtn, () => {
    sprinting = !sprinting;
    input.sprint = sprinting;
    // Active state: brighter background + glow + green status dot.
    if (sprinting) {
      sprintBtn.style.background = "rgba(255, 200, 60, 0.9)";
      sprintBtn.style.boxShadow = `0 0 16px rgba(255, 200, 60, 0.7), ${GLASS_SHADOW}`;
      sprintBtn.style.borderColor = "rgba(255, 240, 180, 0.95)";
      sprintBtn.style.color = "#fffbe6";
    } else {
      sprintBtn.style.background = "rgba(255, 180, 60, 0.45)";
      sprintBtn.style.boxShadow = GLASS_SHADOW;
      sprintBtn.style.borderColor = "rgba(255, 230, 180, 0.45)";
      sprintBtn.style.color = "white";
    }
    callbacks.onToggleSprint?.(sprinting);
  });

  // SNEAK: sticky toggle button. Tap once to start sneaking, tap again
  // to stop. Visual feedback: brighter background + glow while active.
  let sneaking = false;
  bindButton(sneakBtn, () => {
    sneaking = !sneaking;
    input.sneak = sneaking;
    if (sneaking) {
      sneakBtn.style.background = "rgba(160, 160, 200, 0.85)";
      sneakBtn.style.boxShadow = `0 0 12px rgba(160, 160, 200, 0.5), ${GLASS_SHADOW}`;
      sneakBtn.style.borderColor = "rgba(220, 220, 255, 0.9)";
    } else {
      sneakBtn.style.background = "rgba(120, 120, 140, 0.45)";
      sneakBtn.style.boxShadow = GLASS_SHADOW;
      sneakBtn.style.borderColor = "rgba(200, 200, 220, 0.45)";
    }
  });

  bindButton(craftBtn, () => callbacks.onCraft?.());
  bindButton(chatBtn, () => callbacks.onChat?.());

  // ---- Hotbar slot selection ----
  let slotLongPressTimer: number | null = null;
  const SLOT_LONG_PRESS_TIME = 500;
  const startSlotLongPress = (_slot: number) => {
    clearSlotLongPress();
    slotLongPressTimer = window.setTimeout(() => {
      callbacks.onEat?.();
      slotLongPressTimer = null;
    }, SLOT_LONG_PRESS_TIME);
  };
  const clearSlotLongPress = () => {
    if (slotLongPressTimer !== null) {
      clearTimeout(slotLongPressTimer);
      slotLongPressTimer = null;
    }
  };

  const onSlotTap = (e: Event) => {
    const target = e.target as HTMLElement;
    const slotEl = target.closest("[data-slot]") as HTMLElement | null;
    if (!slotEl) return;
    const slot = parseInt(slotEl.dataset.slot || "", 10);
    if (Number.isNaN(slot)) return;
    slotEls.forEach((el, i) => {
      el.style.border = i === slot
        ? "2px solid rgba(180,210,255,0.95)"
        : "1.5px solid rgba(255,255,255,0.18)";
    });
    callbacks.onSlotChange(slot);
    startSlotLongPress(slot);
    e.preventDefault();
  };
  const onSlotRelease = () => {
    clearSlotLongPress();
  };
  hotbarEl.addEventListener("touchstart", onSlotTap, { passive: false });
  hotbarEl.addEventListener("touchend", onSlotRelease, { passive: false });
  hotbarEl.addEventListener("touchcancel", onSlotRelease, { passive: false });
  hotbarEl.addEventListener("mousedown", onSlotTap);
  window.addEventListener("mouseup", onSlotRelease);

  // Public API for setting hotbar icons + counts
  (container as unknown as { __mcSetHotbarIcon?: (slot: number, dataUrl: string) => void }).__mcSetHotbarIcon = (slot: number, dataUrl: string) => {
    (ui as unknown as { setHotbarIcon: (slot: number, dataUrl: string) => void }).setHotbarIcon(slot, dataUrl);
  };
  (container as unknown as { __mcSetHotbarCount?: (slot: number, count: number) => void }).__mcSetHotbarCount = (slot: number, count: number) => {
    (ui as unknown as { setHotbarCount: (slot: number, count: number) => void }).setHotbarCount(slot, count);
  };

  return {
    dispose: () => {
      clearLongPressTimer();
      clearJumpLongPress();
      clearSlotLongPress();
      joystickZone.removeEventListener("touchstart", joyTouchStart);
      joystickZone.removeEventListener("touchmove", joyTouchMove);
      joystickZone.removeEventListener("touchend", joyTouchEnd);
      joystickZone.removeEventListener("touchcancel", joyTouchEnd);
      joystickZone.removeEventListener("mousedown", joyMouseDown);
      lookZone.removeEventListener("touchstart", lookTouchStart);
      lookZone.removeEventListener("touchmove", lookTouchMove);
      lookZone.removeEventListener("touchend", lookTouchEnd);
      lookZone.removeEventListener("touchcancel", lookTouchEnd);
      lookZone.removeEventListener("mousedown", lookMouseDown);
      window.removeEventListener("mousemove", joyMouseMove);
      window.removeEventListener("mouseup", joyMouseUp);
      window.removeEventListener("mousemove", lookMouseMove);
      window.removeEventListener("mouseup", lookMouseUp);
      hotbarEl.removeEventListener("touchstart", onSlotTap);
      hotbarEl.removeEventListener("touchend", onSlotRelease);
      hotbarEl.removeEventListener("touchcancel", onSlotRelease);
      hotbarEl.removeEventListener("mousedown", onSlotTap);
      window.removeEventListener("mouseup", onSlotRelease);
      delete (container as unknown as { __mcSetHotbarIcon?: unknown }).__mcSetHotbarIcon;
      delete (container as unknown as { __mcSetHotbarCount?: unknown }).__mcSetHotbarCount;
      container.removeChild(ui);
    },
  };
}
