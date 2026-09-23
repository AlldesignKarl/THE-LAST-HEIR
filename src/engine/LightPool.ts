/**
 * Pool de luces dinámicas (ADR-006). Hay muchas fuentes (antorchas,
 * hogueras, ventanas, fuegos), pero solo N PointLights reales asignadas a
 * las más relevantes para la cámara. El resto se ve por su halo emisivo.
 */
import * as THREE from 'three';

export interface LightSource {
  id: string;
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  range: number;
  flicker: number;
  /** Prioridad (antorcha del jugador = alta). */
  priority: number;
  enabled: boolean;
  /** Intensidad actual (fade). */
  current: number;
}

export class LightPool {
  private lights: THREE.PointLight[] = [];
  private assigned: (LightSource | null)[] = [];
  readonly sources = new Map<string, LightSource>();
  private frame = 0;
  private t = 0;

  constructor(scene: THREE.Scene, readonly size = 8) {
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 12, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
      this.assigned.push(null);
    }
  }

  add(src: Omit<LightSource, 'current'>): LightSource {
    const s = { ...src, current: 0 };
    this.sources.set(s.id, s);
    return s;
  }

  remove(id: string): void {
    this.sources.delete(id);
  }

  get(id: string): LightSource | undefined {
    return this.sources.get(id);
  }

  update(dt: number, cam: THREE.Vector3): void {
    this.t += dt;
    // Fade de cada fuente.
    for (const s of this.sources.values()) {
      const target = s.enabled ? 1 : 0;
      s.current += Math.sign(target - s.current) * Math.min(Math.abs(target - s.current), dt * 2.5);
    }
    // Reasignar cada 4 frames.
    if (this.frame++ % 4 === 0) {
      const cands: { s: LightSource; score: number }[] = [];
      for (const s of this.sources.values()) {
        if (s.current <= 0.01) continue;
        const d = s.pos.distanceTo(cam);
        if (d > s.range * 5 + 25) continue;
        cands.push({ s, score: (s.priority * s.intensity) / (1 + d * d * 0.02) });
      }
      cands.sort((a, b) => b.score - a.score);
      const chosen = new Set(cands.slice(0, this.size).map((c) => c.s));
      // Mantener asignaciones estables para evitar parpadeos.
      for (let i = 0; i < this.size; i++) {
        const a = this.assigned[i];
        if (a && !chosen.has(a)) this.assigned[i] = null;
        else if (a) chosen.delete(a);
      }
      for (const s of chosen) {
        const i = this.assigned.indexOf(null);
        if (i < 0) break;
        this.assigned[i] = s;
      }
    }
    for (let i = 0; i < this.size; i++) {
      const s = this.assigned[i];
      const l = this.lights[i];
      if (!s || !this.sources.has(s.id)) {
        // Nunca ocultar la luz: cambiar el nº de luces visibles recompila shaders.
        this.assigned[i] = null;
        l.intensity = 0;
        continue;
      }
      l.position.copy(s.pos);
      l.color.copy(s.color);
      l.distance = s.range;
      const fl = s.flicker > 0
        ? 1 - s.flicker * (0.5 + 0.5 * Math.sin(this.t * 13 + i * 3.1) * Math.sin(this.t * 7.3 + i)) * 0.6 - Math.random() * s.flicker * 0.15
        : 1;
      l.intensity = s.intensity * s.current * fl;
    }
  }

  get activeCount(): number {
    return this.assigned.filter((a) => a !== null).length;
  }
}
