/**
 * Hierba y matas alrededor de la cámara: InstancedMesh único (1 draw call)
 * con celdas deterministas que se recalculan al moverse, alpha-test y
 * balanceo por viento en el vertex shader.
 */
import * as THREE from 'three';
import type { Heightfield } from './Heightfield';
import { hash2 } from '../core/rng';
import { GlobalUniforms } from '../engine/placeholder/Materials';

const CELL = 8;
const RADIUS = 42;
const MAX = 9000;

function grassTexture(): THREE.Texture {
  const W = 128, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 38; i++) {
    const x = 6 + Math.random() * (W - 12);
    const h = H * (0.45 + Math.random() * 0.55);
    const lean = (Math.random() - 0.5) * 30;
    const w = 2 + Math.random() * 3;
    const grd = g.createLinearGradient(0, H, 0, H - h);
    const tone = 0.7 + Math.random() * 0.5;
    grd.addColorStop(0, `rgb(${40 * tone | 0},${52 * tone | 0},${18 * tone | 0})`);
    grd.addColorStop(1, `rgb(${120 * tone | 0},${130 * tone | 0},${60 * tone | 0})`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x - w, H);
    g.quadraticCurveTo(x + lean * 0.3, H - h * 0.5, x + lean, H - h);
    g.quadraticCurveTo(x + lean * 0.3 + w * 0.5, H - h * 0.5, x + w, H);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private cache = new Map<string, THREE.Matrix4[]>();
  private tmpC = new THREE.Color();
  enabled = true;
  count = 0;

  constructor(private readonly hf: Heightfield, scene: THREE.Scene, private readonly blocked: (x: number, z: number) => boolean) {
    // Dos planos cruzados con pivote en la base.
    const p1 = new THREE.PlaneGeometry(0.9, 0.55).translate(0, 0.275, 0);
    const p2 = p1.clone().rotateY(Math.PI / 2);
    const p3 = p1.clone().rotateY(Math.PI / 4);
    const geo = new THREE.BufferGeometry();
    const merged = [p1, p2, p3].map((g) => g.toNonIndexed());
    const pos: number[] = [], uv: number[] = [], nor: number[] = [];
    for (const g of merged) {
      const P = g.attributes.position.array as Float32Array;
      const U = g.attributes.uv.array as Float32Array;
      // Cara delantera y cara trasera (triángulos invertidos), ambas con normal
      // hacia arriba: la hierba se ilumina como el suelo por los dos lados.
      for (const flip of [false, true]) {
        for (let t = 0; t < P.length / 9; t++) {
          const order = flip ? [0, 2, 1] : [0, 1, 2];
          for (const k of order) {
            const vi = t * 3 + k;
            pos.push(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]);
            uv.push(U[vi * 2], U[vi * 2 + 1]);
            nor.push(0, 1, 0);
          }
        }
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.45, side: THREE.FrontSide, roughness: 1 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = GlobalUniforms.uTime;
      shader.uniforms.uWind = GlobalUniforms.uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec4 wp = instanceMatrix * vec4(transformed, 1.0);
            float k = clamp(transformed.y / 0.55, 0.0, 1.0);
            float s = sin(uTime * 2.1 + wp.x * 0.35 + wp.z * 0.27) * 0.6 + sin(uTime * 3.7 + wp.x) * 0.25;
            transformed.x += s * uWind * 0.18 * k * k;
            transformed.z += s * uWind * 0.1 * k * k;
          }`);
    };
    mat.customProgramCacheKey = () => 'grass';
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // Sin sombras recibidas: los planos verticales producen "acné" (matas negras).
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  private cell(cx: number, cz: number): THREE.Matrix4[] {
    const key = `${cx},${cz}`;
    let list = this.cache.get(key);
    if (list) return list;
    list = [];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const x = (cx + hash2(cx * 31 + i, cz, 5)) * CELL;
      const z = (cz + hash2(cx, cz * 17 + i, 9)) * CELL;
      const w = this.hf.surfaceWeights(x, z);
      if (w.road > 0.3 || w.field > 0.5 || w.camp > 0.5) continue;
      const vill = w.village;
      if (vill > 0.4 && hash2(i, cx + cz, 3) < 0.8) continue; // pisoteado en el pueblo
      if (this.hf.waterLevelAt(x, z) !== null) continue;
      const nrm = this.hf.normalAt(x, z, 1);
      if (nrm.y < 0.8) continue;
      if (this.blocked(x, z)) continue;
      const y = this.hf.heightAt(x, z);
      const s = 0.7 + hash2(i, cx * 7, cz) * 0.8;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y - 0.03, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(i, cz, cx) * 6.28),
        new THREE.Vector3(s, s * (0.8 + hash2(cz, i, 1) * 0.6), s),
      );
      list.push(m);
    }
    this.cache.set(key, list);
    if (this.cache.size > 1200) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    return list;
  }

  update(cam: THREE.Vector3, force = false): void {
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    if (!force && Math.hypot(cam.x - this.last.x, cam.z - this.last.z) < 5) return;
    this.last.copy(cam);
    const c0x = Math.floor((cam.x - RADIUS) / CELL), c1x = Math.floor((cam.x + RADIUS) / CELL);
    const c0z = Math.floor((cam.z - RADIUS) / CELL), c1z = Math.floor((cam.z + RADIUS) / CELL);
    let n = 0;
    for (let cz = c0z; cz <= c1z && n < MAX; cz++) {
      for (let cx = c0x; cx <= c1x && n < MAX; cx++) {
        const ccx = (cx + 0.5) * CELL - cam.x, ccz = (cz + 0.5) * CELL - cam.z;
        if (ccx * ccx + ccz * ccz > RADIUS * RADIUS) continue;
        for (const m of this.cell(cx, cz)) {
          if (n >= MAX) break;
          this.mesh.setMatrixAt(n, m);
          const t = 0.8 + hash2(n, cx, cz) * 0.35;
          this.tmpC.setRGB(t, t * (0.95 + hash2(cz, n, 2) * 0.1), t * 0.85);
          this.mesh.setColorAt(n, this.tmpC);
          n++;
        }
      }
    }
    this.count = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
