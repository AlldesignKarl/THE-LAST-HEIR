/**
 * Inventario por peso con pilas, monedas y equipo (lógica pura).
 */
import { ITEMS, itemDef } from '../data/items';

export interface Stack { id: string; count: number }

export type EquipSlot = 'main' | 'off' | 'head' | 'body';

export class Inventory {
  stacks: Stack[] = [];
  coins = 0;
  /** Peso que empieza a ralentizar. */
  maxWeight: number;
  /** Límite absoluto (no se puede coger más). */
  hardLimit: number;

  constructor(maxWeight = 30, hardLimit = 45) {
    this.maxWeight = maxWeight;
    this.hardLimit = hardLimit;
  }

  get weight(): number {
    let w = 0;
    for (const s of this.stacks) w += (ITEMS[s.id]?.weight ?? 0) * s.count;
    return Math.round(w * 100) / 100;
  }

  get overEncumbered(): boolean {
    return this.weight > this.maxWeight;
  }

  count(id: string): number {
    let c = 0;
    for (const s of this.stacks) if (s.id === id) c += s.count;
    return c;
  }

  has(id: string, n = 1): boolean {
    return this.count(id) >= n;
  }

  /** ¿Cabe (por peso) esta cantidad? */
  canAdd(id: string, n = 1): boolean {
    const d = itemDef(id);
    if (d.heavy) return false;
    return this.weight + d.weight * n <= this.hardLimit + 1e-6;
  }

  /** Añade hasta `n`; devuelve cuántos se añadieron. */
  add(id: string, n = 1): number {
    const d = itemDef(id);
    if (d.heavy || n <= 0) return 0;
    let room = d.weight > 0 ? Math.floor((this.hardLimit - this.weight + 1e-6) / d.weight) : n;
    let left = Math.min(n, Math.max(0, room));
    const added = left;
    for (const s of this.stacks) {
      if (left <= 0) break;
      if (s.id !== id || s.count >= d.stack) continue;
      const put = Math.min(left, d.stack - s.count);
      s.count += put;
      left -= put;
    }
    while (left > 0) {
      const put = Math.min(left, d.stack);
      this.stacks.push({ id, count: put });
      left -= put;
    }
    room = 0;
    return added;
  }

  /** Quita hasta `n`; devuelve cuántos se quitaron. */
  remove(id: string, n = 1): number {
    let left = n;
    for (let i = this.stacks.length - 1; i >= 0 && left > 0; i--) {
      const s = this.stacks[i];
      if (s.id !== id) continue;
      const take = Math.min(left, s.count);
      s.count -= take;
      left -= take;
      if (s.count <= 0) this.stacks.splice(i, 1);
    }
    return n - left;
  }

  /** Lista agrupada por id (para la UI). */
  grouped(): { id: string; count: number }[] {
    const m = new Map<string, number>();
    for (const s of this.stacks) m.set(s.id, (m.get(s.id) ?? 0) + s.count);
    return [...m.entries()].map(([id, count]) => ({ id, count }));
  }

  serialize(): { stacks: Stack[]; coins: number } {
    return { stacks: this.stacks.map((s) => ({ ...s })), coins: this.coins };
  }

  deserialize(d: { stacks: Stack[]; coins: number }): void {
    this.stacks = d.stacks.filter((s) => ITEMS[s.id]).map((s) => ({ ...s }));
    this.coins = d.coins;
  }
}

/** Equipo del jugador: referencias a ids de objetos que están en el inventario. */
export class Equipment {
  slots: Record<EquipSlot, string | null> = { main: null, off: null, head: null, body: null };
  quick: (string | null)[] = [null, null, null, null];
  /** Antorcha encendida en la mano izquierda. */
  torchLit = false;

  constructor(private readonly inv: Inventory) {}

  /** Quita del equipo lo que ya no está en el inventario. */
  validate(): void {
    for (const k of Object.keys(this.slots) as EquipSlot[]) {
      const id = this.slots[k];
      if (id && !this.inv.has(id)) this.slots[k] = null;
    }
    if (this.slots.off !== 'torch') this.torchLit = false;
    for (let i = 0; i < 4; i++) if (this.quick[i] && !this.inv.has(this.quick[i]!)) this.quick[i] = null;
  }

  equip(id: string): EquipSlot | null {
    const d = itemDef(id);
    if (!this.inv.has(id)) return null;
    if (d.weapon) {
      this.slots.main = id;
      if (d.weapon === 'bow' || d.weapon === 'spear') {
        this.slots.off = null; // a dos manos
        this.torchLit = false;
      }
      this.autoQuick(id);
      return 'main';
    }
    if (d.offhand) {
      const main = this.slots.main ? itemDef(this.slots.main) : null;
      if (main && (main.weapon === 'bow' || main.weapon === 'spear')) this.slots.main = null;
      this.slots.off = id;
      if (id === 'torch') this.torchLit = true;
      return 'off';
    }
    if (d.armor) {
      this.slots[d.armor.slot] = id;
      return d.armor.slot;
    }
    return null;
  }

  unequip(slot: EquipSlot): void {
    this.slots[slot] = null;
    if (slot === 'off') this.torchLit = false;
  }

  private autoQuick(id: string): void {
    if (this.quick.includes(id)) return;
    const free = this.quick.indexOf(null);
    if (free >= 0) this.quick[free] = id;
  }

  armorValues(): { slash: number; blunt: number; pierce: number; warmth: number } {
    const r = { slash: 0, blunt: 0, pierce: 0, warmth: 0 };
    for (const k of ['head', 'body'] as EquipSlot[]) {
      const id = this.slots[k];
      const a = id ? itemDef(id).armor : undefined;
      if (a) { r.slash += a.slash; r.blunt += a.blunt; r.pierce += a.pierce; r.warmth += a.warmth; }
    }
    return r;
  }

  serialize(): object {
    return { slots: { ...this.slots }, quick: [...this.quick], torchLit: this.torchLit };
  }

  deserialize(d: { slots: Record<EquipSlot, string | null>; quick: (string | null)[]; torchLit: boolean }): void {
    this.slots = { ...d.slots };
    this.quick = [...d.quick];
    this.torchLit = d.torchLit;
    this.validate();
  }
}
