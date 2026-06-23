// Simplified inventory: a single ordered list of (blockId, count) slots.
// The first 9 slots ARE the hotbar — there's no separate hotbar array.
// The player starts empty and collects everything by breaking blocks.
// Crafting draws from and deposits into the same list.
//
// In addition to the main slots, there's a dedicated "offhand" slot
// (slot -1) that only accepts TORCH or SWORD. It appears in the hotbar
// UI when the inventory is open. While a torch is in the offhand slot,
// the player gets dynamic walking light; while a sword is there, the
// player deals bonus attack damage.

import { BlockType } from "./blocks";

export interface InvSlot {
  id: number;   // BlockType.AIR = empty slot
  count: number;
}

export const HOTBAR_SIZE = 9;
const MAIN_SIZE = 18; // main inventory rows
const TOTAL_SIZE = HOTBAR_SIZE + MAIN_SIZE; // 27 slots total

// The offhand slot only accepts these item types.
export const OFFHAND_ALLOWED = new Set<number>([BlockType.TORCH, BlockType.SWORD]);

export class Inventory {
  // Flat array; indices 0..8 are hotbar, 9..26 are main inventory.
  slots: InvSlot[] = [];
  selected = 0; // selected hotbar slot index (0..8)
  // Offhand slot — a dedicated slot (separate from the main grid) that
  // only holds a torch or sword. Used for dynamic torch lighting and
  // sword damage bonus.
  offhand: InvSlot = { id: BlockType.AIR, count: 0 };

  constructor() {
    for (let i = 0; i < TOTAL_SIZE; i++) this.slots.push({ id: BlockType.AIR, count: 0 });
  }

  // Add n of blockId. Fills existing stacks first, then empty slots.
  // Returns the number that couldn't be added (0 = all added).
  add(id: number, n: number = 1): number {
    if (id === BlockType.AIR || n <= 0) return 0;
    // First pass: fill existing stacks of the same id (up to 64 each).
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      const s = this.slots[i];
      if (s.id === id && s.count < 64) {
        const add = Math.min(64 - s.count, n);
        s.count += add;
        n -= add;
      }
    }
    // Second pass: fill empty slots.
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      const s = this.slots[i];
      if (s.id === BlockType.AIR) {
        const add = Math.min(64, n);
        s.id = id;
        s.count = add;
        n -= add;
      }
    }
    return n; // leftover (0 if all added)
  }

  // Remove n of blockId from anywhere in the inventory.
  // Returns true if successful, false if not enough.
  remove(id: number, n: number = 1): boolean {
    if (this.count(id) < n) return false;
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      const s = this.slots[i];
      if (s.id === id) {
        const take = Math.min(s.count, n);
        s.count -= take;
        n -= take;
        if (s.count === 0) s.id = BlockType.AIR;
      }
    }
    return true;
  }

  count(id: number): number {
    let total = 0;
    for (const s of this.slots) if (s.id === id) total += s.count;
    return total;
  }

  has(id: number, n: number = 1): boolean {
    return this.count(id) >= n;
  }

  // The block the player will place (from the selected hotbar slot).
  // Returns BlockType.AIR if the slot is empty.
  getSelectedBlock(): number {
    return this.slots[this.selected]?.id ?? BlockType.AIR;
  }

  // Check if the selected slot has items (count > 0 and non-AIR).
  hasSelected(): boolean {
    const s = this.slots[this.selected];
    return s && s.id !== BlockType.AIR && s.count > 0;
  }

  // Consume 1 item from the selected hotbar slot. Returns the item id
  // that was consumed, or BlockType.AIR if the slot was empty.
  // Decrements count; when count hits 0, the slot is cleared to AIR.
  consumeSelected(): number {
    const s = this.slots[this.selected];
    if (!s || s.id === BlockType.AIR || s.count <= 0) return BlockType.AIR;
    const id = s.id;
    s.count--;
    if (s.count <= 0) {
      s.id = BlockType.AIR;
      s.count = 0;
    }
    return id;
  }

  selectSlot(i: number) {
    if (i >= 0 && i < HOTBAR_SIZE) this.selected = i;
  }

  // Flat snapshot for React rendering.
  list(): InvSlot[] {
    return this.slots.map((s) => ({ ...s }));
  }

  // --- Offhand slot (slot -1) ---
  // Returns the item id in the offhand slot, or AIR if empty.
  getOffhand(): number { return this.offhand.id; }

  // Try to move an item from main slot `index` to the offhand slot.
  // Only succeeds if the item is TORCH or SWORD. Returns true on success.
  moveToOffhand(index: number): boolean {
    if (index < 0 || index >= this.slots.length) return false;
    const s = this.slots[index];
    if (s.id === BlockType.AIR || s.count <= 0) return false;
    if (!OFFHAND_ALLOWED.has(s.id)) return false;
    // If offhand is empty, move the whole stack. If offhand has the same
    // id, merge (up to 64). Otherwise, swap.
    if (this.offhand.id === BlockType.AIR) {
      this.offhand = { id: s.id, count: s.count };
      s.id = BlockType.AIR;
      s.count = 0;
      return true;
    }
    if (this.offhand.id === s.id && this.offhand.count < 64) {
      const space = 64 - this.offhand.count;
      const move = Math.min(space, s.count);
      this.offhand.count += move;
      s.count -= move;
      if (s.count <= 0) { s.id = BlockType.AIR; s.count = 0; }
      return true;
    }
    // Swap
    const tmp = this.offhand;
    this.offhand = { id: s.id, count: s.count };
    s.id = tmp.id;
    s.count = tmp.count;
    return true;
  }

  // Move the offhand item back to the first empty main slot. Returns
  // true on success.
  moveOffhandToMain(): boolean {
    if (this.offhand.id === BlockType.AIR || this.offhand.count <= 0) return false;
    // Try to add to main inventory.
    const leftover = this.add(this.offhand.id, this.offhand.count);
    if (leftover === 0) {
      this.offhand = { id: BlockType.AIR, count: 0 };
      return true;
    }
    // Partial — keep what didn't fit.
    this.offhand.count = leftover;
    return true;
  }
}
