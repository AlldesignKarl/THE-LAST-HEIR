/**
 * Habilidades que mejoran con el uso (no hay puntos que repartir).
 * Efectos pequeños y creíbles (GDD: "sin RPG exagerado").
 */
import type { EventBus } from '../core/EventBus';

export type SkillId = 'combat' | 'archery' | 'survival' | 'hunting' | 'trade';

const NAMES: Record<SkillId, string> = { combat: 'Combate', archery: 'Tiro con arco', survival: 'Supervivencia', hunting: 'Caza', trade: 'Comercio' };

export class Skills {
  xp: Record<SkillId, number> = { combat: 0, archery: 0, survival: 0, hunting: 0, trade: 0 };

  constructor(private readonly bus: EventBus | null) {}

  /** Nivel 0..10 con curva decreciente. */
  level(s: SkillId): number {
    return Math.min(10, Math.floor(Math.sqrt(this.xp[s] / 12)));
  }

  add(s: SkillId, amount: number): void {
    const before = this.level(s);
    this.xp[s] += amount;
    const after = this.level(s);
    if (after > before) this.bus?.emit('notify', { text: `${NAMES[s]} mejora (${after})`, kind: 'info' });
  }

  /** Multiplicador genérico: +3 % por nivel. */
  mul(s: SkillId): number {
    return 1 + this.level(s) * 0.03;
  }

  summary(): string {
    return (Object.keys(NAMES) as SkillId[]).map((s) => `${NAMES[s]} ${this.level(s)}`).join(' · ');
  }

  serialize(): object {
    return { ...this.xp };
  }

  deserialize(d: Partial<Record<SkillId, number>>): void {
    for (const k of Object.keys(this.xp) as SkillId[]) this.xp[k] = d[k] ?? 0;
  }
}
