/**
 * Detalle del suelo alrededor de la cámara: rocas, arbustos, helechos y
 * ramas caídas. Un InstancedMesh por tipo (4 draw calls), colocación
 * determinista por celdas según la densidad de bosque y la pendiente.
 * Solo visual (sin colisión): son objetos pequeños que se pisan.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from './Heightfield';
import { hash2, Rng } from '../core/rng';
import type { MaterialLibrary } from '../engine/placeholder/Materials';
import { bushFoliage, fernFoliage } from '../engine/placeholder/FoliageTextures';
import { foliageMaterial } from './TreeModels';

const CELL = 12;

type Kind = 'rock' | 'bush' | 'fern' | 'branch';
const MAX: Record<Kind, number> = { rock: 1400, bush: 1200, fern: 2400, branch: 700 };

export function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const rng = new Rng(seed);
  const k = [rng.range(0.7, 1.3), rng.range(0.45, 0.7), rng.range(0.7, 1.2)];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + (hash2(Math.round(x * 10), Math.round(y * 10) * 31 + Math.round(z * 10), seed) - 0.5) * 0.35;
    p.setXYZ(i, x * k[0] * n, Math.max(y, -0.3) * k[1] * n, z * k[2] * n);
  }
  g.computeVertexNormals();
  return g;
}

function crossCards(n: number, w: number, h: number, tilt: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
    g.rotateX(-tilt);
    g.rotateY((i / n) * Math.PI);
    parts.push(g.toNonIndexed());
  }
  const m = mergeGeometries(parts)!;
  // Normales hacia arriba/fuera (iluminación suave de planta).
  const nor = m.attributes.normal as THREE.BufferAttribute;
  const pos = m.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), 0.8, pos.getZ(i)).normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ao = 0.55 + 0.45 * Math.min(1, pos.getY(i) / h);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return m;
}

function fernGeometry(): THREE.BufferGeometry {
  // Frondas radiales arqueadas.
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.PlaneGeometry(0.28, 0.75, 1, 3).translate(0, 0.375, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let j = 0; j < p.count; j++) {
      const y = p.getY(j);
      p.setZ(j, y * y * 0.9); // arco hacia fuera
      p.setY(j, y * 0.75);
    }
    g.rotateX(-0.35);
    g.rotateY((i / 7) * Math.PI * 2 + (i % 2) * 0.3);
    parts.push(g.toNonIndexed());
  }
  const m = mergeGeometries(parts)!;
  m.computeVertexNormals();
  const nor = m.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, nor.getX(i) * 0.3, 0.95, nor.getZ(i) * 0.3);
  const col = new Float32Array(m.attributes.position.count * 3).fill(1);
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return m;
}

function branchGeometry(): THREE.BufferGeometry {
  const a = new THREE.CylinderGeometry(0.035, 0.05, 1.8, 6).rotateZ(Math.PI / 2).translate(0, 0.04, 0);
  const b = new THREE.CylinderGeometry(0.015, 0.025, 0.6, 5).rotateZ(Math.PI / 2 - 0.5).translate(0.35, 0.1, 0.12);
  const c = new THREE.CylinderGeometry(0.012, 0.02, 0.45, 5).rotateZ(Math.PI / 2 + 0.6).translate(-0.4, 0.08, -0.1);
  const m = mergeGeometries([a.toNonIndexed(), b.toNonIndexed(), c.toNonIndexed()])!;
  return m;
}

interface Item { m: THREE.Matrix4; k: Kind; tint: number }

export class GroundScatter {
  private meshes: Record<Kind, THREE.InstancedMesh>;
  private cache = new Map<string, Item[]>();
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private tmpC = new THREE.Color();
  enabled = true;

  constructor(
    private readonly hf: Heightfield,
    scene: THREE.Scene,
    mats: MaterialLibrary,
    private readonly blocked: (x: number, z: number) => boolean,
    private readonly radius = 70,
  ) {
    const rockMat = mats.get('rock');
    const barkMat = mats.get('bark');
    const bushMat = foliageMaterial(bushFoliage(256), 0.5);
    const fernMat = foliageMaterial(fernFoliage(128, 256), 0.4);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, k: Kind, shadow: boolean) => {
      const im = new THREE.InstancedMesh(geo, mat, MAX[k]);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX[k] * 3), 3);
      scene.add(im);
      return im;
    };
    this.meshes = {
      rock: mk(rockGeometry(7), rockMat, 'rock', true),
      bush: mk(crossCards(3, 1.6, 1.1, 0.12), bushMat, 'bush', true),
      fern: mk(fernGeometry(), fernMat, 'fern', false),
      branch: mk(branchGeometry(), barkMat, 'branch', false),
    };
  }

  private cell(cx: number, cz: number): Item[] {
    const key = `${cx},${cz}`;
    let list = this.cache.get(key);
    if (list) return list;
    list = [];
    const rng = new Rng((cx * 92821) ^ (cz * 68917) ^ 0xa11);
    const tries = 14;
    for (let i = 0; i < tries; i++) {
      const x = (cx + rng.next()) * CELL, z = (cz + rng.next()) * CELL;
      if (this.hf.waterLevelAt(x, z) !== null || this.hf.isHole(x, z)) continue;
      const w = this.hf.surfaceWeights(x, z);
      if (w.road > 0.2 || w.field > 0.3 || w.village > 0.5 || w.camp > 0.6 || w.beach > 0.3) continue;
      if (this.blocked(x, z)) continue;
      const forest = this.hf.forestDensity(x, z);
      const n = this.hf.normalAt(x, z, 1);
      const r = rng.next();
      let k: Kind | null = null;
      if (n.y < 0.85) k = r < 0.7 ? 'rock' : null;
      else if (forest > 0.3) k = r < 0.4 ? 'fern' : r < 0.62 ? 'bush' : r < 0.78 ? 'branch' : r < 0.88 ? 'rock' : null;
      else k = r < 0.08 ? 'rock' : r < 0.16 ? 'bush' : null;
      if (!k) continue;
      const y = this.hf.heightAt(x, z);
      let s = 1;
      if (k === 'rock') s = rng.range(0.15, n.y < 0.85 ? 0.9 : 0.5);
      else if (k === 'bush') s = rng.range(0.6, 1.2);
      else if (k === 'fern') s = rng.range(0.6, 1.1);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
      if (k === 'rock' || k === 'branch') {
        // Alinear con la pendiente.
        q.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z)));
      }
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - (k === 'rock' ? s * 0.15 : 0.02), z), q, new THREE.Vector3(s, s, s));
      list.push({ m, k, tint: rng.range(0.75, 1.1) });
    }
    this.cache.set(key, list);
    if (this.cache.size > 900) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    return list;
  }

  update(cam: THREE.Vector3, force = false): void {
    for (const m of Object.values(this.meshes)) m.visible = this.enabled;
    if (!this.enabled) return;
    if (!force && Math.hypot(cam.x - this.last.x, cam.z - this.last.z) < 8) return;
    this.last.copy(cam);
    const R = this.radius;
    const counts: Record<Kind, number> = { rock: 0, bush: 0, fern: 0, branch: 0 };
    const c0x = Math.floor((cam.x - R) / CELL), c1x = Math.floor((cam.x + R) / CELL);
    const c0z = Math.floor((cam.z - R) / CELL), c1z = Math.floor((cam.z + R) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const dx = (cx + 0.5) * CELL - cam.x, dz = (cz + 0.5) * CELL - cam.z;
        if (dx * dx + dz * dz > R * R) continue;
        for (const it of this.cell(cx, cz)) {
          const n = counts[it.k];
          if (n >= MAX[it.k]) continue;
          const mesh = this.meshes[it.k];
          mesh.setMatrixAt(n, it.m);
          this.tmpC.setRGB(it.tint, it.tint * (it.k === 'bush' || it.k === 'fern' ? 1.02 : 1), it.tint * 0.95);
          mesh.setColorAt(n, this.tmpC);
          counts[it.k] = n + 1;
        }
      }
    }
    for (const k of Object.keys(this.meshes) as Kind[]) {
      const mesh = this.meshes[k];
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
