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
const MAX = 16000;

/**
 * Atlas 2×2 de matas: 0 hierba verde, 1 hierba con espigas, 2 hierba
 * seca, 3 hierba con flores silvestres.
 */
function grassAtlas(): THREE.Texture {
  const S = 256, W = S * 2;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const g = c.getContext('2d')!;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tuft = (ox: number, oy: number, kind: number) => {
    const blades = 70;
    for (let i = 0; i < blades; i++) {
      const x = ox + 10 + rnd() * (S - 20);
      const h = S * (0.35 + rnd() * 0.6) * (kind === 2 ? 0.8 : 1);
      const lean = (rnd() - 0.5) * 60;
      const w = 1.5 + rnd() * 2.2;
      const tone = 0.65 + rnd() * 0.55;
      const grd = g.createLinearGradient(0, oy + S, 0, oy + S - h);
      if (kind === 2) {
        grd.addColorStop(0, `rgb(${60 * tone | 0},${55 * tone | 0},${28 * tone | 0})`);
        grd.addColorStop(1, `rgb(${170 * tone | 0},${150 * tone | 0},${90 * tone | 0})`);
      } else {
        grd.addColorStop(0, `rgb(${30 * tone | 0},${44 * tone | 0},${14 * tone | 0})`);
        grd.addColorStop(0.6, `rgb(${70 * tone | 0},${92 * tone | 0},${32 * tone | 0})`);
        grd.addColorStop(1, `rgb(${112 * tone | 0},${124 * tone | 0},${58 * tone | 0})`);
      }
      g.fillStyle = grd;
      const bx = x, by = oy + S;
      g.beginPath();
      g.moveTo(bx - w, by);
      g.quadraticCurveTo(bx + lean * 0.3, by - h * 0.55, bx + lean, by - h);
      g.quadraticCurveTo(bx + lean * 0.3 + w * 0.4, by - h * 0.55, bx + w, by);
      g.closePath();
      g.fill();
      if (kind === 1 && i % 6 === 0) {
        // Espiga.
        g.fillStyle = `rgb(${150 * tone | 0},${135 * tone | 0},${80 * tone | 0})`;
        g.beginPath();
        g.ellipse(bx + lean, by - h, 3, 11, lean * 0.01, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (kind === 3) {
      const cols = ['#e8e2d0', '#d9c24a', '#b04a6a', '#7a6ac8', '#e8e2d0'];
      for (let i = 0; i < 14; i++) {
        const fx = ox + 20 + rnd() * (S - 40), fy = oy + S * (0.25 + rnd() * 0.45);
        g.strokeStyle = '#3d5a1c';
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + (rnd() - 0.5) * 10, oy + S); g.stroke();
        g.fillStyle = cols[i % cols.length];
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2;
          g.beginPath(); g.ellipse(fx + Math.cos(a) * 4, fy + Math.sin(a) * 4, 3.5, 2.2, a, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#e0b030';
        g.beginPath(); g.arc(fx, fy, 2.2, 0, Math.PI * 2); g.fill();
      }
    }
  };
  tuft(0, 0, 0); tuft(S, 0, 1); tuft(0, S, 2); tuft(S, S, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private cache = new Map<string, { m: THREE.Matrix4; v: number }[]>();
  private variant: THREE.InstancedBufferAttribute;
  private tmpC = new THREE.Color();
  enabled = true;
  count = 0;

  constructor(private readonly hf: Heightfield, scene: THREE.Scene, private readonly blocked: (x: number, z: number) => boolean) {
    // Dos planos cruzados con pivote en la base.
    const p1 = new THREE.PlaneGeometry(0.75, 0.5).translate(0, 0.25, 0);
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
    const mat = new THREE.MeshStandardMaterial({ map: grassAtlas(), alphaTest: 0.45, side: THREE.FrontSide, roughness: 1, alphaToCoverage: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = GlobalUniforms.uTime;
      shader.uniforms.uWind = GlobalUniforms.uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nattribute float aVariant;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          // Celda del atlas (fila 0 del lienzo = mitad superior en UV).
          vMapUv = vMapUv * 0.5 + vec2(mod(aVariant, 2.0), 1.0 - floor(aVariant / 2.0)) * 0.5;`)
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
    this.variant = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    geo.setAttribute('aVariant', this.variant);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // Sin sombras recibidas: los planos verticales producen "acné" (matas negras).
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  private cell(cx: number, cz: number): { m: THREE.Matrix4; v: number }[] {
    const key = `${cx},${cz}`;
    let list = this.cache.get(key);
    if (list) return list;
    list = [];
    const n = 44;
    for (let i = 0; i < n; i++) {
      const x = (cx + hash2(cx * 31 + i, cz, 5)) * CELL;
      const z = (cz + hash2(cx, cz * 17 + i, 9)) * CELL;
      const w = this.hf.surfaceWeights(x, z);
      if (w.road > 0.3 || w.field > 0.5 || w.camp > 0.5 || w.beach > 0.25) continue;
      const vill = w.village;
      if (vill > 0.4 && hash2(i, cx + cz, 3) < 0.8) continue; // pisoteado en el pueblo
      if (this.hf.waterLevelAt(x, z) !== null) continue;
      const nrm = this.hf.normalAt(x, z, 1);
      if (nrm.y < 0.8) continue;
      if (this.blocked(x, z)) continue;
      const y = this.hf.heightAt(x, z);
      const s = 0.65 + hash2(i, cx * 7, cz) * 0.75;
      // Variante: más seca en zonas pisadas, flores en claros.
      const r = hash2(cx * 13 + i, cz * 3, 21);
      const v = vill > 0.2 && r < 0.5 ? 2 : r < 0.62 ? 0 : r < 0.82 ? 1 : r < 0.955 ? 2 : 3;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y - 0.03, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(i, cz, cx) * 6.28),
        new THREE.Vector3(s, s * (0.8 + hash2(cz, i, 1) * 0.6), s),
      );
      list.push({ m, v });
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
        for (const { m, v } of this.cell(cx, cz)) {
          if (n >= MAX) break;
          this.mesh.setMatrixAt(n, m);
          this.variant.setX(n, v);
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
    this.variant.needsUpdate = true;
  }
}
