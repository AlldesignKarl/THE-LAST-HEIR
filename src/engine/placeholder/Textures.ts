/**
 * PLACEHOLDER · Texturas procedurales.
 * Se generan en canvas al arrancar para no depender de assets externos.
 * Sustituibles por texturas PBR reales (ver docs/ASSETS.md): todo el juego
 * pide texturas por id a `TextureLibrary`, no a este generador.
 */
import * as THREE from 'three';
import { hash2 } from '../../core/rng';
import { TextureGen, type PainterName } from './TextureGen';

/** Ruido de valor periódico (tileable) en [0,1]. */
function pnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const m = (v: number) => ((v % period) + period) % period;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed);
  const c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** fBm periódico: u,v en [0,1). */
function fbm(u: number, v: number, baseFreq: number, octaves: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(u * f, v * f, f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Painted {
  color: Uint8ClampedArray;
  height: Float32Array;
  size: number;
}

function paint(size: number, fn: (u: number, v: number, x: number, y: number) => { c: RGB; h: number }): Painted {
  const color = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { c, h } = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      color[i] = c[0] * 255;
      color[i + 1] = c[1] * 255;
      color[i + 2] = c[2] * 255;
      color[i + 3] = 255;
      height[y * size + x] = h;
    }
  }
  return { color, height, size };
}

function toTexture(data: Uint8ClampedArray, size: number, srgb: boolean): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Mapa de normales a partir de la altura (Sobel, tileable). */
function normalFromHeight(p: Painted, strength: number): Uint8ClampedArray {
  const { height, size } = p;
  const out = new Uint8ClampedArray(size * size * 4);
  const H = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

export interface TextureSet {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
}

function build(p: Painted, normalStrength: number): TextureSet {
  return {
    map: toTexture(p.color, p.size, true),
    normalMap: normalStrength > 0 ? toTexture(normalFromHeight(p, normalStrength), p.size, false) : undefined,
  };
}

// ---------- Pintores ----------

const grass = (size: number) => paint(size, (u, v) => {
  const n = fbm(u, v, 4, 5, 11);
  const blades = fbm(u, v, 64, 2, 12);
  const patches = fbm(u, v, 2, 3, 13);
  let c = mix([0.16, 0.2, 0.07], [0.3, 0.33, 0.12], n);
  c = mix(c, [0.36, 0.33, 0.16], clamp01((patches - 0.55) * 3)); // hierba seca
  c = mix(c, [0.1, 0.13, 0.05], clamp01((0.4 - blades) * 2));
  return { c, h: blades * 0.6 + n * 0.4 };
});

const dirt = (size: number) => paint(size, (u, v) => {
  const n = fbm(u, v, 6, 5, 21);
  const pebbles = fbm(u, v, 48, 2, 22);
  let c = mix([0.22, 0.16, 0.1], [0.38, 0.3, 0.2], n);
  const peb = clamp01((pebbles - 0.68) * 6);
  c = mix(c, [0.45, 0.42, 0.37], peb);
  return { c, h: n * 0.5 + peb * 0.8 };
});

const mud = (size: number) => paint(size, (u, v) => {
  const n = fbm(u, v, 5, 5, 31);
  const puddle = clamp01((fbm(u, v, 3, 3, 32) - 0.6) * 5);
  let c = mix([0.12, 0.09, 0.06], [0.24, 0.18, 0.12], n);
  c = mix(c, [0.08, 0.07, 0.06], puddle);
  return { c, h: n * (1 - puddle) };
});

const field = (size: number) => paint(size, (u, v) => {
  const n = fbm(u, v, 8, 4, 41);
  const furrow = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 12);
  const c = mix([0.17, 0.12, 0.08], [0.33, 0.25, 0.16], n * 0.6 + furrow * 0.4);
  return { c, h: furrow * 0.8 + n * 0.2 };
});

const rock = (size: number) => paint(size, (u, v) => {
  const n = fbm(u, v, 4, 6, 51);
  const cracks = Math.abs(fbm(u, v, 6, 4, 52) - 0.5) * 2;
  const lichen = clamp01((fbm(u, v, 10, 3, 53) - 0.66) * 5);
  let c = mix([0.26, 0.25, 0.23], [0.5, 0.48, 0.45], n);
  c = mix(c, [0.12, 0.11, 0.1], clamp01((0.08 - cracks) * 12));
  c = mix(c, [0.4, 0.42, 0.25], lichen * 0.6);
  return { c, h: n * 0.8 - clamp01((0.08 - cracks) * 12) * 0.5 };
});

const planks = (size: number) => paint(size, (u, v) => {
  const boards = 5;
  const bi = Math.floor(v * boards);
  const inBoard = v * boards - bi;
  const grain = fbm(u * 1, v * 0.1 + bi * 0.37, 8, 4, 61 + bi);
  const streak = pnoise(u * 3, v * 90 + bi * 5, 90, 62);
  let c = mix([0.24, 0.16, 0.09], [0.42, 0.3, 0.18], grain * 0.7 + streak * 0.3);
  c = mix(c, [0.3, 0.26, 0.2], hash2(bi, 3, 63) * 0.4);
  const gap = inBoard < 0.05 || inBoard > 0.96 ? 1 : 0;
  c = mix(c, [0.06, 0.04, 0.03], gap);
  return { c, h: 0.6 + grain * 0.3 - gap * 0.8 };
});

const stoneWall = (size: number) => paint(size, (u, v) => {
  const rows = 6;
  const r = Math.floor(v * rows);
  const off = (r % 2) * 0.5 + hash2(r, 1, 71) * 0.2;
  const cols = 4;
  const cu = u * cols + off;
  const ci = Math.floor(cu);
  const fu = cu - ci, fv = v * rows - r;
  const mortar = Math.min(fu, 1 - fu) * 4 < 0.12 || Math.min(fv, 1 - fv) * 2 < 0.07;
  const n = fbm(u, v, 8, 4, 72);
  const tone = hash2(((ci % cols) + cols) % cols, r, 73);
  let c = mix([0.36, 0.33, 0.29], [0.56, 0.52, 0.46], tone * 0.6 + n * 0.4);
  if (mortar) c = mix([0.22, 0.2, 0.18], c, 0.2);
  const bevel = Math.min(Math.min(fu, 1 - fu) * 4, Math.min(fv, 1 - fv) * 2);
  return { c, h: mortar ? 0 : clamp01(bevel * 3) * 0.7 + n * 0.3 };
});

const plaster = (size: number) => paint(size, (u, v) => {
  const n = fbm(u, v, 5, 5, 81);
  const dirtV = clamp01(v * 1.2 - 0.3) * fbm(u, v, 3, 3, 82);
  let c = mix([0.72, 0.66, 0.55], [0.84, 0.79, 0.68], n);
  c = mix(c, [0.45, 0.38, 0.28], dirtV * 0.8);
  const chip = clamp01((fbm(u, v, 12, 2, 83) - 0.75) * 6);
  c = mix(c, [0.45, 0.35, 0.25], chip * 0.7);
  return { c, h: n * 0.4 - chip * 0.5 };
});

const wattle = (size: number) => paint(size, (u, v) => {
  // Zarzo (varas entretejidas) con barro parcialmente desprendido.
  const rows = 14;
  const ri = Math.floor(v * rows);
  const weave = Math.sin((u * 10 + (ri % 2) * 0.5) * Math.PI * 2) * 0.5 + 0.5;
  const rod = Math.sin((v * rows - ri) * Math.PI);
  const daub = fbm(u, v, 3, 5, 91);
  // Barro casi continuo; el zarzo asoma solo en desconchones pequeños.
  const edge = clamp01((daub - 0.3) * 8);
  const mud = mix([0.46, 0.39, 0.3], [0.62, 0.55, 0.44], fbm(u, v, 10, 3, 92));
  const stain = fbm(u, v, 2, 3, 93);
  const mudC = mix(mud, [0.38, 0.33, 0.26], clamp01(v * 1.1 - 0.5) * stain);
  const rodC = mix([0.3, 0.22, 0.14], [0.44, 0.33, 0.2], rod * weave);
  const c = mix(rodC, mudC, edge);
  const h = edge * (0.7 + daub * 0.3) + (1 - edge) * rod * 0.4;
  return { c, h };
});

const thatch = (size: number) => paint(size, (u, v) => {
  const strands = pnoise(u * 160, v * 6, 160, 101);
  const n = fbm(u, v, 4, 4, 102);
  const rowsT = 8;
  const layer = (v * rowsT) % 1;
  let c = mix([0.3, 0.24, 0.13], [0.55, 0.45, 0.26], strands * 0.6 + n * 0.4);
  c = mix(c, [0.2, 0.17, 0.12], clamp01((layer - 0.85) * 6) * 0.7);
  c = mix(c, [0.32, 0.32, 0.26], clamp01((fbm(u, v, 3, 3, 103) - 0.6) * 3) * 0.6); // envejecido
  return { c, h: strands * 0.6 + (1 - layer) * 0.4 };
});

const tiles = (size: number) => paint(size, (u, v) => {
  const rows = 8, cols = 6;
  const r = Math.floor(v * rows);
  const cu = u * cols + (r % 2) * 0.5;
  const ci = Math.floor(cu);
  const fu = cu - ci, fv = v * rows - r;
  const curve = Math.sin(fu * Math.PI);
  const tone = hash2(((ci % cols) + cols) % cols, r, 111);
  let c = mix([0.42, 0.2, 0.12], [0.62, 0.34, 0.2], tone * 0.7 + fbm(u, v, 8, 3, 112) * 0.3);
  c = mix(c, [0.25, 0.14, 0.1], clamp01((fv - 0.82) * 5));
  c = mix(c, [0.35, 0.36, 0.28], clamp01((fbm(u, v, 4, 3, 113) - 0.62) * 3) * 0.5);
  return { c: mix([0.2, 0.1, 0.07], c, 0.4 + curve * 0.6), h: curve * 0.7 + (1 - fv) * 0.3 };
});

const bark = (size: number) => paint(size, (u, v) => {
  const ridges = Math.abs(pnoise(u * 12, v * 2, 12, 121) - 0.5) * 2;
  const n = fbm(u, v, 6, 4, 122);
  let c = mix([0.13, 0.1, 0.07], [0.33, 0.28, 0.22], ridges * 0.6 + n * 0.4);
  c = mix(c, [0.28, 0.32, 0.2], clamp01((fbm(u, v, 5, 3, 123) - 0.65) * 4) * 0.5);
  return { c, h: ridges };
});

const leaves = (size: number) => paint(size, (u, v) => {
  const n = fbm(u, v, 8, 4, 131);
  const cluster = pnoise(u * 40, v * 40, 40, 132);
  let c = mix([0.07, 0.12, 0.04], [0.2, 0.3, 0.1], n * 0.5 + cluster * 0.5);
  c = mix(c, [0.03, 0.05, 0.02], clamp01((0.35 - cluster) * 3));
  return { c, h: cluster };
});

const pineNeedles = (size: number) => paint(size, (u, v) => {
  const n = fbm(u, v, 10, 4, 141);
  const lines = pnoise(u * 60, v * 8, 60, 142);
  const c = mix([0.04, 0.09, 0.05], [0.12, 0.2, 0.1], n * 0.4 + lines * 0.6);
  return { c, h: lines };
});

const cloth = (size: number) => paint(size, (u, v) => {
  const weave = (Math.sin(u * 180) * Math.sin(v * 180)) * 0.5 + 0.5;
  const n = fbm(u, v, 4, 4, 151);
  const c = mix([0.42, 0.36, 0.27], [0.62, 0.55, 0.43], n * 0.7 + weave * 0.3);
  return { c: mix(c, [0.3, 0.25, 0.2], clamp01((fbm(u, v, 3, 3, 152) - 0.6) * 3) * 0.6), h: weave * 0.3 };
});

const metal = (size: number) => paint(size, (u, v) => {
  const n = fbm(u, v, 6, 4, 161);
  const scratches = pnoise(u * 200, v * 4, 200, 162);
  const c = mix([0.42, 0.43, 0.45], [0.66, 0.67, 0.7], n * 0.5 + scratches * 0.5);
  return { c: mix(c, [0.32, 0.22, 0.15], clamp01((fbm(u, v, 5, 3, 163) - 0.68) * 4) * 0.6), h: scratches * 0.2 };
});

export type TexId =
  | 'grass' | 'dirt' | 'mud' | 'field' | 'rock' | 'planks' | 'stoneWall' | 'plaster'
  | 'wattle' | 'thatch' | 'tiles' | 'bark' | 'leaves' | 'pine' | 'cloth' | 'metal'
  | 'forestFloor' | 'cobble' | 'waterNormal' | 'pineBark' | 'leather' | 'roughWood' | 'sand' | 'rope';

/** Pintores CPU (respaldo si no hay renderer, p. ej. en tests). */
const PAINTERS: Partial<Record<TexId, { fn: (s: number) => Painted; size: number; normal: number }>> = {
  grass: { fn: grass, size: 256, normal: 1.2 },
  dirt: { fn: dirt, size: 256, normal: 2 },
  mud: { fn: mud, size: 256, normal: 1.5 },
  field: { fn: field, size: 256, normal: 2 },
  rock: { fn: rock, size: 256, normal: 3 },
  planks: { fn: planks, size: 256, normal: 3 },
  stoneWall: { fn: stoneWall, size: 256, normal: 4 },
  plaster: { fn: plaster, size: 256, normal: 1.5 },
  wattle: { fn: wattle, size: 256, normal: 3 },
  thatch: { fn: thatch, size: 256, normal: 3 },
  tiles: { fn: tiles, size: 256, normal: 4 },
  bark: { fn: bark, size: 128, normal: 4 },
  leaves: { fn: leaves, size: 128, normal: 0 },
  pine: { fn: pineNeedles, size: 128, normal: 0 },
  cloth: { fn: cloth, size: 128, normal: 1 },
  metal: { fn: metal, size: 128, normal: 0.5 },
};

/** Pintores GPU: tamaño relativo (1 = tamaño base de la calidad) y relieve. */
const GPU: Partial<Record<TexId, { painter: PainterName; scale: number; normal: number }>> = {
  grass: { painter: 'grass', scale: 1, normal: 1.4 },
  dirt: { painter: 'dirt', scale: 1, normal: 2.6 },
  mud: { painter: 'mud', scale: 0.5, normal: 1.6 },
  field: { painter: 'field', scale: 0.5, normal: 2.4 },
  rock: { painter: 'rock', scale: 1, normal: 3.2 },
  forestFloor: { painter: 'forestFloor', scale: 1, normal: 2.2 },
  cobble: { painter: 'cobble', scale: 0.5, normal: 3.5 },
  planks: { painter: 'planks', scale: 1, normal: 2.5 },
  roughWood: { painter: 'roughWood', scale: 0.5, normal: 2.5 },
  stoneWall: { painter: 'stoneWall', scale: 1, normal: 4 },
  plaster: { painter: 'plaster', scale: 1, normal: 1.6 },
  wattle: { painter: 'wattle', scale: 1, normal: 3 },
  thatch: { painter: 'thatch', scale: 1, normal: 3.2 },
  tiles: { painter: 'tiles', scale: 1, normal: 4 },
  bark: { painter: 'bark', scale: 0.5, normal: 4 },
  pineBark: { painter: 'pineBark', scale: 0.5, normal: 4 },
  cloth: { painter: 'cloth', scale: 0.5, normal: 1 },
  leather: { painter: 'leather', scale: 0.25, normal: 1.5 },
  metal: { painter: 'metal', scale: 0.25, normal: 0.6 },
  waterNormal: { painter: 'waterNormal', scale: 0.5, normal: 2 },
  sand: { painter: 'sand', scale: 1, normal: 1.6 },
  rope: { painter: 'rope', scale: 0.25, normal: 1.5 },
};

export class TextureLibrary {
  private cache = new Map<TexId, TextureSet>();
  private gen: TextureGen | null = null;
  private baseSize = 512;

  /** Activa la generación en GPU. `baseSize`: 512 (baja) o 1024. */
  init(renderer: THREE.WebGLRenderer, baseSize: number): void {
    try {
      this.gen = new TextureGen(renderer);
      this.baseSize = baseSize;
    } catch (e) {
      console.warn('Texturas GPU no disponibles; se usan las de CPU.', e);
      this.gen = null;
    }
  }

  get(id: TexId): TextureSet {
    let t = this.cache.get(id);
    if (t) return t;
    const g = GPU[id];
    if (this.gen && g) {
      const size = Math.max(128, Math.round(this.baseSize * g.scale));
      t = this.gen.paint(g.painter, size, g.normal);
    } else {
      const p = PAINTERS[id] ?? PAINTERS[id === 'forestFloor' ? 'dirt' : id === 'pineBark' ? 'bark' : id === 'roughWood' ? 'planks' : id === 'leather' ? 'cloth' : id === 'waterNormal' ? 'mud' : 'dirt']!;
      t = build(p.fn(p.size), p.normal);
    }
    this.cache.set(id, t);
    return t;
  }

  preloadAll(): void {
    for (const id of new Set([...Object.keys(PAINTERS), ...Object.keys(GPU)]) as Set<TexId>) this.get(id);
  }
}
