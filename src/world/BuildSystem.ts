/**
 * Construcción por piezas en la parcela del jugador.
 *
 * La parcela es una rejilla de celdas de 3 m. Las piezas se anclan a una
 * celda (suelos, tejados, muebles) o a un borde entre celdas (paredes,
 * vallas, hastiales), en uno de dos niveles. Cada pieza cuesta materiales
 * reales (tablones, piedra, paja, leña) que se toman del inventario y de los
 * arcones de la parcela, tiene colisión y se guarda con la partida (y se
 * comparte con los demás jugadores del servidor).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Game } from '../game/Game';
import { RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import { worldBox, type MatId } from '../engine/placeholder/Materials';
import { PLAYER_PLOT } from './WorldLayout';
import { itemDef } from '../data/items';

export const CELL = 3;
export const N = Math.round(PLAYER_PLOT.size / CELL);
const LEVEL_H = 3.0;
const WALL_H = 2.75;
const ROOF_RISE = 1.0;
const FLOOR_TOP = 0.25;

export type PieceKind =
  | 'foundation' | 'floor' | 'wall' | 'wall_stone' | 'wall_door' | 'wall_window' | 'gable'
  | 'roof' | 'roof_thatch' | 'fence' | 'ladder' | 'bed' | 'chest' | 'campfire';

interface PieceDef {
  name: string;
  cost: Record<string, number>;
  anchor: 'cell' | 'edge';
  /** Admite rotación (tejados, muebles, hastiales). */
  rot?: boolean;
}

export const PIECES: Record<PieceKind, PieceDef> = {
  foundation: { name: 'Cimiento de piedra', cost: { stone: 4 }, anchor: 'cell' },
  floor: { name: 'Suelo de tablas', cost: { plank: 4 }, anchor: 'cell' },
  wall: { name: 'Pared de tablas', cost: { plank: 5 }, anchor: 'edge' },
  wall_stone: { name: 'Muro de piedra', cost: { stone: 6 }, anchor: 'edge' },
  wall_door: { name: 'Pared con puerta', cost: { plank: 6 }, anchor: 'edge' },
  wall_window: { name: 'Pared con ventana', cost: { plank: 5 }, anchor: 'edge' },
  gable: { name: 'Hastial', cost: { plank: 2 }, anchor: 'edge', rot: true },
  roof: { name: 'Tejado de tablas', cost: { plank: 3 }, anchor: 'cell', rot: true },
  roof_thatch: { name: 'Tejado de paja', cost: { thatch: 4, plank: 1 }, anchor: 'cell', rot: true },
  fence: { name: 'Valla', cost: { plank: 2 }, anchor: 'edge' },
  ladder: { name: 'Escalera de mano', cost: { plank: 3 }, anchor: 'cell', rot: true },
  bed: { name: 'Cama', cost: { plank: 4, thatch: 2 }, anchor: 'cell', rot: true },
  chest: { name: 'Arcón', cost: { plank: 5 }, anchor: 'cell', rot: true },
  campfire: { name: 'Hoguera', cost: { stone: 3, firewood: 2 }, anchor: 'cell' },
};
export const PIECE_ORDER: PieceKind[] = ['foundation', 'floor', 'wall', 'wall_door', 'wall_window', 'wall_stone', 'roof_thatch', 'roof', 'gable', 'fence', 'ladder', 'bed', 'chest', 'campfire'];

export interface Piece {
  id: string;
  kind: PieceKind;
  i: number;
  j: number;
  /** Borde: 'h' (a lo largo de X, en z = j·3) o 'v' (a lo largo de Z, en x = i·3). */
  e?: 'h' | 'v';
  lvl: number;
  rot: number;
  open?: boolean;
  /** Quién la construyó (id de jugador en multijugador). */
  by?: string;
}

interface Part { geo: THREE.BufferGeometry; mat: MatId }
interface Col { hx: number; hy: number; hz: number; m: THREE.Matrix4 }

interface Built {
  piece: Piece;
  bodies: RAPIER.RigidBody[];
  handles: number[];
  door?: { pivot: THREE.Object3D; body: RAPIER.RigidBody; col: RAPIER.Collider };
}

/** Ubicación elegida para colocar (resultado del apuntado). */
export interface Slot { i: number; j: number; e?: 'h' | 'v'; lvl: number; ok: boolean; reason?: string }

export class BuildSystem {
  readonly pieces = new Map<string, Built>();
  readonly x0 = PLAYER_PLOT.x - PLAYER_PLOT.size / 2;
  readonly z0 = PLAYER_PLOT.z - PLAYER_PLOT.size / 2;
  readonly base: number;
  active = false;
  selected = 0;
  rot = 0;
  slot: Slot | null = null;
  private group = new THREE.Group();
  private merged: THREE.Mesh[] = [];
  private ghost: THREE.Mesh;
  private ghostMatOk = new THREE.MeshBasicMaterial({ color: 0x7fdc7f, transparent: true, opacity: 0.35, depthWrite: false });
  private ghostMatBad = new THREE.MeshBasicMaterial({ color: 0xe06050, transparent: true, opacity: 0.35, depthWrite: false });
  private ghostKey = '';
  private seq = 0;
  /** Aviso a otros sistemas (multijugador) cuando cambian las piezas. */
  onChange: ((kind: 'add' | 'remove' | 'door', piece: Piece) => void) | null = null;

  constructor(private readonly g: Game) {
    this.base = g.hf.heightAt(PLAYER_PLOT.x, PLAYER_PLOT.z);
    g.renderer.scene.add(this.group);
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMatOk);
    this.ghost.visible = false;
    this.ghost.renderOrder = 5;
    g.renderer.scene.add(this.ghost);
    this.buildPlotMarkers();
  }

  get kind(): PieceKind {
    return PIECE_ORDER[this.selected];
  }

  /** ¿Está el jugador en su parcela (o cerca)? */
  nearPlot(x: number, z: number, margin = 6): boolean {
    return Math.abs(x - PLAYER_PLOT.x) < PLAYER_PLOT.size / 2 + margin && Math.abs(z - PLAYER_PLOT.z) < PLAYER_PLOT.size / 2 + margin;
  }

  // ------------------------------------------------------------ geometría de piezas

  private floorTop(lvl: number): number {
    return this.base + FLOOR_TOP + lvl * LEVEL_H;
  }

  private cellCenter(i: number, j: number): [number, number] {
    return [this.x0 + (i + 0.5) * CELL, this.z0 + (j + 0.5) * CELL];
  }

  /** Transformación de una pieza de borde: centro y giro Y. */
  private edgeFrame(p: Piece): { x: number; z: number; ry: number } {
    if (p.e === 'h') return { x: this.x0 + (p.i + 0.5) * CELL, z: this.z0 + p.j * CELL, ry: 0 };
    return { x: this.x0 + p.i * CELL, z: this.z0 + (p.j + 0.5) * CELL, ry: Math.PI / 2 };
  }

  /** Piezas visuales y colisiones de una pieza (coordenadas de mundo). */
  private shapes(p: Piece): { parts: Part[]; cols: Col[]; door?: { x: number; y: number; z: number; ry: number } } {
    const parts: Part[] = [];
    const cols: Col[] = [];
    const M = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
    const box = (w: number, h: number, d: number, m: THREE.Matrix4, mat: MatId, collide = true, texel = 1.5) => {
      parts.push({ geo: worldBox(w, h, d, texel).applyMatrix4(m), mat });
      if (collide) cols.push({ hx: w / 2, hy: h / 2, hz: d / 2, m });
    };
    const ft = this.floorTop(p.lvl);
    if (PIECES[p.kind].anchor === 'cell') {
      const [cx, cz] = this.cellCenter(p.i, p.j);
      const ry = (p.rot * Math.PI) / 2;
      switch (p.kind) {
        case 'foundation': {
          const bottom = this.g.hf.heightAt(cx, cz) - 0.4;
          const h = ft - bottom;
          box(CELL, h, CELL, M(cx, bottom + h / 2, cz), 'stoneWall', true, 2);
          break;
        }
        case 'floor':
          box(CELL, 0.18, CELL, M(cx, ft - 0.09, cz), 'planks', true, 1.2);
          for (const s of [-1, 1]) box(CELL, 0.16, 0.16, M(cx, ft - 0.26, cz + s * (CELL / 2 - 0.1)), 'beam', false);
          if (p.lvl > 0) for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.2, LEVEL_H, 0.2, M(cx + sx * 1.4, ft - LEVEL_H / 2 - 0.1, cz + sz * 1.4), 'beam');
          break;
        case 'roof': case 'roof_thatch': {
          const thatch = p.kind === 'roof_thatch';
          const slope = Math.atan2(ROOF_RISE, CELL);
          const len = CELL / Math.cos(slope) + 0.35;
          const y = ft + WALL_H + ROOF_RISE / 2 + 0.1;
          // El lado alto mira en la dirección `rot` (0 = +Z).
          const m = M(cx, y, cz, ry, -slope);
          box(CELL + 0.25, thatch ? 0.28 : 0.1, len, m, thatch ? 'thatch' : 'planks', true, 2);
          if (!thatch) for (let k = -1; k <= 1; k++) box(0.12, 0.12, len, new THREE.Matrix4().multiplyMatrices(m, M(k * 1.2, -0.1, 0)), 'beam', false);
          break;
        }
        case 'ladder': {
          const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
          const bx = cx + dir.x * 1.2, bz = cz + dir.z * 1.2;
          for (const s of [-1, 1]) {
            const side = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(s * 0.28);
            box(0.07, LEVEL_H + 0.4, 0.07, M(bx + side.x, ft + (LEVEL_H + 0.4) / 2, bz + side.z, ry, -0.2), 'roughWood', false);
          }
          for (let k = 0; k < 9; k++) box(0.6, 0.04, 0.05, M(bx - dir.x * (0.06 * k), ft + 0.3 + k * 0.36, bz - dir.z * (0.06 * k), ry), 'roughWood', false);
          cols.push({ hx: 0.35, hy: 0.6, hz: 0.1, m: M(bx, ft + 0.6, bz, ry) });
          break;
        }
        case 'bed':
          box(1.0, 0.3, 2.0, M(cx, ft + 0.15, cz, ry), 'darkWood', true, 1);
          box(0.92, 0.14, 1.9, M(cx, ft + 0.37, cz, ry), 'straw', false, 1);
          box(0.9, 0.05, 1.2, M(cx, ft + 0.46, cz, ry), 'cloth', false, 1);
          break;
        case 'chest':
          box(1.0, 0.5, 0.6, M(cx, ft + 0.25, cz, ry), 'darkWood', true, 1);
          box(1.02, 0.14, 0.62, M(cx, ft + 0.55, cz, ry), 'darkWood', false, 1);
          for (const s of [-0.35, 0.35]) box(0.06, 0.64, 0.64, new THREE.Matrix4().multiplyMatrices(M(cx, ft + 0.32, cz, ry), M(s, 0, 0)), 'iron', false, 1);
          break;
        case 'campfire':
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2;
            box(0.28, 0.2, 0.22, M(cx + Math.cos(a) * 0.5, ft + 0.1, cz + Math.sin(a) * 0.5, -a), 'rock', false, 1);
          }
          for (let k = 0; k < 3; k++) box(0.08, 0.08, 0.7, M(cx, ft + 0.12, cz, k * 1.05, 0.3), 'bark', false, 1);
          cols.push({ hx: 0.6, hy: 0.15, hz: 0.6, m: M(cx, ft + 0.15, cz) });
          break;
      }
      return { parts, cols };
    }
    // ---- Piezas de borde (a lo largo del eje X local; ry las gira).
    const f = this.edgeFrame(p);
    const L = (lx: number, ly: number, lz = 0, extraRz = 0) => M(f.x, ft + ly, f.z, f.ry, 0, extraRz).multiply(M(lx, 0, lz));
    const T = 0.2;
    const post = (lx: number) => box(0.22, WALL_H, 0.26, L(lx, WALL_H / 2), 'beam', true);
    switch (p.kind) {
      case 'wall':
        box(CELL - 0.2, WALL_H, T, L(0, WALL_H / 2), 'planks');
        post(-CELL / 2); post(CELL / 2);
        box(CELL, 0.16, T + 0.08, L(0, WALL_H - 0.08), 'beam', false);
        break;
      case 'wall_stone':
        box(CELL + 0.1, WALL_H, 0.4, L(0, WALL_H / 2), 'stoneWall', true, 2);
        break;
      case 'wall_window': {
        const wy0 = 1.0, wy1 = 2.0, ww = 1.0;
        box(CELL - 0.2, wy0, T, L(0, wy0 / 2), 'planks');
        box(CELL - 0.2, WALL_H - wy1, T, L(0, (wy1 + WALL_H) / 2), 'planks');
        const sideW = (CELL - 0.2 - ww) / 2;
        for (const s of [-1, 1]) box(sideW, wy1 - wy0, T, L(s * (ww / 2 + sideW / 2), (wy0 + wy1) / 2), 'planks');
        box(ww + 0.2, 0.08, 0.32, L(0, wy0 - 0.04), 'darkWood', false);
        box(0.05, wy1 - wy0, 0.05, L(0, (wy0 + wy1) / 2), 'darkWood', false);
        for (const s of [-1, 1]) box(ww / 2, wy1 - wy0, 0.04, L(s * (ww / 2 + 0.1 + ww / 4), (wy0 + wy1) / 2, T / 2 + 0.03), 'darkWood', false);
        post(-CELL / 2); post(CELL / 2);
        break;
      }
      case 'wall_door': {
        const dw = 1.05, dh = 2.1;
        const sideW = (CELL - 0.2 - dw) / 2;
        for (const s of [-1, 1]) box(sideW, WALL_H, T, L(s * (dw / 2 + sideW / 2), WALL_H / 2), 'planks');
        box(dw, WALL_H - dh, T, L(0, (dh + WALL_H) / 2), 'planks');
        box(dw + 0.3, 0.14, T + 0.1, L(0, dh + 0.07), 'darkWood', false);
        post(-CELL / 2); post(CELL / 2);
        const hinge = new THREE.Vector3(-dw / 2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), f.ry);
        return { parts, cols, door: { x: f.x + hinge.x, y: ft, z: f.z + hinge.z, ry: f.ry } };
      }
      case 'fence':
        for (const lx of [-1.4, 0, 1.4]) box(0.12, 1.2, 0.12, L(lx, 0.6), 'roughWood', false);
        for (const y of [0.45, 0.95]) box(CELL, 0.08, 0.05, L(0, y), 'roughWood', false);
        cols.push({ hx: CELL / 2, hy: 0.6, hz: 0.08, m: L(0, 0.6) });
        break;
      case 'gable': {
        // Triángulo rectángulo: alto en el extremo +X (rot 0) o −X (rot 1).
        const g2 = new THREE.BufferGeometry();
        const hx = CELL / 2, top = WALL_H, h = ROOF_RISE + 0.1;
        const sgn = p.rot % 2 === 0 ? 1 : -1;
        const v = [-hx, top, 0, hx, top, 0, sgn * hx, top + h, 0];
        g2.setAttribute('position', new THREE.Float32BufferAttribute([...v, v[0], v[1], v[2], v[6], v[7], v[8], v[3], v[4], v[5]], 3));
        g2.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
        g2.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, sgn > 0 ? 2 : 0, 0.7, 0, 0, sgn > 0 ? 2 : 0, 0.7, 2, 0], 2));
        parts.push({ geo: g2.applyMatrix4(L(0, 0)), mat: 'planks' });
        break;
      }
    }
    return { parts, cols };
  }

  // ------------------------------------------------------------ colocación

  private key(p: { kind: PieceKind; i: number; j: number; e?: string; lvl: number }): string {
    const cls = PIECES[p.kind].anchor === 'edge' ? (p.kind === 'gable' ? 'gable' : 'edge') : p.kind === 'foundation' || p.kind === 'floor' ? 'floor' : p.kind.startsWith('roof') ? 'roof' : 'furn';
    return `${cls}:${p.i}:${p.j}:${p.e ?? ''}:${p.lvl}`;
  }

  /** Busca el hueco al que apunta la cámara. */
  aim(eye: THREE.Vector3, dir: THREE.Vector3): Slot | null {
    const g = this.g;
    const hit = g.physics.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 9, GROUP.TERRAIN | GROUP.STATIC, g.player.collider);
    let px: number, py: number, pz: number;
    if (hit) { px = hit.point.x; py = hit.point.y; pz = hit.point.z; }
    else { const d = 5; px = eye.x + dir.x * d; py = eye.y + dir.y * d; pz = eye.z + dir.z * d; }
    const k = this.kind, def = PIECES[k];
    // Nivel: por la altura del punto apuntado.
    let lvl = Math.round((py - this.base - FLOOR_TOP - (k.startsWith('roof') || k === 'gable' ? WALL_H : 0)) / LEVEL_H);
    if (hit?.normal && hit.normal.y > 0.7 && !k.startsWith('roof') && k !== 'gable') lvl = Math.round((py - this.base - FLOOR_TOP) / LEVEL_H);
    lvl = Math.max(0, Math.min(1, lvl));
    if (k === 'foundation') lvl = 0;
    const fx = (px - this.x0) / CELL, fz = (pz - this.z0) / CELL;
    let slot: Slot;
    if (def.anchor === 'cell') {
      slot = { i: Math.floor(fx), j: Math.floor(fz), lvl, ok: true };
    } else {
      const ci = Math.floor(fx), cj = Math.floor(fz);
      const dx = fx - ci, dz = fz - cj;
      const cand: [number, Slot][] = [
        [dz, { i: ci, j: cj, e: 'h', lvl, ok: true }],
        [1 - dz, { i: ci, j: cj + 1, e: 'h', lvl, ok: true }],
        [dx, { i: ci, j: cj, e: 'v', lvl, ok: true }],
        [1 - dx, { i: ci + 1, j: cj, e: 'v', lvl, ok: true }],
      ];
      cand.sort((a, b) => a[0] - b[0]);
      slot = cand[0][1];
    }
    const inGrid = def.anchor === 'cell'
      ? slot.i >= 0 && slot.i < N && slot.j >= 0 && slot.j < N
      : slot.e === 'h' ? slot.i >= 0 && slot.i < N && slot.j >= 0 && slot.j <= N : slot.i >= 0 && slot.i <= N && slot.j >= 0 && slot.j < N;
    if (!inGrid) return { ...slot, ok: false, reason: 'Solo puedes construir dentro de tu parcela' };
    if (this.pieces.has(this.key({ kind: k, ...slot }))) return { ...slot, ok: false, reason: 'Ahí ya hay algo' };
    const miss = this.missing(k);
    if (miss) return { ...slot, ok: false, reason: miss };
    // No encerrar al jugador dentro de una pieza.
    const probe: Piece = { id: '', kind: k, i: slot.i, j: slot.j, e: slot.e, lvl: slot.lvl, rot: this.rot };
    const pp = g.player.pos;
    for (const c of this.shapes(probe).cols) {
      const inv = c.m.clone().invert();
      const lp = new THREE.Vector3(pp.x, pp.y + 0.9, pp.z).applyMatrix4(inv);
      if (Math.abs(lp.x) < c.hx + 0.35 && Math.abs(lp.y) < c.hy + 0.9 && Math.abs(lp.z) < c.hz + 0.35) return { ...slot, ok: false, reason: 'Apártate: estás en medio' };
    }
    return slot;
  }

  /** Texto de lo que falta para construir la pieza, o null. */
  missing(k: PieceKind): string | null {
    const lacks: string[] = [];
    for (const [id, n] of Object.entries(PIECES[k].cost)) {
      const have = this.available(id);
      if (have < n) lacks.push(`${n - have} ${itemDef(id).name.toLowerCase()}`);
    }
    return lacks.length ? `Te falta: ${lacks.join(', ')}` : null;
  }

  /** Material disponible: inventario + arcones de la parcela. */
  available(id: string): number {
    let n = this.g.inventory.count(id);
    for (const c of this.plotChests()) n += c.inv.count(id);
    return n;
  }

  private plotChests(): { inv: { count(id: string): number; remove(id: string, n: number): number } }[] {
    const out: { inv: { count(id: string): number; remove(id: string, n: number): number } }[] = [];
    const main = this.g.containers.get('plot_chest');
    if (main) out.push(main);
    for (const b of this.pieces.values()) if (b.piece.kind === 'chest') { const c = this.g.containers.get(`build_chest_${b.piece.id}`); if (c) out.push(c); }
    return out;
  }

  private consume(k: PieceKind): void {
    for (const [id, n0] of Object.entries(PIECES[k].cost)) {
      let n = n0 - this.g.inventory.remove(id, n0);
      for (const c of this.plotChests()) { if (n <= 0) break; n -= c.inv.remove(id, n); }
    }
    this.g.equipment.validate();
  }

  /** Coloca la pieza seleccionada en el hueco apuntado. */
  place(): boolean {
    const s = this.slot;
    if (!s) return false;
    if (!s.ok) { this.g.bus.emit('notify', { text: s.reason ?? 'No se puede construir ahí.', kind: 'warning' }); return false; }
    this.consume(this.kind);
    const piece: Piece = { id: `p${Date.now().toString(36)}${(this.seq++).toString(36)}`, kind: this.kind, i: s.i, j: s.j, e: s.e, lvl: s.lvl, rot: this.rot, by: this.g.localPlayerId };
    this.addPiece(piece);
    this.g.bus.emit('sfx', { id: 'hammer', x: this.g.player.pos.x, y: this.g.player.pos.y + 1, z: this.g.player.pos.z });
    this.g.flags.set(`built_${piece.kind}`);
    this.g.flags.setNum(`built_count_${piece.kind}`, this.g.flags.num(`built_count_${piece.kind}`) + 1);
    this.onChange?.('add', piece);
    return true;
  }

  /** Quita la pieza apuntada y devuelve la mitad de los materiales. */
  removeAimed(eye: THREE.Vector3, dir: THREE.Vector3): boolean {
    const g = this.g;
    const hit = g.physics.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 6, GROUP.STATIC, g.player.collider);
    const tag = hit ? g.physics.tagOf(hit.collider) : undefined;
    if (!hit || tag?.kind !== 'build') return false;
    const b = this.pieces.get(tag.id);
    if (!b) return false;
    for (const [id, n] of Object.entries(PIECES[b.piece.kind].cost)) {
      const back = Math.floor(n / 2);
      if (back) g.inventory.add(id, back);
    }
    this.removePiece(b.piece.id);
    g.bus.emit('notify', { text: `Desmontas: ${PIECES[b.piece.kind].name} (recuperas la mitad del material).`, kind: 'info' });
    this.onChange?.('remove', b.piece);
    return true;
  }

  // ------------------------------------------------------------ piezas en el mundo

  addPiece(piece: Piece): void {
    const g = this.g;
    if (this.pieces.has(piece.id)) return;
    const key = this.key(piece);
    for (const b of this.pieces.values()) if (this.key(b.piece) === key) return; // ocupado (p. ej. llegó por red)
    const sh = this.shapes(piece);
    const built: Built = { piece, bodies: [], handles: [] };
    for (const c of sh.cols) {
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      c.m.decompose(pos, q, sc);
      const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(q));
      const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setCollisionGroups(groups(GROUP.STATIC, ALL)), body);
      g.physics.tag(col, { kind: 'build', id: piece.id });
      built.bodies.push(body);
      built.handles.push(col.handle);
    }
    if (sh.door) {
      const pivot = new THREE.Object3D();
      pivot.position.set(sh.door.x, sh.door.y, sh.door.z);
      pivot.rotation.y = sh.door.ry;
      const leaf = new THREE.Mesh(worldBox(1.02, 2.08, 0.07, 1.2).translate(0.51, 1.04, 0), g.materials.get('darkWood'));
      for (const y of [0.4, 1.7]) leaf.add(new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.09).translate(0.45, y, 0), g.materials.get('iron')));
      leaf.castShadow = true;
      pivot.add(leaf);
      this.group.add(pivot);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sh.door.ry, 0));
      const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(sh.door.x, sh.door.y, sh.door.z).setRotation(q));
      const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 1.04, 0.05).setTranslation(0.51, 1.04, 0).setCollisionGroups(groups(GROUP.STATIC, ALL)), body);
      g.physics.tag(col, { kind: 'build', id: piece.id });
      built.door = { pivot, body, col };
      g.interactables.register(col.handle, {
        id: `bdoor_${piece.id}`, kind: 'door', pos: pivot.position,
        label: () => (piece.open ? 'Cerrar puerta' : 'Abrir puerta'),
        interact: () => this.toggleDoor(piece.id),
      });
      this.applyDoor(built);
    }
    // Muebles interactuables.
    const h0 = built.handles[0];
    const [cx, cz] = this.cellCenter(piece.i, piece.j);
    const cpos = new THREE.Vector3(cx, this.floorTop(piece.lvl) + 0.4, cz);
    if (piece.kind === 'bed' && h0 !== undefined) {
      g.interactables.register(h0, { id: `bbed_${piece.id}`, kind: 'bed', pos: cpos, label: () => 'Tu cama · dormir', interact: (game) => game.actions.sleep() });
      g.flags.set('home_bed');
    }
    if (piece.kind === 'chest' && h0 !== undefined) {
      const cid = `build_chest_${piece.id}`;
      if (!g.containers.get(cid)) g.containers.create(cid, 'Tu arcón', null, [], 0);
      g.interactables.register(h0, { id: cid, kind: 'container', pos: cpos, label: () => 'Abrir tu arcón', interact: (game) => game.ui.openContainer(cid) });
    }
    if (piece.kind === 'campfire' && h0 !== undefined) {
      const fid = `bfire_${piece.id}`;
      g.fires.add({ id: fid, kind: 'campfire', pos: new THREE.Vector3(cx, this.floorTop(piece.lvl) + 0.1, cz), policy: 'manual', canCook: true, heat: 18 });
      g.interactables.register(h0, { id: fid, kind: 'hearth', pos: cpos, label: (game) => game.actions.hearthLabel(fid), interact: (game) => game.actions.useFire(fid) });
    }
    if (piece.kind === 'ladder' && h0 !== undefined) {
      g.interactables.register(h0, {
        id: `bladder_${piece.id}`, kind: 'ladder', pos: cpos,
        label: (game) => (game.player.pos.y > this.floorTop(0) + 1.5 ? 'Bajar por la escalera' : 'Subir por la escalera'),
        interact: (game) => {
          const up = game.player.pos.y <= this.floorTop(0) + 1.5;
          game.player.teleport(cx, this.floorTop(up ? 1 : 0) + 0.05, cz, game.player.yaw);
          game.bus.emit('sfx', { id: 'step_wood' });
        },
      });
    }
    this.pieces.set(piece.id, built);
    this.rebuildMeshes();
  }

  removePiece(id: string): void {
    const g = this.g;
    const b = this.pieces.get(id);
    if (!b) return;
    for (const h of b.handles) g.interactables.unregisterCollider(h);
    for (const body of b.bodies) g.physics.removeBody(body);
    if (b.door) {
      g.interactables.unregisterCollider(b.door.col.handle);
      g.physics.removeBody(b.door.body);
      this.group.remove(b.door.pivot);
    }
    if (b.piece.kind === 'campfire') g.fires.remove(`bfire_${id}`);
    if (b.piece.kind === 'chest') {
      // El contenido cae al suelo.
      const c = g.containers.get(`build_chest_${id}`);
      const [cx, cz] = this.cellCenter(b.piece.i, b.piece.j);
      if (c) for (const s of c.inv.stacks) g.worldItems.spawn(s.id, cx, this.floorTop(b.piece.lvl) + 0.5, cz, { count: s.count });
    }
    this.pieces.delete(id);
    this.rebuildMeshes();
  }

  toggleDoor(id: string, open?: boolean): void {
    const b = this.pieces.get(id);
    if (!b?.door) return;
    b.piece.open = open ?? !b.piece.open;
    this.applyDoor(b);
    this.g.bus.emit('sfx', { id: b.piece.open ? 'door_open' : 'door_close', x: b.door.pivot.position.x, y: b.door.pivot.position.y + 1, z: b.door.pivot.position.z });
    if (open === undefined) this.onChange?.('door', b.piece);
  }

  private applyDoor(b: Built): void {
    if (!b.door) return;
    const ry = b.door.pivot.rotation.y;
    const a = b.piece.open ? -1.6 : 0;
    b.door.pivot.children[0].rotation.y = a;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry + a, 0));
    b.door.body.setNextKinematicRotation(q);
    b.door.body.setRotation(q, true);
  }

  /** Fusiona las piezas por material (pocas llamadas de dibujo). */
  private rebuildMeshes(): void {
    for (const m of this.merged) { this.group.remove(m); m.geometry.dispose(); }
    this.merged = [];
    const byMat = new Map<MatId, THREE.BufferGeometry[]>();
    for (const b of this.pieces.values()) {
      for (const p of this.shapes(b.piece).parts) {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!byMat.has(p.mat)) byMat.set(p.mat, []);
        byMat.get(p.mat)!.push(g);
      }
    }
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.g.materials.get(mat));
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.merged.push(mesh);
    }
  }

  // ------------------------------------------------------------ modo construcción

  toggle(on?: boolean): void {
    const want = on ?? !this.active;
    if (want && !this.nearPlot(this.g.player.pos.x, this.g.player.pos.z)) {
      this.g.bus.emit('notify', { text: 'Solo puedes construir en tu parcela (al sur de tu choza).', kind: 'warning' });
      return;
    }
    this.active = want;
    this.ghost.visible = false;
    this.g.bus.emit('sfx', { id: 'equip' });
  }

  cycle(d: number): void {
    this.selected = (this.selected + d + PIECE_ORDER.length) % PIECE_ORDER.length;
  }

  /** Cada tick: entrada del modo construcción. */
  update(): void {
    const g = this.g;
    const inp = g.input;
    if (inp.wasPressed('build')) this.toggle();
    if (!this.active) return;
    if (!this.nearPlot(g.player.pos.x, g.player.pos.z, 10)) { this.toggle(false); return; }
    if (inp.wasPressed('buildNext')) this.cycle(1);
    if (inp.wasPressed('buildPrev')) this.cycle(-1);
    if (inp.wasPressed('rotate')) this.rot = (this.rot + 1) % 4;
    const eye = g.player.eyePosition(1, new THREE.Vector3());
    const dir = g.player.forward(new THREE.Vector3());
    this.slot = this.aim(eye, dir);
    if (inp.wasPressed('attack')) this.place();
    else if (inp.wasPressed('interact')) this.removeAimed(eye, dir);
  }

  /** Cada frame: fantasma de la pieza. */
  updateGhost(): void {
    const s = this.slot;
    if (!this.active || !s) { this.ghost.visible = false; return; }
    const key = `${this.kind}:${s.i}:${s.j}:${s.e}:${s.lvl}:${this.rot}`;
    if (key !== this.ghostKey) {
      this.ghostKey = key;
      const parts = this.shapes({ id: '', kind: this.kind, i: s.i, j: s.j, e: s.e, lvl: s.lvl, rot: this.rot }).parts;
      const geos = parts.map((p) => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; });
      if (this.kind === 'wall_door') geos.push(worldBox(1.0, 2.08, 0.07).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0)));
      this.ghost.geometry.dispose();
      this.ghost.geometry = (geos.length ? mergeGeometries(geos) : null) ?? new THREE.BufferGeometry();
    }
    this.ghost.material = s.ok ? this.ghostMatOk : this.ghostMatBad;
    this.ghost.visible = true;
  }

  /** Marcas de la parcela: estacas en las esquinas y un letrero. */
  private buildPlotMarkers(): void {
    const g = this.g;
    const half = PLAYER_PLOT.size / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = PLAYER_PLOT.x + sx * half, z = PLAYER_PLOT.z + sz * half;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.3, 6), g.materials.get('roughWood'));
      m.position.set(x, g.hf.heightAt(x, z) + 0.55, z);
      m.castShadow = true;
      const rag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.12), g.materials.get('clothRed'));
      rag.position.set(0, 0.55, 0.06);
      m.add(rag);
      this.group.add(m);
    }
  }

  // ------------------------------------------------------------ persistencia

  serialize(): Piece[] {
    return [...this.pieces.values()].map((b) => ({ ...b.piece }));
  }

  deserialize(list: Piece[]): void {
    for (const id of [...this.pieces.keys()]) this.removePiece(id);
    for (const p of list ?? []) this.addPiece({ ...p });
  }
}
