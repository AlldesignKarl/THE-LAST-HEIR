/**
 * Cueva del Cuervo: túnel procedural bajo la colina (malla + trimesh).
 * El terreno tiene un hueco sobre la boca (Heightfield.isHole); el túnel
 * lo sustituye. Dentro, la luz ambiente se apaga: sin antorcha no se ve.
 */
import * as THREE from 'three';
import type { Heightfield } from './Heightfield';
import { CAVE } from './WorldLayout';
import { Physics, RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import type { MaterialLibrary } from '../engine/placeholder/Materials';
import { hash2 } from '../core/rng';
import { pointSegmentDist } from '../core/math';

const RING = 16;

export class Cave {
  readonly mesh: THREE.Mesh;
  readonly collider: RAPIER.Collider;
  readonly floorY0: number;
  /** Puntos del eje (mundo) con suelo y radio. */
  readonly axis: { x: number; y: number; z: number; r: number }[] = [];

  constructor(hf: Heightfield, physics: Physics, scene: THREE.Scene, mats: MaterialLibrary) {
    this.floorY0 = hf.heightAt(CAVE.mouth.x, CAVE.mouth.z) - 0.06;
    const ctrl = CAVE.path.map((p) => new THREE.Vector3(p.x, this.floorY0 + p.dy, p.z));
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const radii = CAVE.path.map((p) => p.r);
    const segs = 90;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const frames = curve.computeFrenetFrames(segs, false);
    const up = new THREE.Vector3(0, 1, 0);
    let dist = 0;
    let prev = curve.getPointAt(0);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const c = curve.getPointAt(t);
      dist += c.distanceTo(prev);
      prev = c;
      const tan = frames.tangents[i].clone().setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(tan, up).normalize();
      // Radio interpolado entre puntos de control.
      const f = t * (radii.length - 1);
      const i0 = Math.floor(f), i1 = Math.min(radii.length - 1, i0 + 1);
      const r = radii[i0] + (radii[i1] - radii[i0]) * (f - i0);
      const floor = c.y;
      const center = floor + r * 0.62;
      this.axis.push({ x: c.x, y: floor, z: c.z, r });
      for (let k = 0; k <= RING; k++) {
        const a = (k / RING) * Math.PI * 2;
        const n = hash2(i, k % RING, 91) - 0.5;
        const rr = r * (1 + n * 0.28) * (i === 0 ? 1.05 : 1);
        let x = c.x + right.x * Math.cos(a) * rr * 1.12;
        let z = c.z + right.z * Math.cos(a) * rr * 1.12;
        let y = center + Math.sin(a) * rr * 0.8;
        if (y < floor) {
          // Suelo plano con leve irregularidad.
          y = floor + (hash2(i, k, 7) - 0.5) * 0.06;
          x = c.x + right.x * Math.cos(a) * rr * 1.0;
          z = c.z + right.z * Math.cos(a) * rr * 1.0;
        }
        pos.push(x, y, z);
        uv.push((k / RING) * 4, dist / 3);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let k = 0; k < RING; k++) {
        const a = i * (RING + 1) + k, b = a + 1, cc = a + RING + 1, d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    // Tapa del fondo.
    const endCenter = pos.length / 3;
    const last = this.axis[this.axis.length - 1];
    pos.push(last.x, last.y + last.r * 0.6, last.z);
    uv.push(0.5, 0.5);
    for (let k = 0; k < RING; k++) {
      const a = segs * (RING + 1) + k;
      idx.push(a, a + 1, endCenter);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Normales hacia dentro para la iluminación interior.
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    const mat = mats.get('caveRock').clone();
    mat.side = THREE.DoubleSide;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    const verts = new Float32Array(pos);
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(idx)).setCollisionGroups(groups(GROUP.STATIC, ALL)),
    );
    physics.tag(this.collider, { kind: 'cave', id: CAVE.id });
  }

  /** Profundidad dentro de la cueva (0 fuera, 1 dentro del todo). */
  depthAt(x: number, y: number, z: number): number {
    let best = Infinity, bestI = 0;
    for (let i = 0; i < this.axis.length - 1; i++) {
      const a = this.axis[i], b = this.axis[i + 1];
      const { d } = pointSegmentDist(x, z, a.x, a.z, b.x, b.z);
      if (d < best) { best = d; bestI = i; }
    }
    const a = this.axis[bestI];
    if (best > a.r * 1.4 + 0.5) return 0;
    if (y > a.y + a.r * 2 + 1 || y < a.y - 2) return 0;
    // Avance a lo largo del túnel: los primeros metros aún llegan luz.
    const along = bestI / (this.axis.length - 1);
    return Math.min(1, Math.max(0, (along - 0.04) / 0.14));
  }

  /** Punto del eje a una fracción del recorrido (para colocar cosas). */
  pointAt(frac: number): { x: number; y: number; z: number; r: number } {
    return this.axis[Math.round(frac * (this.axis.length - 1))];
  }
}
