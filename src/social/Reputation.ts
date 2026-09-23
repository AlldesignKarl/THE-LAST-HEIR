/**
 * Reputación independiente por pueblo (-100..100) (GDD 4.6).
 * Escucha delitos y actos del jugador; afecta precios, información y
 * actitud de guardias.
 */
import type { EventBus } from '../core/EventBus';
import { clamp } from '../core/math';

export interface VillageRep {
  id: string;
  name: string;
  value: number;
  /** Segundos durante los que los guardias persiguen al jugador. */
  wanted: number;
}

export const TIERS: [number, string][] = [
  [-50, 'Hostil'], [-15, 'Desconfiado'], [20, 'Neutral'], [55, 'De confianza'], [101, 'Honrado'],
];

export function tierName(v: number): string {
  for (const [lim, name] of TIERS) if (v < lim) return name;
  return 'Honrado';
}

const NOTES: Record<string, string> = {
  Hostil: 'Te cierran las puertas. Los guardias te atacarán.',
  Desconfiado: 'Precios altos y pocas palabras.',
  Neutral: 'Te tratan como a uno más.',
  'De confianza': 'Mejores precios; algunos te cuentan lo que saben.',
  Honrado: 'Eres uno de los suyos. Te confían secretos y lo mejor del mercado.',
};

export class Reputation {
  readonly villages = new Map<string, VillageRep>();

  constructor(private readonly bus: EventBus | null) {
    this.villages.set('robledo', { id: 'robledo', name: 'Robledo', value: 5, wanted: 0 });
    bus?.on('crime', (c) => {
      if (!c.witnessed) return;
      const delta = c.type === 'theft' ? -8 : c.type === 'assault' ? -15 : c.type === 'murder' ? -45 : -10;
      this.change(c.village, delta, c.type === 'theft' ? 'robo' : c.type === 'assault' ? 'agresión' : c.type === 'murder' ? 'asesinato' : 'ganado');
      const v = this.villages.get(c.village);
      if (v && c.type !== 'theft') v.wanted = Math.max(v.wanted, c.type === 'murder' ? 600 : 90);
      if (v && c.type === 'theft' && v.value < -15) v.wanted = Math.max(v.wanted, 45);
    });
  }

  get(village: string): number {
    return this.villages.get(village)?.value ?? 0;
  }

  change(village: string, delta: number, reason: string): void {
    const v = this.villages.get(village);
    if (!v) return;
    v.value = clamp(v.value + delta, -100, 100);
    this.bus?.emit('reputation:changed', { village, delta, value: v.value, reason });
    if (Math.abs(delta) >= 1) {
      this.bus?.emit('notify', { text: `${v.name}: reputación ${delta > 0 ? '+' : ''}${Math.round(delta)} (${reason})`, kind: delta > 0 ? 'info' : 'warning' });
    }
  }

  tier(village: string): string {
    return tierName(this.get(village));
  }

  /** Los guardias del pueblo deben atacar al jugador. */
  hostile(village: string): boolean {
    const v = this.villages.get(village);
    return !!v && (v.value <= -50 || v.wanted > 0);
  }

  /** Multiplicador de precio de compra (el jugador paga). */
  buyMultiplier(village: string): number {
    const v = this.get(village);
    return clamp(1.25 - v * 0.004, 0.85, 1.65);
  }

  /** Fracción del valor que el comerciante paga al jugador. */
  sellFraction(village: string): number {
    const v = this.get(village);
    return clamp(0.45 + v * 0.0025, 0.3, 0.65);
  }

  update(dt: number): void {
    for (const v of this.villages.values()) if (v.wanted > 0) v.wanted = Math.max(0, v.wanted - dt);
  }

  all(): { id: string; name: string; value: number; tier: string; note: string }[] {
    return [...this.villages.values()].map((v) => ({ id: v.id, name: v.name, value: v.value, tier: tierName(v.value), note: NOTES[tierName(v.value)] }));
  }

  serialize(): object {
    return { villages: [...this.villages.values()].map((v) => ({ ...v })) };
  }

  deserialize(d: { villages: VillageRep[] }): void {
    for (const v of d.villages) this.villages.set(v.id, { ...v });
  }
}
