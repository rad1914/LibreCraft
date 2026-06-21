// Touch controls for ALL devices. On touch hardware, real touch events
// drive the joystick/look/buttons. On desktop, mouse events are mapped
// to the same handlers.
//
// Layout:
//   - Left half of the screen: virtual movement joystick.
//   - Right half of the screen: look drag + tap-to-place + long-press-to-break.
//     A quick tap on the look zone places the selected block at the
//     raycast hit. A long press (hold without dragging) breaks the
//     targeted block.
//   - Bottom-left buttons: SPRINT toggle, JUMP (hold).
//   - Bottom-right button: CRAFT (opens unified inventory menu).
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
  moved: boolean; // true if the pointer moved beyond the tap threshold
}

const TAP_MAX_DIST = 8; // px — beyond this, it's a drag, not a tap
const TAP_MAX_TIME = 250; // ms — quick tap = place
const LONG_PRESS_TIME = 350; // ms — hold this long = break starts

export function createTouchControls(
  container: HTMLElement,
  input: InputState,
  hotbarSlots: number,
  callbacks: TouchControllerCallbacks
): TouchController {
  const ui = document.createElement("div");
  ui.className = "mc-touch-ui";
  ui.style.position = "absolute";
  ui.style.inset = "0";
  ui.style.pointerEvents = "none";
  ui.style.zIndex = "20";
  ui.style.touchAction = "none";
  ui.innerHTML = `
    <!-- Left joystick zone -->
    <div class="mc-joystick-zone" style="position:absolute; left:0; bottom:0; width:50%; height:65%; pointer-events:auto; touch-action:none;">
      <div class="mc-joystick-base" style="position:absolute; left:60px; bottom:60px; width:120px; height:120px; border-radius:50%; background:rgba(255,255,255,0.12); border:2px solid rgba(255,255,255,0.35); pointer-events:none; opacity:0.5;"></div>
      <div class="mc-joystick-knob" style="position:absolute; left:100px; bottom:100px; width:40px; height:40px; border-radius:50%; background:rgba(255,255,255,0.4); border:2px solid rgba(255,255,255,0.7); pointer-events:none; opacity:0.5;"></div>
    </div>

    <!-- Right interaction zone: look drag + tap-to-place + long-press-to-break -->
    <div class="mc-look-zone" style="position:absolute; right:0; top:0; width:50%; height:100%; pointer-events:auto; touch-action:none;"></div>

    <!-- CHAT button (top-center) -->
    <div style="position:absolute; left:50%; top:10px; transform:translateX(-50%); z-index:25; pointer-events:none;">
      <button class="mc-btn mc-chat" data-act="chat" style="width:68px; height:36px; border-radius:8px; background:rgba(40,150,150,0.6); border:2px solid rgba(255,255,255,0.7); color:white; font-weight:bold; pointer-events:auto; touch-action:none; font-size:12px; cursor:pointer;">CHAT</button>
    </div>

    <!-- Right-side buttons: JUMP only -->
    <div class="mc-actions" style="position:absolute; right:18px; bottom:110px; display:flex; flex-direction:column; gap:12px; pointer-events:none;">
      <button class="mc-btn mc-jump" data-act="jump" style="width:72px; height:72px; border-radius:50%; background:rgba(80,140,240,0.6); border:2px solid rgba(255,255,255,0.7); color:white; font-weight:bold; pointer-events:auto; touch-action:none; font-size:14px; cursor:pointer;">JUMP</button>
    </div>

    <!-- Sprint + Craft buttons (bottom-left, above joystick) -->
    <div class="mc-move-actions" style="position:absolute; left:200px; bottom:110px; display:flex; flex-direction:column; gap:12px; pointer-events:none;">
      <button class="mc-btn mc-craft" data-act="craft" style="width:56px; height:48px; border-radius:10px; background:rgba(140,90,200,0.65); border:2px solid rgba(255,255,255,0.7); color:white; font-weight:bold; pointer-events:auto; touch-action:none; font-size:11px; cursor:pointer;">CRAFT</button>
      <button class="mc-btn mc-sprint" data-act="sprint" style="width:56px; height:56px; border-radius:50%; background:rgba(255,200,60,0.55); border:2px solid rgba(255,255,255,0.7); color:white; font-weight:bold; pointer-events:auto; touch-action:none; font-size:11px; cursor:pointer;">SPRINT</button>
    </div>

    <!-- Hotbar (bottom-center) -->
    <div class="mc-hotbar" style="position:absolute; left:50%; bottom:18px; transform:translateX(-50%); display:flex; gap:5px; padding:5px; background:rgba(0,0,0,0.5); border-radius:8px; pointer-events:auto; touch-action:none;"></div>
  `;
  container.appendChild(ui);

  // Populate hotbar
  const hotbarEl = ui.querySelector<HTMLElement>(".mc-hotbar")!;
  const slotEls: HTMLElement[] = [];
  for (let i = 0; i < hotbarSlots; i++) {
    const el = document.createElement("button");
    el.dataset.slot = String(i);
    el.style.cssText =
      "width:48px;height:48px;border-radius:5px;padding:0;overflow:hidden;" +
      "border:" + (i === 0 ? "2px solid white" : "2px solid rgba(255,255,255,0.25)") + ";" +
      "background:rgba(0,0,0,0.4);position:relative;cursor:pointer;touch-action:none;";
    const img = document.createElement("img");
    img.style.cssText = "width:100%;height:100%;display:block;image-rendering:pixelated;image-rendering:-moz-crisp-edges;image-rendering:crisp-edges;";
    img.draggable = false;
    el.appendChild(img);
    const badge = document.createElement("div");
    badge.textContent = String(i + 1);
    badge.style.cssText =
      "position:absolute;bottom:1px;right:3px;font:bold 10px monospace;" +
      "color:white;text-shadow:0 0 2px black,0 0 2px black;pointer-events:none;";
    el.appendChild(badge);
    hotbarEl.appendChild(el);
    slotEls.push(el);
  }

  (ui as unknown as { setHotbarIcon: (slot: number, dataUrl: string) => void }).setHotbarIcon = (slot: number, dataUrl: string) => {
    if (slotEls[slot]) {
      const img = slotEls[slot].querySelector("img");
      if (img) img.src = dataUrl;
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

  // Long-press timer for breaking
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
    base.style.opacity = "0.5";
    knob.style.opacity = "0.5";
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
    // Start long-press timer; if the pointer doesn't move and isn't
    // released within LONG_PRESS_TIME, begin breaking.
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
    // Check if this is a drag (beyond tap threshold)
    const totalDx = clientX - look.startX;
    const totalDy = clientY - look.startY;
    if (Math.hypot(totalDx, totalDy) > TAP_MAX_DIST) {
      look.moved = true;
      // If we were breaking, cancel (the player is now dragging to look)
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
      // Quick tap → place block
      callbacks.onPlace();
    }
    look.active = false;
    look.id = -1;
  };

  // Touch listeners
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

  // ---- JUMP / SPRINT / CRAFT / CHAT buttons ----
  const jumpBtn = ui.querySelector<HTMLElement>('.mc-btn[data-act="jump"]')!;
  const sprintBtn = ui.querySelector<HTMLElement>('.mc-btn[data-act="sprint"]')!;
  const craftBtn = ui.querySelector<HTMLElement>('.mc-btn[data-act="craft"]')!;
  const chatBtn = ui.querySelector<HTMLElement>('.mc-btn[data-act="chat"]')!;

  const bindButton = (el: HTMLElement, onDown: () => void, onUp?: () => void) => {
    el.addEventListener("touchstart", (e) => { onDown(); e.preventDefault(); }, { passive: false });
    el.addEventListener("touchend", (e) => { onUp?.(); e.preventDefault(); }, { passive: false });
    el.addEventListener("touchcancel", (e) => { onUp?.(); e.preventDefault(); }, { passive: false });
    el.addEventListener("mousedown", (e) => { onDown(); e.preventDefault(); });
    if (onUp) {
      el.addEventListener("mouseup", (e) => { onUp(); e.preventDefault(); });
      el.addEventListener("mouseleave", () => onUp());
    }
  };

  // JUMP button: short press = jump (hold for continuous), long press = creative fly toggle
  let jumpLongPressTimer: number | null = null;
  const JUMP_LONG_PRESS_TIME = 500;
  const startJump = () => {
    input.jump = true;
    callbacks.onJumpStart?.();
    // Start long-press timer for creative fly
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
    sprintBtn.style.background = sprinting ? "rgba(255,200,60,0.9)" : "rgba(255,200,60,0.55)";
    callbacks.onToggleSprint?.(sprinting);
  });

  bindButton(craftBtn, () => callbacks.onCraft?.());
  bindButton(chatBtn, () => callbacks.onChat?.());

  // ---- Hotbar slot selection ----
  // Hotbar: tap to select, long-press to eat (if food is selected)
  let slotLongPressTimer: number | null = null;
  const SLOT_LONG_PRESS_TIME = 500;

  const startSlotLongPress = (slot: number) => {
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
        ? "2px solid white"
        : "2px solid rgba(255,255,255,0.25)";
    });
    callbacks.onSlotChange(slot);
    // Start long-press timer for eating
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

  // Public API for setting hotbar icons
  (container as unknown as { __mcSetHotbarIcon?: (slot: number, dataUrl: string) => void }).__mcSetHotbarIcon = (slot: number, dataUrl: string) => {
    (ui as unknown as { setHotbarIcon: (slot: number, dataUrl: string) => void }).setHotbarIcon(slot, dataUrl);
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
      container.removeChild(ui);
    },
  };
}
