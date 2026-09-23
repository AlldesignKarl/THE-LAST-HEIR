import type { EventBus } from './EventBus';

/** Banderas de estado del mundo/historia (persistentes). */
export class Flags {
  private set_ = new Set<string>();
  private values = new Map<string, number>();

  constructor(private readonly bus: EventBus | null) {}

  has(f: string): boolean {
    return this.set_.has(f);
  }

  set(f: string): void {
    if (this.set_.has(f)) return;
    this.set_.add(f);
    this.bus?.emit('flag:set', { flag: f });
  }

  clear(f: string): void {
    this.set_.delete(f);
  }

  /** Contadores/valores numéricos (p.ej. día de un suceso). */
  num(k: string, def = 0): number {
    return this.values.get(k) ?? def;
  }

  setNum(k: string, v: number): void {
    this.values.set(k, v);
  }

  serialize(): object {
    return { flags: [...this.set_], values: [...this.values.entries()] };
  }

  deserialize(d: { flags: string[]; values: [string, number][] }): void {
    this.set_ = new Set(d.flags);
    this.values = new Map(d.values ?? []);
  }
}
