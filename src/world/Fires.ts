/**
 * Fuegos del mundo: antorchas, hogares, hogueras, fraguas e incendios.
 * Cada fuego = luz del pool + emisores de partículas + calor + (opcional)
 * cocina. Políticas de encendido según hora y ocupación: el pueblo
 * enciende sus antorchas al anochecer aunque el jugador no mire.
 */
import * as THREE from 'three';
import type { LightPool } from '../engine/LightPool';
import type { Particles } from '../engine/Particles';

export type FireKind = 'torch' | 'hearth' | 'campfire' | 'forge' | 'candle' | 'blaze';
export type FirePolicy = 'night' | 'evening' | 'work' | 'always' | 'manual';

export interface Fire {
  id: string;
  kind: FireKind;
  pos: THREE.Vector3;
  policy: FirePolicy;
  lit: boolean;
  /** Horas de combustible restantes (solo 'manual'). */
  fuel: number;
  /** Condición externa (p.ej. el dueño vive / está en casa). */
  condition?: () => boolean;
  canCook: boolean;
  heat: number;
  /** Sale humo por aquí (chimenea). */
  smokePos?: THREE.Vector3;
  /** Fuego no visible (hogar de una casa cerrada): solo humo de chimenea. */
  hidden?: boolean;
}

const LIGHT: Record<FireKind, { color: number; intensity: number; range: number; flicker: number; rate: number; size: number; spread: number }> = {
  torch: { color: 0xff8a3a, intensity: 55, range: 16, flicker: 0.5, rate: 14, size: 0.55, spread: 0.08 },
  hearth: { color: 0xff7a30, intensity: 40, range: 11, flicker: 0.45, rate: 18, size: 0.8, spread: 0.35 },
  campfire: { color: 0xff7a30, intensity: 90, range: 20, flicker: 0.5, rate: 28, size: 1.0, spread: 0.45 },
  forge: { color: 0xff5a20, intensity: 50, range: 12, flicker: 0.3, rate: 16, size: 0.7, spread: 0.4 },
  candle: { color: 0xffb060, intensity: 6, range: 6, flicker: 0.25, rate: 3, size: 0.15, spread: 0.01 },
  blaze: { color: 0xff6a20, intensity: 220, range: 30, flicker: 0.6, rate: 60, size: 2.2, spread: 2.2 },
};

export class Fires {
  readonly fires = new Map<string, Fire>();

  constructor(private readonly lights: LightPool, private readonly particles: Particles) {}

  add(f: Omit<Fire, 'lit' | 'fuel'> & { lit?: boolean; fuel?: number }): Fire {
    const fire: Fire = { lit: false, fuel: 0, ...f };
    this.fires.set(fire.id, fire);
    const L = LIGHT[fire.kind];
    if (fire.hidden) {
      this.particles.addEmitter({ id: `smoke:${fire.id}`, kind: 'smoke', pos: (fire.smokePos ?? fire.pos).clone(), rate: 3, spread: 0.3, vel: new THREE.Vector3(0.25, 1.1, 0), sizeMul: 1.1, enabled: fire.lit });
      return fire;
    }
    this.lights.add({
      id: `fire:${fire.id}`, pos: fire.pos.clone().add(new THREE.Vector3(0, fire.kind === 'torch' ? 0.15 : 0.5, 0)),
      color: new THREE.Color(L.color), intensity: L.intensity, range: L.range, flicker: L.flicker,
      priority: fire.kind === 'blaze' ? 3 : fire.kind === 'candle' ? 0.3 : 1, enabled: fire.lit,
    });
    this.particles.addEmitter({ id: `fire:${fire.id}`, kind: 'fire', pos: fire.pos.clone(), rate: L.rate, spread: L.spread, vel: new THREE.Vector3(0, 1.1, 0), sizeMul: L.size, enabled: fire.lit });
    if (fire.kind !== 'candle') {
      this.particles.addEmitter({ id: `ember:${fire.id}`, kind: 'ember', pos: fire.pos.clone(), rate: L.rate * 0.15, spread: L.spread, vel: new THREE.Vector3(0, 1.8, 0), sizeMul: 1, enabled: fire.lit });
      const sp = fire.smokePos ?? fire.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
      this.particles.addEmitter({ id: `smoke:${fire.id}`, kind: 'smoke', pos: sp, rate: fire.kind === 'torch' ? 1.5 : fire.kind === 'blaze' ? 14 : 4, spread: L.spread + 0.2, vel: new THREE.Vector3(0.2, 1.0, 0), sizeMul: fire.kind === 'blaze' ? 3 : 1, enabled: fire.lit });
    }
    return fire;
  }

  remove(id: string): void {
    this.fires.delete(id);
    this.lights.remove(`fire:${id}`);
    this.particles.removeEmitter(`fire:${id}`);
    this.particles.removeEmitter(`ember:${id}`);
    this.particles.removeEmitter(`smoke:${id}`);
  }

  setLit(id: string, lit: boolean): void {
    const f = this.fires.get(id);
    if (!f) return;
    f.lit = lit;
    this.applyVisual(f);
  }

  private applyVisual(f: Fire): void {
    const l = this.lights.get(`fire:${f.id}`);
    if (l) l.enabled = f.lit;
    for (const p of ['fire', 'ember', 'smoke']) {
      const e = this.particles.emitters.get(`${p}:${f.id}`);
      if (e) e.enabled = f.lit;
    }
  }

  /** Actualiza políticas de encendido. `gameMinutes` consume combustible. */
  update(hour: number, gameMinutes: number): void {
    for (const f of this.fires.values()) {
      let want = f.lit;
      const cond = f.condition ? f.condition() : true;
      switch (f.policy) {
        case 'night': want = cond && (hour >= 19.3 || hour < 6.6); break;
        case 'evening': want = cond && ((hour >= 5.5 && hour < 8.5) || (hour >= 18 && hour < 23)); break;
        case 'work': want = cond && hour >= 7.5 && hour < 18.5; break;
        case 'always': want = cond; break;
        case 'manual':
          if (f.lit) {
            f.fuel -= gameMinutes / 60;
            if (f.fuel <= 0) { f.fuel = 0; want = false; }
          }
          break;
      }
      if (want !== f.lit) {
        f.lit = want;
        this.applyVisual(f);
      }
    }
  }

  /** Calor (°C) aportado por fuegos encendidos cercanos. */
  heatAt(p: THREE.Vector3): number {
    let h = 0;
    for (const f of this.fires.values()) {
      if (!f.lit || f.heat <= 0) continue;
      const d = f.pos.distanceTo(p);
      if (d < 6) h = Math.max(h, f.heat * (1 - d / 6));
    }
    return h;
  }

  nearestCookFire(p: THREE.Vector3, maxDist = 2.5): Fire | null {
    let best: Fire | null = null, bd = maxDist;
    for (const f of this.fires.values()) {
      if (!f.lit || !f.canCook) continue;
      const d = f.pos.distanceTo(p);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  serialize(): object {
    const manual: { id: string; lit: boolean; fuel: number }[] = [];
    for (const f of this.fires.values()) if (f.policy === 'manual') manual.push({ id: f.id, lit: f.lit, fuel: f.fuel });
    return { manual };
  }

  deserialize(d: { manual: { id: string; lit: boolean; fuel: number }[] }): void {
    for (const m of d.manual) {
      const f = this.fires.get(m.id);
      if (!f) continue;
      f.fuel = m.fuel;
      f.lit = m.lit;
      this.applyVisual(f);
    }
  }
}
