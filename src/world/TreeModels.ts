/**
 * PLACEHOLDER · Modelos procedurales de árboles con follaje de tarjetas.
 *
 * Tronco y ramas: cilindros deformados con UV de corteza a escala real.
 * Copa: decenas de "tarjetas" (quads) con textura de racimos de hojas y
 * alphaTest. Las normales de las tarjetas apuntan hacia fuera de la copa
 * (iluminación volumétrica suave) y un color por vértice aporta oclusión
 * ambiental (interior y parte baja de la copa más oscuros).
 * La LOD lejana usa pocas tarjetas grandes con la misma textura.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { injectWind } from '../engine/placeholder/Materials';

export interface SpeciesGeo {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  farTrunk: THREE.BufferGeometry;
  farCanopy: THREE.BufferGeometry;
  trunkHeight: number;
}

// ------------------------------------------------------------ utilidades

/** Deja solo posición, normal, uv y color (para poder fusionar). */
function normalize(g: THREE.BufferGeometry, color = 1): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) ng.deleteAttribute(k);
  if (!ng.attributes.color) {
    const c = new Float32Array(ng.attributes.position.count * 3).fill(color);
    ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return ng;
}

/**
 * Rama/tronco: cilindro cónico a lo largo de una curva cuadrática, con
 * UV de corteza a escala (1 repetición cada ~1,2 m).
 */
function limb(
  p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3,
  r0: number, r1: number, radial: number, segs: number, rng: Rng, flare = 0,
): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const pt = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const len = p0.distanceTo(p1) + p1.distanceTo(p2);
  const circ = Math.max(1, Math.round((r0 * Math.PI * 2) / 0.9));
  const wob = rng.range(0, 10);
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    // Bézier cuadrática.
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    pt.set(p0.x * a + p1.x * b + p2.x * c, p0.y * a + p1.y * b + p2.y * c, p0.z * a + p1.z * b + p2.z * c);
    tan.set(
      2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
      2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
      2 * (1 - t) * (p1.z - p0.z) + 2 * t * (p2.z - p1.z),
    ).normalize();
    side.set(0, 1, 0);
    if (Math.abs(tan.dot(side)) > 0.95) side.set(1, 0, 0);
    side.crossVectors(tan, side).normalize();
    up.crossVectors(side, tan).normalize();
    let r = r0 + (r1 - r0) * t;
    if (flare > 0) r *= 1 + flare * Math.max(0, 1 - t * 6) ** 2;
    for (let i = 0; i <= radial; i++) {
      const ang = (i / radial) * Math.PI * 2;
      // Irregularidad de la corteza/raíces.
      const rr = r * (1 + 0.08 * Math.sin(ang * 3 + wob + t * 4) + (flare > 0 ? 0.25 * Math.max(0, 1 - t * 8) * Math.sin(ang * 5 + wob) : 0));
      const nx = side.x * Math.cos(ang) + up.x * Math.sin(ang);
      const ny = side.y * Math.cos(ang) + up.y * Math.sin(ang);
      const nz = side.z * Math.cos(ang) + up.z * Math.sin(ang);
      pos.push(pt.x + nx * rr, pt.y + ny * rr, pt.z + nz * rr);
      nor.push(nx, ny, nz);
      uv.push((i / radial) * circ, (t * len) / 1.2);
      const ao = 0.65 + 0.35 * Math.min(1, t * 3 + 0.2);
      col.push(ao, ao, ao);
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i, b = a + 1, c = a + radial + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g.toNonIndexed();
}

/** Acumulador de tarjetas de follaje. */
class Cards {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  private v = new THREE.Vector3();

  /**
   * Añade un quad. `origin` es el centro (o el borde si `anchorEdge`),
   * `normalOf` da la normal de iluminación por vértice y `aoOf` la oclusión.
   */
  add(
    origin: THREE.Vector3, w: number, h: number, rot: THREE.Quaternion,
    normalOf: (p: THREE.Vector3) => THREE.Vector3, aoOf: (p: THREE.Vector3, u: number, v: number) => number,
    anchorEdge = false, flipU = false,
  ): void {
    const corners: [number, number][] = anchorEdge ? [[0, -0.5], [1, -0.5], [1, 0.5], [0, 0.5]] : [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const verts: THREE.Vector3[] = [];
    const vuv: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      this.v.set(corners[i][0] * w, corners[i][1] * h, 0).applyQuaternion(rot).add(origin);
      verts.push(this.v.clone());
      vuv.push([flipU ? 1 - uvs[i][0] : uvs[i][0], uvs[i][1]]);
    }
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = verts[i];
      this.pos.push(p.x, p.y, p.z);
      const n = normalOf(p);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(vuv[i][0], vuv[i][1]);
      const ao = aoOf(p, vuv[i][0], vuv[i][1]);
      this.col.push(ao, ao * 1.01, ao * 0.97);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const randomQuatFacing = (rng: Rng, dir: THREE.Vector3, spread: number): THREE.Quaternion => {
  // Normal de la tarjeta: dirección exterior perturbada; giro libre alrededor de ella.
  const n = dir.clone().add(new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(spread)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rng.range(0, Math.PI * 2)));
  return q;
};

// ------------------------------------------------------------ roble

/** `detail` 0..1 escala el número de tarjetas (calidad). */
export function buildOak(detail: number, seed = 1): SpeciesGeo {
  const rng = new Rng(seed * 977 + 13);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const trunkH = 5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(limb(V(0, -0.3, 0), V(0.1, 2.4, 0.05), V(0.05, trunkH, -0.05), 0.44, 0.26, 10, 7, rng, 0.45));
  // Ramas principales hacia los racimos.
  const clusters: [number, number, number, number][] = [
    [0, 6.6, 0, 2.5], [1.8, 5.7, 0.7, 1.9], [-1.6, 5.9, -0.6, 2.0], [0.4, 7.9, -1.0, 1.7],
    [-0.5, 5.6, 1.7, 1.8], [1.0, 6.2, -1.8, 1.6], [-1.9, 7.1, 1.0, 1.5],
  ];
  for (const [x, y, z] of clusters.slice(1)) {
    const start = V(rng.range(-0.1, 0.1), rng.range(3.6, 4.8), rng.range(-0.1, 0.1));
    const end = V(x * 0.85, y - 0.6, z * 0.85);
    const mid = start.clone().lerp(end, 0.5).add(V(0, 0.6, 0));
    parts.push(limb(start, mid, end, 0.15, 0.05, 6, 4, rng));
  }
  const trunk = mergeGeometries(parts.map((p) => normalize(p)))!;

  const center = V(0, 6.5, 0);
  const crownBottom = 4.3, crownTop = 9.6;
  const cards = new Cards();
  const tmpN = new THREE.Vector3();
  const normalOf = (p: THREE.Vector3) => tmpN.copy(p).sub(center).multiply(V(1, 0.8, 1)).normalize().lerp(V(0, 1, 0), 0.15).normalize();
  const aoOf = (p: THREE.Vector3) => {
    const hT = Math.min(1, Math.max(0, (p.y - crownBottom) / (crownTop - crownBottom)));
    const r = p.clone().sub(center).length() / 3.4;
    return 0.42 + 0.58 * Math.min(1, hT * 0.7 + r * 0.55);
  };
  const density = 3.2 * detail + 1.2;
  for (const [x, y, z, r] of clusters) {
    const cc = V(x, y, z);
    const n = Math.max(4, Math.round(r * r * density));
    for (let i = 0; i < n; i++) {
      // Punto en el volumen del racimo, sesgado hacia la superficie.
      const dir = V(rng.range(-1, 1), rng.range(-0.7, 1), rng.range(-1, 1)).normalize();
      const d = r * Math.pow(rng.range(0.25, 1), 0.5) * 0.85;
      const p = cc.clone().addScaledVector(dir, d);
      const out = p.clone().sub(center).normalize();
      const size = rng.range(1.7, 2.4) * (0.8 + r * 0.1);
      cards.add(p, size, size, randomQuatFacing(rng, out, 0.9), normalOf, aoOf, false, rng.next() < 0.5);
    }
  }
  const canopy = cards.geometry();

  // LOD lejana: tronco simple + 9 tarjetas grandes.
  const farTrunk = normalize(limb(V(0, -0.3, 0), V(0, 2.5, 0), V(0, trunkH + 1, 0), 0.4, 0.2, 5, 2, rng));
  const far = new Cards();
  const farSpots: [number, number, number, number][] = [[0, 6.6, 0, 3.4], [1.6, 5.8, 0.6, 2.4], [-1.5, 6.0, -0.6, 2.4], [0.2, 7.9, -0.6, 2.2]];
  for (const [x, y, z, s] of farSpots) {
    for (let k = 0; k < 3; k++) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(k === 2 ? -Math.PI / 2 + 0.3 : rng.range(-0.3, 0.3), (k * Math.PI) / 3 + rng.range(0, 1), 0));
      far.add(V(x, y, z), s * 1.6, s * 1.5, q, normalOf, aoOf, false, k % 2 === 1);
    }
  }
  return { trunk, canopy, farTrunk, farCanopy: far.geometry(), trunkHeight: trunkH };
}

// ------------------------------------------------------------ pino

export function buildPine(detail: number, seed = 2): SpeciesGeo {
  const rng = new Rng(seed * 733 + 5);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const H = 12.6;
  const trunk = normalize(limb(V(0, -0.3, 0), V(0.05, H * 0.5, 0.03), V(0, H, 0), 0.34, 0.05, 8, 8, rng, 0.35));
  const cards = new Cards();
  const tmpN = new THREE.Vector3();
  const axis = V(0, 0, 0);
  const normalOf = (p: THREE.Vector3) => {
    axis.set(0, p.y, 0);
    return tmpN.copy(p).sub(axis).normalize().multiplyScalar(0.8).add(V(0, 0.75, 0)).normalize();
  };
  const aoOf = (p: THREE.Vector3, u: number) => {
    const hT = Math.min(1, Math.max(0, (p.y - 2.5) / (H - 2.5)));
    return (0.45 + 0.35 * hT) * (0.7 + 0.3 * u) + 0.1;
  };
  const whorls = Math.round(8 + detail * 4);
  for (let wI = 0; wI < whorls; wI++) {
    const t = wI / (whorls - 1);
    const y = 2.6 + t * (H - 3.2);
    const len = 2.9 - t * 2.4 + rng.range(-0.2, 0.2);
    const n = Math.max(5, Math.round((7 + detail * 4) * (1 - t * 0.35)));
    const off = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const droop = -0.28 - (1 - t) * 0.12 + rng.range(-0.1, 0.1);
      // Tarjeta anclada en el tronco: eje X local = dirección de la rama
      // (girada `a` en planta y caída `droop`), plano casi horizontal.
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, droop));
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + rng.range(-0.35, 0.35), 0, 0)));
      cards.add(V(0, y, 0), len, len * 0.85, q, normalOf, aoOf, true, false);
    }
  }
  // Remate: dos tarjetas verticales cruzadas.
  for (let k = 0; k < 2; k++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, k * Math.PI / 2, Math.PI / 2));
    cards.add(V(0, H - 0.4, 0), 1.6, 0.7, q, normalOf, () => 0.9, false);
  }
  const canopy = cards.geometry();

  const farTrunk = normalize(limb(V(0, -0.3, 0), V(0, H * 0.5, 0), V(0, H * 0.8, 0), 0.32, 0.1, 5, 2, rng));
  const far = new Cards();
  for (let wI = 0; wI < 6; wI++) {
    const t = wI / 5;
    const y = 2.8 + t * (H - 3.6);
    const len = 3.0 - t * 2.4;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + wI * 0.7;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, -0.3));
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.5, 0, 0)));
      far.add(V(0, y, 0), len * 1.15, len * 1.1, q, normalOf, aoOf, true, false);
    }
  }
  return { trunk, canopy, farTrunk, farCanopy: far.geometry(), trunkHeight: 10 };
}

// ------------------------------------------------------------ material

/**
 * Material de follaje: alphaTest (sombras recortadas), doble cara sin
 * invertir la normal (luz volumétrica), viento, y compensación de alfa en
 * mipmaps lejanos para que la copa no "adelgace" con la distancia.
 */
export function foliageMaterial(map: THREE.Texture, wind: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    alphaToCoverage: true,
  });
  m.onBeforeCompile = (shader) => {
    injectWind(shader, wind);
    shader.uniforms.uTexSize = { value: (map.image as { width?: number })?.width ?? 512 };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTexSize;')
      .replace('#include <alphatest_fragment>', `
        #ifdef USE_MAP
        {
          vec2 dx = dFdx(vMapUv * uTexSize), dy = dFdy(vMapUv * uTexSize);
          float lod = 0.5 * log2(max(dot(dx, dx), dot(dy, dy)));
          diffuseColor.a *= 1.0 + max(lod, 0.0) * 0.28;
        }
        #endif
        #include <alphatest_fragment>`)
      // Sin invertir la normal en la cara trasera: la tarjeta es un volumen de hojas.
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal);`);
  };
  m.customProgramCacheKey = () => `foliage-${wind}`;
  return m;
}
