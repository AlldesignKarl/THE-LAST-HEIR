/**
 * Terreno analítico (ADR-004). `heightAt` es determinista y barato: lo usan
 * las mallas, los colliders, la IA (sin raycasts) y la colocación de objetos.
 * Sin dependencias de Three ni Rapier ⇒ testeable en Node.
 */
import { Simplex2 } from '../core/noise';
import { clamp, lerp, pointSegmentDist, smoothstep, toLocalXZ } from '../core/math';
import {
  BANDIT_CAMP, CAVE, CAVE_HILL, DEER_MEADOW, FIELDS, GROVE_NE, ROADS, STREAM, VILLAGES,
  WORLD_HALF, WORLD_SEED, WOLF_DEN, type P2,
} from './WorldLayout';

interface Seg {
  ax: number; az: number; bx: number; bz: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  halfW: number;
  kind: string;
  /** Nivel de agua en los extremos (solo arroyo). */
  la: number; lb: number;
}

export type Surface = 'grass' | 'dirt' | 'road' | 'rock' | 'mud' | 'wood' | 'stone' | 'water' | 'field';

export interface SurfaceWeights {
  road: number;
  village: number;
  mud: number;
  field: number;
  camp: number;
}

export class Heightfield {
  private readonly n: Simplex2;
  private readonly nd: Simplex2;
  private readonly roadSegs: Seg[] = [];
  private readonly streamSegs: Seg[] = [];
  private readonly villageBase: number[];

  constructor(seed = WORLD_SEED) {
    this.n = new Simplex2(seed);
    this.nd = new Simplex2(seed * 7 + 13);
    for (const r of ROADS) this.addSegs(this.roadSegs, r.points, r.width / 2, r.kind, false);
    this.addSegs(this.streamSegs, STREAM.points, STREAM.width / 2, 'stream', true);
    this.villageBase = VILLAGES.map((v) => this.lowFreq(v.x, v.z) + 0.3);
  }

  private addSegs(out: Seg[], pts: P2[], halfW: number, kind: string, water: boolean): void {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const pad = halfW + 8;
      out.push({
        ax, az, bx, bz, halfW, kind,
        minX: Math.min(ax, bx) - pad, maxX: Math.max(ax, bx) + pad,
        minZ: Math.min(az, bz) - pad, maxZ: Math.max(az, bz) + pad,
        la: water ? this.lowFreq(ax, az) - 0.55 : 0,
        lb: water ? this.lowFreq(bx, bz) - 0.55 : 0,
      });
    }
  }

  /** Relieve de baja frecuencia (colinas, sierra norte, colina de la cueva). */
  lowFreq(x: number, z: number): number {
    let h = 14 + this.n.fbm(x / 520, z / 520, 4) * 14 + this.n.fbm(x / 140 + 31, z / 140 - 17, 3) * 4.5;
    // Sierra del norte.
    const m = smoothstep(-330, -640, z);
    if (m > 0) {
      // Crestas suaves (pocas octavas) + masa redondeada: sierra erosionada, no dientes de sierra.
      const r = this.n.ridged(x / 300, z / 300, 3);
      h += m * (35 + (r * 0.65 + this.n.fbm(x / 380 + 5, z / 380, 4) * 0.35) * 200);
    }
    // Bordes del valle.
    const edge = smoothstep(760, 1010, Math.max(Math.abs(x), Math.abs(z)));
    if (edge > 0) h += edge * (60 + (this.n.ridged(x / 260 + 9, z / 260, 2) * 0.6 + this.n.fbm(x / 300, z / 300 + 3, 3) * 0.4) * 90);
    // Colina rocosa de la Cueva del Cuervo (acantilado marcado).
    const dh = Math.hypot(x - CAVE_HILL.x, z - CAVE_HILL.z);
    if (dh < CAVE_HILL.radius) {
      const s = smoothstep(CAVE_HILL.radius, CAVE_HILL.radius - CAVE_HILL.cliff, dh);
      h += s * (CAVE_HILL.height + this.nd.fbm(x / 22, z / 22, 3) * 4 * s);
    }
    return h;
  }

  heightAt(x: number, z: number): number {
    let h = this.lowFreq(x, z) + this.nd.noise(x / 30, z / 30) * 0.6 + this.nd.noise(x / 7.5, z / 7.5) * 0.12;

    // Caminos: se asientan sobre el relieve suave.
    let roadW = 0;
    for (const s of this.roadSegs) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      const { d } = pointSegmentDist(x, z, s.ax, s.az, s.bx, s.bz);
      const w = 1 - smoothstep(s.halfW, s.halfW + 3, d);
      if (w > roadW) roadW = w;
    }
    if (roadW > 0) h = lerp(h, this.lowFreq(x, z) - 0.12, roadW);

    // Pueblos: explanada.
    for (let i = 0; i < VILLAGES.length; i++) {
      const v = VILLAGES[i];
      const d = Math.hypot(x - v.x, z - v.z);
      if (d < v.flatRadius + 30) {
        const w = 1 - smoothstep(v.flatRadius, v.flatRadius + 30, d);
        h = lerp(h, this.villageBase[i] + this.nd.noise(x / 18, z / 18) * 0.22, w);
      }
    }

    // Arroyo: cauce excavado.
    const st = this.streamInfo(x, z);
    if (st && st.dist < st.halfW + 5) {
      const target = st.dist < st.halfW
        ? st.level - STREAM.depth * (1 - (st.dist / st.halfW) ** 2) - 0.05
        : st.level + 0.2;
      const w = 1 - smoothstep(st.halfW + 1, st.halfW + 5, st.dist);
      h = Math.min(h, lerp(h, target, w));
    }
    return h;
  }

  /** Información del arroyo más cercano (null si lejos). */
  streamInfo(x: number, z: number): { dist: number; level: number; halfW: number } | null {
    let best: { dist: number; level: number; halfW: number } | null = null;
    for (const s of this.streamSegs) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      const { d, t } = pointSegmentDist(x, z, s.ax, s.az, s.bx, s.bz);
      if (!best || d < best.dist) best = { dist: d, level: lerp(s.la, s.lb, t), halfW: s.halfW };
    }
    return best;
  }

  /** Nivel del agua en (x,z) si hay agua ahí. */
  waterLevelAt(x: number, z: number): number | null {
    const st = this.streamInfo(x, z);
    if (st && st.dist < st.halfW + 0.6) return st.level;
    return null;
  }

  normalAt(x: number, z: number, e = 0.8): { x: number; y: number; z: number } {
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    return { x: nx / l, y: ny / l, z: nz / l };
  }

  /** ¿Punto dentro del hueco del terreno sobre la boca de la cueva? */
  isHole(x: number, z: number): boolean {
    const h = CAVE.hole;
    return x >= h.x0 && x <= h.x1 && z >= h.z0 && z <= h.z1;
  }

  roadWeight(x: number, z: number): number {
    let roadW = 0;
    for (const s of this.roadSegs) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      const { d } = pointSegmentDist(x, z, s.ax, s.az, s.bx, s.bz);
      const w = 1 - smoothstep(s.halfW * 0.7, s.halfW + 0.6, d);
      if (w > roadW) roadW = w;
    }
    return roadW;
  }

  /** Pesos de superficie para el sombreado del terreno y los pasos. */
  surfaceWeights(x: number, z: number): SurfaceWeights {
    const road = this.roadWeight(x, z);
    let village = 0;
    for (const v of VILLAGES) {
      const d = Math.hypot(x - v.x, z - v.z);
      village = Math.max(village, 1 - smoothstep(v.flatRadius * 0.55, v.flatRadius, d));
    }
    // Zonas pisadas del pueblo: parches de tierra.
    village *= smoothstep(-0.2, 0.5, this.nd.noise(x / 9, z / 9));
    const st = this.streamInfo(x, z);
    const mud = st ? 1 - smoothstep(st.halfW, st.halfW + 3.5, st.dist) : 0;
    let field = 0;
    for (const f of FIELDS) {
      const l = toLocalXZ(x - f.x, z - f.z, f.rot);
      if (Math.abs(l.x) < f.w / 2 && Math.abs(l.z) < f.d / 2) field = 1;
    }
    const camp = 1 - smoothstep(BANDIT_CAMP.radius * 0.6, BANDIT_CAMP.radius, Math.hypot(x - BANDIT_CAMP.x, z - BANDIT_CAMP.z));
    return { road, village, mud, field, camp };
  }

  surfaceAt(x: number, z: number): Surface {
    if (this.waterLevelAt(x, z) !== null && this.heightAt(x, z) < (this.waterLevelAt(x, z) ?? -1e9)) return 'water';
    const w = this.surfaceWeights(x, z);
    if (w.road > 0.5) return 'road';
    if (w.mud > 0.5) return 'mud';
    if (w.field > 0.5) return 'field';
    const n = this.normalAt(x, z);
    if (n.y < 0.7) return 'rock';
    if (w.village > 0.5 || w.camp > 0.5) return 'dirt';
    return 'grass';
  }

  /** Densidad de bosque [0,1] para la colocación de árboles. */
  forestDensity(x: number, z: number): number {
    if (Math.abs(x) > WORLD_HALF - 40 || Math.abs(z) > WORLD_HALF - 40) return 0;
    // Bosque grande al oeste del arroyo y al noroeste; bosque del campamento al noreste.
    let d = 0.15 + this.n.fbm(x / 160 + 100, z / 160 - 40, 3) * 0.35;
    d += smoothstep(-80, -140, x) * 0.55;
    d += smoothstep(-60, -200, z) * 0.25 * smoothstep(-40, 60, -x);
    d += (1 - smoothstep(60, 160, Math.hypot(x - BANDIT_CAMP.x, z - BANDIT_CAMP.z))) * 0.6;
    d += (1 - smoothstep(GROVE_NE.radius * 0.5, GROVE_NE.radius, Math.hypot(x - GROVE_NE.x, z - GROVE_NE.z))) * 0.9;
    // Montaña alta: menos árboles.
    d -= smoothstep(-420, -600, z) * 0.6;
    // Exclusiones.
    for (const v of VILLAGES) if (Math.hypot(x - v.x, z - v.z) < v.radius + 6) return 0;
    if (Math.hypot(x - BANDIT_CAMP.x, z - BANDIT_CAMP.z) < BANDIT_CAMP.radius + 4) return 0;
    if (Math.hypot(x - DEER_MEADOW.x, z - DEER_MEADOW.z) < DEER_MEADOW.radius) return 0;
    if (Math.hypot(x - WOLF_DEN.x, z - WOLF_DEN.z) < 8) return 0;
    const hill = Math.hypot(x - CAVE_HILL.x, z - CAVE_HILL.z);
    if (hill < CAVE_HILL.radius + 3 && hill > CAVE_HILL.radius - CAVE_HILL.cliff - 4) return 0; // acantilado
    if (x > CAVE.hole.x0 - 4 && x < CAVE.hole.x1 + 14 && z > CAVE.hole.z0 - 10 && z < CAVE.hole.z1 + 10) return 0;
    if (this.roadWeight(x, z) > 0.01) return 0;
    for (const s of this.roadSegs) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      if (pointSegmentDist(x, z, s.ax, s.az, s.bx, s.bz).d < s.halfW + 3) return 0;
    }
    const st = this.streamInfo(x, z);
    if (st && st.dist < st.halfW + 3) return 0;
    const sw = this.surfaceWeights(x, z);
    if (sw.field > 0) return 0;
    return clamp(d, 0, 1);
  }
}
