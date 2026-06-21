// Simplified inventory: a single ordered list of (blockId, count) slots.
// The first 9 slots ARE the hotbar — there's no separate hotbar array.
// The player starts empty and collects everything by breaking blocks.
// Crafting draws from and deposits into the same list.

import { BlockType } from "./blocks";

export interface InvSlot {
  id: number;   // BlockType.AIR = empty slot
  count: number;
}

const HOTBAR_SIZE = 9;
const MAIN_SIZE = 18; // main inventory rows
const TOTAL_SIZE = HOTBAR_SIZE + MAIN_SIZE; // 27 slots total

export class Inventory {
  // Flat array; indices 0..8 are hotbar, 9..26 are main inventory.
  slots: InvSlot[] = [];
  selected = 0; // selected hotbar slot index (0..8)

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

  // Move a block type into the selected hotbar slot (from main inventory
  // or by swapping). Used by the inventory UI.
  setSelectedBlock(id: number) {
    if (this.selected < 0 || this.selected >= HOTBAR_SIZE) return;
    this.slots[this.selected] = { id, count: id === BlockType.AIR ? 0 : 1 };
  }

  selectSlot(i: number) {
    if (i >= 0 && i < HOTBAR_SIZE) this.selected = i;
  }

  // Flat snapshot for React rendering.
  list(): InvSlot[] {
    return this.slots.map((s) => ({ ...s }));
  }
}
