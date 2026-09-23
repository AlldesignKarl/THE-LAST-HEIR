/**
 * Contenedores persistentes (arcones, barriles, cadáveres saqueables).
 */
import { Inventory, type Stack } from './Inventory';

export interface Container {
  id: string;
  name: string;
  inv: Inventory;
  /** Pueblo propietario: sacar cosas a la vista es robo. null = libre. */
  owner: string | null;
}

export class Containers {
  readonly map = new Map<string, Container>();

  create(id: string, name: string, owner: string | null, contents: Stack[] = [], coins = 0): Container {
    const existing = this.map.get(id);
    if (existing) return existing;
    const inv = new Inventory(1000, 1000);
    for (const s of contents) inv.add(s.id, s.count);
    inv.coins = coins;
    const c = { id, name, inv, owner };
    this.map.set(id, c);
    return c;
  }

  get(id: string): Container | undefined {
    return this.map.get(id);
  }

  remove(id: string): void {
    this.map.delete(id);
  }

  serialize(): object {
    const out: Record<string, { name: string; owner: string | null; stacks: Stack[]; coins: number }> = {};
    for (const c of this.map.values()) out[c.id] = { name: c.name, owner: c.owner, ...c.inv.serialize() };
    return out;
  }

  deserialize(d: Record<string, { name: string; owner: string | null; stacks: Stack[]; coins: number }>): void {
    for (const [id, c] of Object.entries(d)) {
      const cont = this.create(id, c.name, c.owner);
      cont.inv.deserialize({ stacks: c.stacks, coins: c.coins });
    }
  }
}
