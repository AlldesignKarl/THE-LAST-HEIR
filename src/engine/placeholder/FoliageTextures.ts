/**
 * PLACEHOLDER · Texturas de follaje dibujadas con Canvas 2D (con canal
 * alfa): racimos de hojas de roble, ramas de pino, matorral y helecho.
 * Se usan en "tarjetas" (quads con alphaTest) para árboles y plantas.
 * Sustituibles por atlas fotográficos (ver docs/ASSETS.md).
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const hsl = (h: number, s: number, l: number) => `hsl(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%)`;

/** Hoja de roble lobulada (contorno con 5 pares de lóbulos). */
function oakLeaf(ctx: Ctx, x: number, y: number, len: number, ang: number, fill: string, vein: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  const w = len * 0.42;
  ctx.moveTo(0, 0);
  const lobes = 4;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i <= lobes; i++) {
      const t = (i + 0.5) / (lobes + 1);
      const along = len * (0.1 + t * 0.9);
      const width = w * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (0.75 + 0.25 * Math.sin(i * 1.7));
      ctx.quadraticCurveTo(side * width * 1.1, along - len * 0.08, side * width * 0.55, along + len * 0.03);
    }
    ctx.lineTo(0, len);
    if (side === -1) ctx.moveTo(0, 0);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = vein;
  ctx.lineWidth = Math.max(1, len * 0.04);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, len * 0.95);
  ctx.stroke();
  ctx.restore();
}

/**
 * Racimo de hojas de roble: ramillas desde abajo con hojas en abanico.
 * Ocupa el lienzo de forma irregular (huecos por donde pasa la luz).
 */
export function oakFoliage(size = 512, seed = 7): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const rng = new Rng(seed);
  const cx = size / 2;
  // Ramillas.
  ctx.lineCap = 'round';
  const twigs: [number, number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + rng.range(-1.1, 1.1);
    const l = size * rng.range(0.28, 0.45);
    const x0 = cx + rng.range(-size * 0.08, size * 0.08), y0 = size * 0.95;
    const x1 = x0 + Math.cos(a) * l, y1 = y0 + Math.sin(a) * l * 1.3;
    twigs.push([x0, y0, x1, y1]);
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2 + rng.range(-20, 20), (y0 + y1) / 2, x1, y1);
    ctx.stroke();
  }
  // Hojas: de dentro (oscuras) hacia fuera (claras).
  const leaves = 190;
  for (let i = 0; i < leaves; i++) {
    const t = i / leaves;
    const tw = twigs[rng.int(0, twigs.length - 1)];
    const k = rng.range(0.25, 1.05);
    const bx = tw[0] + (tw[2] - tw[0]) * k + rng.range(-size * 0.09, size * 0.09);
    const by = tw[1] + (tw[3] - tw[1]) * k + rng.range(-size * 0.09, size * 0.09);
    // Recorte suave a una elipse para que el racimo no toque los bordes.
    const dx = (bx - cx) / (size * 0.47), dy = (by - size * 0.5) / (size * 0.47);
    if (dx * dx + dy * dy > 1) continue;
    const len = size * rng.range(0.07, 0.11);
    const ang = Math.atan2(by - tw[1], bx - tw[0]) - Math.PI / 2 + rng.range(-0.9, 0.9);
    const light = 0.17 + t * 0.16 + rng.range(-0.04, 0.05);
    const hue = rng.range(78, 102) - (rng.next() < 0.06 ? 30 : 0);
    oakLeaf(ctx, bx, by, len, ang, hsl(hue, rng.range(0.38, 0.55), light), hsl(hue, 0.35, light * 0.75));
  }
  return toTex(c);
}

/** Rama de pino vista desde arriba: eje central y agujas a ambos lados. */
export function pineFoliage(w = 512, h = 256, seed = 11): THREE.CanvasTexture {
  const [c, ctx] = canvas(w, h);
  const rng = new Rng(seed);
  ctx.lineCap = 'round';
  const drawBranch = (x0: number, y0: number, x1: number, y1: number, width: number, depth: number) => {
    ctx.strokeStyle = '#4a3322';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    const steps = Math.floor(len / 3);
    for (let i = 2; i < steps; i++) {
      const t = i / steps;
      const px = x0 + ux * len * t, py = y0 + uy * len * t;
      const nl = (h * 0.16) * (1 - t * 0.45) * (depth ? 0.7 : 1);
      for (const side of [-1, 1]) {
        const a = Math.atan2(uy, ux) + side * rng.range(0.7, 1.1);
        const l = nl * rng.range(0.75, 1.1);
        const light = rng.range(0.13, 0.25) + t * 0.05;
        ctx.strokeStyle = hsl(rng.range(115, 140), rng.range(0.3, 0.45), light);
        ctx.lineWidth = rng.range(1.2, 2.2);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
        ctx.stroke();
      }
    }
  };
  // Eje principal de izquierda a derecha y ramillas laterales.
  const y = h / 2;
  drawBranch(4, y, w - 12, y + rng.range(-8, 8), 5, 0);
  for (let i = 0; i < 7; i++) {
    const t = 0.15 + i * 0.11;
    const x0 = 4 + (w - 16) * t;
    const side = i % 2 ? 1 : -1;
    const len = w * rng.range(0.16, 0.26) * (1 - t * 0.4);
    const a = side * rng.range(0.45, 0.8);
    drawBranch(x0, y, x0 + Math.cos(a) * len, y + Math.sin(a) * len, 2.5, 1);
  }
  return toTex(c);
}

/** Matorral / arbusto (hojas pequeñas redondeadas en masa). */
export function bushFoliage(size = 256, seed = 23): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const rng = new Rng(seed);
  ctx.strokeStyle = '#3b2b1c';
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    ctx.lineWidth = 3;
    ctx.beginPath();
    const x0 = size / 2 + rng.range(-10, 10);
    ctx.moveTo(x0, size);
    ctx.lineTo(x0 + rng.range(-size * 0.4, size * 0.4), size * rng.range(0.15, 0.5));
    ctx.stroke();
  }
  for (let i = 0; i < 260; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * size * 0.45;
    const x = size / 2 + Math.cos(a) * r, y = size * 0.55 + Math.sin(a) * r * 0.85;
    if (y > size * 0.97) continue;
    const l = rng.range(0.1, 0.34) + (1 - y / size) * 0.1;
    ctx.fillStyle = hsl(rng.range(85, 110), rng.range(0.3, 0.5), l * 0.8);
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(4, 8), rng.range(2.5, 5), rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  return toTex(c);
}

/** Fronda de helecho (una hoja pinnada). */
export function fernFoliage(w = 128, h = 256, seed = 31): THREE.CanvasTexture {
  const [c, ctx] = canvas(w, h);
  const rng = new Rng(seed);
  const cx = w / 2;
  ctx.strokeStyle = '#2f4a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, h);
  ctx.quadraticCurveTo(cx + 6, h * 0.5, cx, 4);
  ctx.stroke();
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const y = h - t * (h - 8);
    const len = (w * 0.48) * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (1 - t * 0.3);
    for (const side of [-1, 1]) {
      ctx.fillStyle = hsl(rng.range(88, 105), 0.45, rng.range(0.2, 0.3));
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(cx + side * len * 0.6, y - 6, cx + side * len, y - 4 - t * 4);
      ctx.quadraticCurveTo(cx + side * len * 0.5, y + 3, cx, y + 2);
      ctx.fill();
    }
  }
  return toTex(c);
}
