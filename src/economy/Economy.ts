/**
 * Economía: comerciantes con inventario y dinero limitados que se reponen
 * cada mañana. Precios según valor base, reputación y habilidad de comercio.
 */
import type { EventBus } from '../core/EventBus';
import { Inventory, type Stack } from '../items/Inventory';
import { itemDef } from '../data/items';
import type { Reputation } from '../social/Reputation';
import type { Skills } from '../survival/Skills';

export interface TraderDef {
  npcId: string;
  village: string;
  stock: Stack[];
  coins: number;
  /** Categorías que compra (vacío = todo). */
  buys: string[];
}

export const TRADERS: TraderDef[] = [
  { npcId: 'lucia', village: 'robledo', coins: 220, buys: [], stock: [
    { id: 'bread', count: 6 }, { id: 'apple', count: 10 }, { id: 'cheese', count: 3 }, { id: 'torch', count: 5 },
    { id: 'arrow', count: 20 }, { id: 'waterskin_empty', count: 2 }, { id: 'bucket', count: 1 }, { id: 'herbs', count: 4 }, { id: 'firewood', count: 6 },
  ] },
  { npcId: 'bartolome', village: 'robledo', coins: 300, buys: ['weapon', 'tool', 'armor', 'ammo'], stock: [
    { id: 'sword', count: 1 }, { id: 'axe', count: 2 }, { id: 'knife', count: 2 }, { id: 'spear', count: 1 }, { id: 'shield', count: 1 }, { id: 'gambeson', count: 1 }, { id: 'arrow', count: 30 },
  ] },
  { npcId: 'ines', village: 'robledo', coins: 120, buys: ['food', 'drink'], stock: [
    { id: 'bread', count: 8 }, { id: 'cheese', count: 4 }, { id: 'wine', count: 6 }, { id: 'meat_cooked', count: 4 },
  ] },
  { npcId: 'nuno', village: 'robledo', coins: 120, buys: ['food'], stock: [
    { id: 'fish_raw', count: 6 }, { id: 'fish_cooked', count: 2 }, { id: 'fishing_rod', count: 2 },
  ] },
  { npcId: 'gonzalo', village: 'robledo', coins: 200, buys: ['resource', 'tool'], stock: [
    { id: 'plank', count: 20 }, { id: 'axe', count: 1 }, { id: 'pickaxe', count: 1 },
  ] },
  { npcId: 'elvira', village: 'robledo', coins: 80, buys: [], stock: [
    { id: 'bread', count: 12 }, { id: 'cheese', count: 2 },
  ] },
  { npcId: 'diego', village: 'robledo', coins: 90, buys: ['food'], stock: [
    { id: 'thatch', count: 30 }, { id: 'apple', count: 8 },
  ] },
  { npcId: 'gil', village: 'robledo', coins: 150, buys: ['resource', 'food', 'ammo'], stock: [
    { id: 'arrow', count: 25 }, { id: 'bow', count: 1 }, { id: 'meat_raw', count: 3 }, { id: 'knife', count: 1 },
  ] },
];

export interface Trader {
  def: TraderDef;
  inv: Inventory;
}

export class Economy {
  private traders = new Map<string, Trader>();

  constructor(private readonly bus: EventBus, private readonly rep: Reputation, private readonly skills: Skills, private readonly player: Inventory) {
    for (const d of TRADERS) this.traders.set(d.npcId, { def: d, inv: this.freshInv(d) });
  }

  private freshInv(d: TraderDef): Inventory {
    const inv = new Inventory(10000, 10000);
    for (const s of d.stock) inv.add(s.id, s.count);
    inv.coins = d.coins;
    return inv;
  }

  trader(npcId: string): Trader | undefined {
    return this.traders.get(npcId);
  }

  buyPrice(id: string, village: string): number {
    const base = itemDef(id).value;
    return Math.max(1, Math.round(base * this.rep.buyMultiplier(village) / this.skills.mul('trade')));
  }

  sellPrice(id: string, village: string): number {
    const base = itemDef(id).value;
    return Math.max(base > 0 ? 1 : 0, Math.floor(base * this.rep.sellFraction(village) * this.skills.mul('trade')));
  }

  priceNote(village: string): string {
    const t = this.rep.tier(village);
    return `Trato: ${t.toLowerCase()}`;
  }

  canTrade(npcId: string, village: string): { ok: boolean; reason?: string } {
    if (this.rep.get(village) <= -50) return { ok: false, reason: 'No quiere tratos contigo.' };
    return { ok: !!this.traders.get(npcId) };
  }

  buy(npcId: string, id: string): boolean {
    const t = this.traders.get(npcId);
    if (!t || !t.inv.has(id)) return false;
    const price = this.buyPrice(id, t.def.village);
    if (this.player.coins < price) return false;
    if (!this.player.canAdd(id, 1)) {
      this.bus.emit('notify', { text: 'No puedes cargar con más peso.', kind: 'warning' });
      return false;
    }
    this.player.coins -= price;
    t.inv.coins += price;
    t.inv.remove(id, 1);
    this.player.add(id, 1);
    this.skills.add('trade', 1);
    this.bus.emit('item:acquired', { itemId: id, count: 1, source: 'trade' });
    this.bus.emit('sfx', { id: 'coins' });
    return true;
  }

  sell(npcId: string, id: string): boolean {
    const t = this.traders.get(npcId);
    if (!t || !this.player.has(id)) return false;
    const d = itemDef(id);
    if (t.def.buys.length && !t.def.buys.includes(d.category)) {
      this.bus.emit('notify', { text: 'No le interesa eso.', kind: 'info' });
      return false;
    }
    const price = this.sellPrice(id, t.def.village);
    if (t.inv.coins < price) return false;
    this.player.remove(id, 1);
    t.inv.add(id, 1);
    t.inv.coins -= price;
    this.player.coins += price;
    this.skills.add('trade', 1);
    this.bus.emit('item:removed', { itemId: id, count: 1, reason: 'trade' });
    this.bus.emit('sfx', { id: 'coins' });
    // Comerciar genera algo de confianza.
    if (price >= 10) this.rep.change(t.def.village, 0.3, 'comercio');
    return true;
  }

  /** Cada mañana: reponen existencias hasta el stock base y recuperan algo de dinero. */
  restock(): void {
    for (const t of this.traders.values()) {
      for (const s of t.def.stock) {
        const have = t.inv.count(s.id);
        if (have < s.count) t.inv.add(s.id, Math.ceil((s.count - have) * 0.6));
      }
      if (t.inv.coins < t.def.coins) t.inv.coins = Math.round(t.inv.coins + (t.def.coins - t.inv.coins) * 0.5);
    }
  }

  serialize(): object {
    const out: Record<string, { stacks: Stack[]; coins: number }> = {};
    for (const [id, t] of this.traders) out[id] = t.inv.serialize();
    return out;
  }

  deserialize(d: Record<string, { stacks: Stack[]; coins: number }>): void {
    for (const [id, s] of Object.entries(d)) this.traders.get(id)?.inv.deserialize(s);
  }
}
