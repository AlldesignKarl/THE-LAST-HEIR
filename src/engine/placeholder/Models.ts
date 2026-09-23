/**
 * PLACEHOLDER · Modelos procedurales de objetos y mobiliario.
 * Cada modelo declara su forma física simplificada para Rapier.
 * Sustituible por glTF: `ModelLibrary.create(id)` es el único punto de uso.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldBox, type MaterialLibrary, type MatId } from './Materials';

export type Shape =
  | { type: 'box'; hx: number; hy: number; hz: number; oy?: number }
  | { type: 'cyl'; hh: number; r: number; oy?: number }
  | { type: 'ball'; r: number; oy?: number };

export interface ModelDef {
  build: (b: Builder) => void;
  shape: Shape;
  mass: number;
}

/** Acumula piezas por material y las fusiona. */
export class Builder {
  parts = new Map<MatId, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, mat: MatId, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1): this {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s)));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(g);
    return this;
  }
  box(w: number, h: number, d: number, mat: MatId, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, texel = 1): this {
    return this.add(worldBox(w, h, d, texel), mat, x, y, z, rx, ry, rz);
  }
  cyl(rt: number, rb: number, h: number, mat: MatId, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 10): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rx, ry, rz);
  }
}

const D: Record<string, ModelDef> = {
  // ---------------- Armas y herramientas ----------------
  sword: {
    shape: { type: 'box', hx: 0.05, hy: 0.5, hz: 0.1, oy: 0 }, mass: 1.3,
    build: (b) => b.box(0.05, 0.8, 0.012, 'metal', 0, 0.2, 0).box(0.22, 0.03, 0.04, 'iron', 0, -0.21, 0).cyl(0.018, 0.02, 0.2, 'leather', 0, -0.33, 0).add(new THREE.SphereGeometry(0.03, 8, 6), 'iron', 0, -0.44, 0),
  },
  axe: {
    shape: { type: 'box', hx: 0.12, hy: 0.4, hz: 0.04 }, mass: 1.6,
    build: (b) => b.cyl(0.02, 0.024, 0.8, 'darkWood', 0, 0, 0).box(0.2, 0.12, 0.025, 'iron', 0.08, 0.31, 0).box(0.05, 0.16, 0.03, 'metal', 0.18, 0.31, 0),
  },
  bow: {
    shape: { type: 'box', hx: 0.06, hy: 0.7, hz: 0.1 }, mass: 0.9,
    build: (b) => {
      const curve = new THREE.TorusGeometry(0.75, 0.018, 5, 18, Math.PI * 0.75);
      b.add(curve, 'darkWood', -0.62, 0, 0, 0, 0, -Math.PI * 0.375);
      b.cyl(0.003, 0.003, 1.28, 'paper', 0.05, 0, 0);
      b.cyl(0.025, 0.025, 0.14, 'leather', 0.1, 0, 0);
    },
  },
  arrow: {
    shape: { type: 'box', hx: 0.02, hy: 0.38, hz: 0.02 }, mass: 0.05,
    build: (b) => b.cyl(0.006, 0.006, 0.75, 'darkWood', 0, 0, 0).add(new THREE.ConeGeometry(0.014, 0.05, 4), 'iron', 0, 0.39, 0).box(0.002, 0.08, 0.03, 'paper', 0, -0.33, 0),
  },
  arrow_bundle: {
    shape: { type: 'cyl', hh: 0.35, r: 0.05 }, mass: 0.6,
    build: (b) => { for (let i = 0; i < 6; i++) b.cyl(0.006, 0.006, 0.75, 'darkWood', Math.cos(i) * 0.03, 0, Math.sin(i) * 0.03); b.cyl(0.04, 0.04, 0.06, 'leather', 0, 0, 0); },
  },
  knife: {
    shape: { type: 'box', hx: 0.03, hy: 0.15, hz: 0.02 }, mass: 0.3,
    build: (b) => b.box(0.03, 0.18, 0.006, 'metal', 0, 0.08, 0).cyl(0.014, 0.016, 0.1, 'darkWood', 0, -0.06, 0),
  },
  torch: {
    shape: { type: 'cyl', hh: 0.3, r: 0.04 }, mass: 0.5,
    build: (b) => b.cyl(0.02, 0.028, 0.6, 'darkWood', 0, 0, 0).cyl(0.045, 0.035, 0.12, 'cloth', 0, 0.3, 0),
  },
  bucket: {
    shape: { type: 'cyl', hh: 0.16, r: 0.16 }, mass: 1.2,
    build: (b) => b.add(new THREE.CylinderGeometry(0.17, 0.14, 0.32, 12, 1, true), 'planks').cyl(0.14, 0.14, 0.02, 'planks', 0, -0.15, 0).add(new THREE.TorusGeometry(0.165, 0.01, 4, 16), 'iron', 0, 0.1, 0, Math.PI / 2),
  },
  bucket_water: {
    shape: { type: 'cyl', hh: 0.16, r: 0.16 }, mass: 9,
    build: (b) => b.add(new THREE.CylinderGeometry(0.17, 0.14, 0.32, 12, 1, true), 'planks').cyl(0.14, 0.14, 0.02, 'planks', 0, -0.15, 0).cyl(0.16, 0.16, 0.01, 'iron', 0, 0.12, 0),
  },
  shield: {
    shape: { type: 'cyl', hh: 0.04, r: 0.3 }, mass: 3.5,
    build: (b) => b.cyl(0.3, 0.3, 0.04, 'planks', 0, 0, 0, Math.PI / 2).cyl(0.07, 0.07, 0.06, 'iron', 0, 0, 0.02, Math.PI / 2).add(new THREE.TorusGeometry(0.3, 0.015, 4, 20), 'iron', 0, 0, 0),
  },
  // ---------------- Comida ----------------
  bread: { shape: { type: 'box', hx: 0.1, hy: 0.05, hz: 0.06 }, mass: 0.4, build: (b) => b.add(new THREE.SphereGeometry(0.1, 10, 6), 'bread', 0, 0, 0, 0, 0, 0, 1).parts.get('bread')![0].scale(1, 0.5, 0.65) && undefined },
  apple: { shape: { type: 'ball', r: 0.04 }, mass: 0.15, build: (b) => b.add(new THREE.SphereGeometry(0.04, 8, 6), 'apple').cyl(0.003, 0.003, 0.02, 'darkWood', 0, 0.045, 0) },
  meat_raw: { shape: { type: 'box', hx: 0.1, hy: 0.04, hz: 0.07 }, mass: 0.6, build: (b) => b.add(new THREE.DodecahedronGeometry(0.09, 0), 'meat').parts.get('meat')![0].scale(1.2, 0.5, 0.8) && undefined },
  meat_cooked: { shape: { type: 'box', hx: 0.1, hy: 0.04, hz: 0.07 }, mass: 0.5, build: (b) => b.add(new THREE.DodecahedronGeometry(0.09, 0), 'meatCooked').parts.get('meatCooked')![0].scale(1.2, 0.5, 0.8) && undefined },
  cheese: { shape: { type: 'cyl', hh: 0.04, r: 0.08 }, mass: 0.5, build: (b) => b.cyl(0.08, 0.08, 0.08, 'bread', 0, 0, 0, 0, 0, 0, 14) },
  waterskin: { shape: { type: 'box', hx: 0.08, hy: 0.12, hz: 0.05 }, mass: 0.9, build: (b) => b.add(new THREE.SphereGeometry(0.1, 8, 6), 'leather').parts.get('leather')![0].scale(0.8, 1.2, 0.5) && undefined },
  // ---------------- Recursos ----------------
  log: {
    shape: { type: 'cyl', hh: 0.9, r: 0.2 }, mass: 22,
    build: (b) => b.cyl(0.2, 0.22, 1.8, 'bark', 0, 0, 0, 0, 0, 0, 9).cyl(0.19, 0.19, 0.01, 'planks', 0, 0.9, 0).cyl(0.21, 0.21, 0.01, 'planks', 0, -0.9, 0),
  },
  firewood: { shape: { type: 'box', hx: 0.2, hy: 0.06, hz: 0.1 }, mass: 2, build: (b) => { for (let i = 0; i < 3; i++) b.cyl(0.04, 0.04, 0.4, 'bark', (i - 1) * 0.07, 0, 0, Math.PI / 2, 0, 0, 6); } },
  stone: { shape: { type: 'ball', r: 0.09 }, mass: 1.5, build: (b) => b.add(new THREE.DodecahedronGeometry(0.1, 0), 'rock') },
  herbs: { shape: { type: 'box', hx: 0.06, hy: 0.08, hz: 0.06 }, mass: 0.1, build: (b) => { for (let i = 0; i < 5; i++) b.cyl(0.004, 0.004, 0.16, 'leaves', Math.cos(i * 1.3) * 0.02, 0, Math.sin(i * 1.3) * 0.02, 0.2 * Math.cos(i), 0, 0.2 * Math.sin(i), 4); b.add(new THREE.SphereGeometry(0.04, 6, 4), 'leaves', 0, 0.08, 0); } },
  hide: { shape: { type: 'box', hx: 0.3, hy: 0.03, hz: 0.25 }, mass: 2.5, build: (b) => b.box(0.6, 0.03, 0.5, 'leather') },
  pelt_wolf: { shape: { type: 'box', hx: 0.3, hy: 0.04, hz: 0.25 }, mass: 2, build: (b) => b.box(0.6, 0.04, 0.5, 'ash') },
  coin_purse: { shape: { type: 'ball', r: 0.05 }, mass: 0.3, build: (b) => b.add(new THREE.SphereGeometry(0.05, 8, 6), 'leather').cyl(0.02, 0.03, 0.03, 'leather', 0, 0.05, 0) },
  // ---------------- Historia ----------------
  letter: { shape: { type: 'box', hx: 0.1, hy: 0.01, hz: 0.14 }, mass: 0.05, build: (b) => b.box(0.2, 0.01, 0.28, 'paper').box(0.03, 0.012, 0.03, 'clothRed', 0, 0.002, 0.08) },
  satchel: { shape: { type: 'box', hx: 0.18, hy: 0.14, hz: 0.07 }, mass: 1.5, build: (b) => b.box(0.36, 0.28, 0.12, 'leather').box(0.36, 0.14, 0.13, 'leather', 0, 0.08, 0.01, 0.2).cyl(0.012, 0.012, 0.6, 'leather', 0, 0.3, 0, 0, 0, Math.PI / 2) },
  map_fragment: { shape: { type: 'box', hx: 0.12, hy: 0.01, hz: 0.1 }, mass: 0.05, build: (b) => b.box(0.24, 0.01, 0.2, 'paper', 0, 0, 0, 0, 0.3) },
  olmedo_token: { shape: { type: 'cyl', hh: 0.005, r: 0.03 }, mass: 0.05, build: (b) => b.cyl(0.03, 0.03, 0.008, 'gold', 0, 0, 0, 0, 0, 0, 16) },
  journal_page: { shape: { type: 'box', hx: 0.09, hy: 0.01, hz: 0.12 }, mass: 0.02, build: (b) => b.box(0.18, 0.01, 0.24, 'paper', 0, 0, 0, 0, -0.2) },
  // ---------------- Mobiliario (dinámico) ----------------
  barrel: { shape: { type: 'cyl', hh: 0.45, r: 0.32 }, mass: 45, build: (b) => { b.add(new THREE.CylinderGeometry(0.33, 0.28, 0.9, 14, 3), 'planks', 0, 0, 0, 0, 0, 0, 1); for (const y of [-0.3, 0.3]) b.add(new THREE.TorusGeometry(0.315, 0.012, 4, 18), 'iron', 0, y, 0, Math.PI / 2); } },
  crate: { shape: { type: 'box', hx: 0.35, hy: 0.3, hz: 0.35 }, mass: 20, build: (b) => b.box(0.7, 0.6, 0.7, 'planks', 0, 0, 0, 0, 0, 0, 0.8).box(0.72, 0.08, 0.08, 'darkWood', 0, 0.26, 0.33).box(0.72, 0.08, 0.08, 'darkWood', 0, -0.26, 0.33) },
  stool: { shape: { type: 'cyl', hh: 0.24, r: 0.2 }, mass: 3, build: (b) => { b.cyl(0.2, 0.2, 0.05, 'planks', 0, 0.21, 0, 0, 0, 0, 12); for (let i = 0; i < 3; i++) b.cyl(0.02, 0.025, 0.46, 'darkWood', Math.cos(i * 2.09) * 0.13, -0.02, Math.sin(i * 2.09) * 0.13, Math.sin(i * 2.09) * 0.12, 0, -Math.cos(i * 2.09) * 0.12, 5); } },
  sack: { shape: { type: 'box', hx: 0.25, hy: 0.3, hz: 0.2 }, mass: 25, build: (b) => b.add(new THREE.SphereGeometry(0.28, 10, 8), 'cloth').parts.get('cloth')![0].scale(0.9, 1.15, 0.75) && undefined },
  // ---------------- Mobiliario (estático) ----------------
  table: { shape: { type: 'box', hx: 0.8, hy: 0.4, hz: 0.45 }, mass: 0, build: (b) => { b.box(1.6, 0.07, 0.9, 'planks', 0, 0.36, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.08, 0.72, 0.08, 'darkWood', sx * 0.7, 0, sz * 0.36); } },
  bench: { shape: { type: 'box', hx: 0.8, hy: 0.22, hz: 0.18 }, mass: 0, build: (b) => { b.box(1.6, 0.06, 0.34, 'planks', 0, 0.2, 0); for (const sx of [-1, 1]) b.box(0.06, 0.42, 0.3, 'darkWood', sx * 0.7, -0.02, 0); } },
  bed: { shape: { type: 'box', hx: 0.5, hy: 0.25, hz: 1.0 }, mass: 0, build: (b) => { b.box(1.0, 0.3, 2.0, 'darkWood', 0, -0.05, 0); b.box(0.92, 0.15, 1.9, 'straw', 0, 0.16, 0); b.box(0.9, 0.06, 1.3, 'cloth', 0, 0.26, 0.3); b.box(0.5, 0.12, 0.3, 'cloth', 0, 0.28, -0.75); } },
  chest: { shape: { type: 'box', hx: 0.5, hy: 0.3, hz: 0.3 }, mass: 0, build: (b) => { b.box(1.0, 0.5, 0.6, 'darkWood', 0, -0.05, 0); b.box(1.02, 0.14, 0.62, 'darkWood', 0, 0.26, 0); for (const x of [-0.35, 0.35]) b.box(0.06, 0.66, 0.64, 'iron', x, 0.02, 0); b.box(0.1, 0.12, 0.04, 'iron', 0, 0.12, 0.31); } },
  anvil: { shape: { type: 'box', hx: 0.35, hy: 0.4, hz: 0.18 }, mass: 0, build: (b) => b.box(0.3, 0.5, 0.3, 'planks', 0, -0.15, 0).box(0.25, 0.15, 0.18, 'iron', 0, 0.17, 0).box(0.6, 0.12, 0.2, 'iron', 0, 0.3, 0).add(new THREE.ConeGeometry(0.1, 0.25, 4), 'iron', 0.4, 0.3, 0, 0, 0, -Math.PI / 2) },
  forge: { shape: { type: 'box', hx: 0.8, hy: 0.5, hz: 0.6 }, mass: 0, build: (b) => b.box(1.6, 0.9, 1.2, 'stoneWall', 0, -0.05, 0).box(1.0, 0.1, 0.7, 'ash', 0, 0.42, 0).box(1.2, 1.2, 0.4, 'stoneWall', 0, 1.0, -0.4).add(new THREE.ConeGeometry(0.5, 1.0, 4), 'stoneWall', 0, 1.9, -0.3, 0, Math.PI / 4) },
  hearth: { shape: { type: 'box', hx: 0.5, hy: 0.12, hz: 0.5 }, mass: 0, build: (b) => { for (let i = 0; i < 9; i++) b.add(new THREE.DodecahedronGeometry(0.12, 0), 'rock', Math.cos(i * 0.7) * 0.42, 0, Math.sin(i * 0.7) * 0.42); b.cyl(0.35, 0.35, 0.03, 'ash', 0, -0.08, 0); for (let i = 0; i < 3; i++) b.cyl(0.04, 0.05, 0.6, 'bark', 0, 0.02, 0, Math.PI / 2, i * 1.05, 0, 6); } },
  woodpile: { shape: { type: 'box', hx: 0.9, hy: 0.45, hz: 0.4 }, mass: 0, build: (b) => { for (let r = 0; r < 4; r++) for (let i = 0; i < 5 - r; i++) b.cyl(0.1, 0.1, 0.8, 'bark', (i - (4 - r) / 2) * 0.21, -0.35 + r * 0.19, 0, Math.PI / 2, 0, 0, 7); } },
  workbench: { shape: { type: 'box', hx: 0.9, hy: 0.45, hz: 0.4 }, mass: 0, build: (b) => { b.box(1.8, 0.12, 0.8, 'planks', 0, 0.4, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.12, 0.8, 0.12, 'darkWood', sx * 0.8, 0, sz * 0.32); b.box(0.3, 0.05, 0.05, 'iron', 0.3, 0.49, 0.1); } },
  weapon_rack: { shape: { type: 'box', hx: 0.8, hy: 0.8, hz: 0.2 }, mass: 0, build: (b) => { b.box(1.6, 0.08, 0.1, 'darkWood', 0, 0.6, 0); b.box(1.6, 0.08, 0.3, 'darkWood', 0, -0.7, 0.1); for (const sx of [-1, 1]) b.box(0.1, 1.6, 0.1, 'darkWood', sx * 0.75, 0, 0); } },
  pew: { shape: { type: 'box', hx: 1.2, hy: 0.45, hz: 0.25 }, mass: 0, build: (b) => { b.box(2.4, 0.06, 0.4, 'darkWood', 0, 0, 0); b.box(2.4, 0.6, 0.05, 'darkWood', 0, 0.3, -0.2); for (const sx of [-1, 1]) b.box(0.06, 0.9, 0.45, 'darkWood', sx * 1.15, 0.0, -0.02); } },
  altar: { shape: { type: 'box', hx: 0.9, hy: 0.5, hz: 0.45 }, mass: 0, build: (b) => b.box(1.8, 1.0, 0.9, 'stoneWall', 0, 0, 0).box(1.9, 0.02, 1.0, 'cloth', 0, 0.51, 0).box(0.06, 0.6, 0.06, 'gold', 0, 0.8, -0.2).box(0.35, 0.06, 0.06, 'gold', 0, 0.95, -0.2) },
  counter: { shape: { type: 'box', hx: 1.5, hy: 0.55, hz: 0.35 }, mass: 0, build: (b) => b.box(3.0, 1.1, 0.7, 'planks', 0, 0, 0).box(3.1, 0.06, 0.8, 'darkWood', 0, 0.57, 0) },
  stall: { shape: { type: 'box', hx: 1.2, hy: 0.45, hz: 0.6 }, mass: 0, build: (b) => { b.box(2.4, 0.08, 1.2, 'planks', 0, 0.45, 0); b.box(2.4, 0.9, 0.06, 'planks', 0, 0, 0.55); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.1, 2.4, 0.1, 'darkWood', sx * 1.15, 0.75, sz * 0.55); b.box(2.8, 0.04, 1.6, 'clothRed', 0, 1.95, 0, 0.15); } },
  well: { shape: { type: 'cyl', hh: 0.5, r: 1.0 }, mass: 0, build: (b) => { b.add(new THREE.CylinderGeometry(1.0, 1.05, 1.0, 16, 1, true), 'stoneWall', 0, 0, 0); b.add(new THREE.TorusGeometry(1.0, 0.12, 5, 16), 'stoneWall', 0, 0.5, 0, Math.PI / 2); for (const sx of [-1, 1]) b.box(0.14, 2.0, 0.14, 'darkWood', sx * 0.9, 1.0, 0); b.box(2.0, 0.12, 0.12, 'darkWood', 0, 1.95, 0); b.cyl(0.08, 0.08, 1.6, 'darkWood', 0, 1.6, 0, 0, 0, Math.PI / 2); b.add(new THREE.CylinderGeometry(0.95, 0.95, 0.02, 16), 'dirt', 0, -0.6, 0); } },
  tent: { shape: { type: 'box', hx: 1.4, hy: 1.0, hz: 1.8 }, mass: 0, build: (b) => { const g = new THREE.CylinderGeometry(0.01, 1.6, 2.0, 3, 1, false); b.add(g, 'cloth', 0, 0, 0, 0, 0, Math.PI / 2).parts.get('cloth')![0].scale(1, 1, 1.9); b.box(0.06, 2.0, 0.06, 'darkWood', 0, 0.0, 1.8).box(0.06, 2.0, 0.06, 'darkWood', 0, 0.0, -1.8); } },
  firering: { shape: { type: 'cyl', hh: 0.1, r: 0.6 }, mass: 0, build: (b) => { for (let i = 0; i < 10; i++) b.add(new THREE.DodecahedronGeometry(0.13, 0), 'rock', Math.cos(i * 0.63) * 0.55, 0, Math.sin(i * 0.63) * 0.55); b.cyl(0.45, 0.45, 0.03, 'ash', 0, -0.08, 0); for (let i = 0; i < 4; i++) b.cyl(0.05, 0.06, 0.8, 'charred', 0, 0.1, 0, 1.1, i * 0.8, 0, 6); } },
  skeleton: { shape: { type: 'box', hx: 0.3, hy: 0.1, hz: 0.9 }, mass: 0, build: (b) => { b.add(new THREE.SphereGeometry(0.1, 8, 6), 'paper', 0, 0.05, -0.8); for (let i = 0; i < 6; i++) b.box(0.3 - i * 0.02, 0.02, 0.03, 'paper', 0, 0.02, -0.55 + i * 0.07); b.cyl(0.02, 0.02, 0.6, 'paper', 0, 0.02, -0.4, Math.PI / 2); for (const sx of [-1, 1]) { b.cyl(0.02, 0.02, 0.8, 'paper', sx * 0.12, 0.02, 0.3, Math.PI / 2); b.cyl(0.015, 0.015, 0.55, 'paper', sx * 0.28, 0.02, -0.45, Math.PI / 2, 0, sx * 0.2); } } },
  wall_torch: { shape: { type: 'cyl', hh: 0.3, r: 0.05 }, mass: 0, build: (b) => b.cyl(0.025, 0.03, 0.6, 'darkWood', 0, 0, 0, -0.35).cyl(0.045, 0.035, 0.12, 'cloth', 0, 0.3, 0.1, -0.35).box(0.05, 0.2, 0.05, 'iron', 0, -0.1, -0.12) },
  torch_post: { shape: { type: 'cyl', hh: 1.1, r: 0.08 }, mass: 0, build: (b) => b.cyl(0.06, 0.08, 2.2, 'darkWood', 0, 0, 0).add(new THREE.CylinderGeometry(0.15, 0.08, 0.25, 8, 1, true), 'iron', 0, 1.15, 0) },
  stalagmite: { shape: { type: 'cyl', hh: 0.8, r: 0.3 }, mass: 0, build: (b) => b.add(new THREE.ConeGeometry(0.35, 1.6, 7), 'caveRock') },
  boulder: { shape: { type: 'ball', r: 1.0 }, mass: 0, build: (b) => b.add(new THREE.DodecahedronGeometry(1.0, 1), 'rock') },
  crops: { shape: { type: 'box', hx: 0.1, hy: 0.4, hz: 0.1 }, mass: 0, build: (b) => { for (let i = 0; i < 6; i++) b.cyl(0.006, 0.01, 0.9, 'straw', Math.cos(i) * 0.08, 0.45, Math.sin(i * 1.7) * 0.08, Math.cos(i * 2) * 0.1, 0, Math.sin(i * 3) * 0.1, 3); } },
  cauldron: { shape: { type: 'cyl', hh: 0.25, r: 0.35 }, mass: 0, build: (b) => b.add(new THREE.SphereGeometry(0.35, 12, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), 'iron', 0, 0.2, 0).cyl(0.3, 0.3, 0.02, 'meatCooked', 0, 0.12, 0) },
  ladder: { shape: { type: 'box', hx: 0.3, hy: 4, hz: 0.06 }, mass: 0, build: (b) => { for (const sx of [-1, 1]) b.box(0.07, 8, 0.07, 'darkWood', sx * 0.25, 0, 0); for (let i = 0; i < 16; i++) b.cyl(0.025, 0.025, 0.5, 'darkWood', 0, -3.8 + i * 0.5, 0, 0, 0, Math.PI / 2, 5); } },
  candle: { shape: { type: 'cyl', hh: 0.08, r: 0.03 }, mass: 0, build: (b) => b.cyl(0.025, 0.025, 0.16, 'paper', 0, 0, 0).cyl(0.05, 0.06, 0.02, 'iron', 0, -0.08, 0) },
  cart: { shape: { type: 'box', hx: 0.8, hy: 0.5, hz: 1.3 }, mass: 0, build: (b) => { b.box(1.4, 0.08, 2.4, 'planks', 0, 0.2, 0); for (const sx of [-1, 1]) { b.box(0.06, 0.45, 2.4, 'planks', sx * 0.68, 0.45, 0); b.add(new THREE.TorusGeometry(0.45, 0.05, 5, 12), 'darkWood', sx * 0.8, -0.05, 0.2, 0, Math.PI / 2); } b.box(0.08, 0.08, 1.6, 'darkWood', 0.2, 0.2, 1.9).box(0.08, 0.08, 1.6, 'darkWood', -0.2, 0.2, 1.9); } },
};

export interface ModelInstance {
  object: THREE.Object3D;
  shape: Shape;
  mass: number;
}

export class ModelLibrary {
  private cache = new Map<string, THREE.Group>();
  constructor(private readonly mats: MaterialLibrary) {}

  has(id: string): boolean {
    return id in D;
  }

  private template(id: string): THREE.Group {
    let g = this.cache.get(id);
    if (g) return g;
    const def = D[id];
    if (!def) throw new Error(`Modelo desconocido: ${id}`);
    const b = new Builder();
    def.build(b);
    g = new THREE.Group();
    for (const [mat, geos] of b.parts) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.mats.get(mat));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    g.name = id;
    this.cache.set(id, g);
    return g;
  }

  create(id: string): ModelInstance {
    const def = D[id];
    const obj = this.template(id).clone(true);
    return { object: obj, shape: def.shape, mass: def.mass };
  }

  shape(id: string): Shape {
    return D[id].shape;
  }
}
