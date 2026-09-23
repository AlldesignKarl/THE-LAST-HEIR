/**
 * PLACEHOLDER · Generador de texturas procedurales en GPU.
 *
 * Cada textura se "pinta" con un shader a pantalla completa sobre un
 * render target (RGB = albedo, A = altura) y de su altura se deriva el
 * mapa de normales en una segunda pasada. En GPU se generan texturas de
 * 1024² en milisegundos, algo inviable en CPU al arrancar en un móvil.
 *
 * Todo es tileable (ruido periódico). Los colores se escriben en espacio
 * lineal; el render target sRGB hace la codificación en hardware.
 */
import * as THREE from 'three';

export const PAINTER_IDS = {
  grass: 0, dirt: 1, mud: 2, field: 3, rock: 4, planks: 5, stoneWall: 6, plaster: 7,
  wattle: 8, thatch: 9, tiles: 10, bark: 11, cloth: 12, metal: 13, forestFloor: 14,
  cobble: 15, waterNormal: 16, pineBark: 17, leather: 18, roughWood: 19,
} as const;
export type PainterName = keyof typeof PAINTER_IDS;

const VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const NOISE = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform int uPainter;
uniform float uSize;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec2 wrapc(vec2 i, vec2 per) { return mod(i, per); }
// Ruido de valor periódico.
float vnoise(vec2 p, vec2 per, float seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(wrapc(i, per) + seed);
  float b = hash12(wrapc(i + vec2(1, 0), per) + seed);
  float c = hash12(wrapc(i + vec2(0, 1), per) + seed);
  float d = hash12(wrapc(i + vec2(1, 1), per) + seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Ruido de gradiente periódico (más orgánico).
float gnoise(vec2 p, vec2 per, float seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 ga = hash22(wrapc(i, per) + seed) * 2.0 - 1.0;
  vec2 gb = hash22(wrapc(i + vec2(1, 0), per) + seed) * 2.0 - 1.0;
  vec2 gc = hash22(wrapc(i + vec2(0, 1), per) + seed) * 2.0 - 1.0;
  vec2 gd = hash22(wrapc(i + vec2(1, 1), per) + seed) * 2.0 - 1.0;
  float va = dot(ga, f), vb = dot(gb, f - vec2(1, 0)), vc = dot(gc, f - vec2(0, 1)), vd = dot(gd, f - vec2(1, 1));
  return 0.5 + 0.7 * mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
}
float fbm(vec2 uv, vec2 freq, int oct, float seed) {
  float s = 0.0, a = 0.5, n = 0.0;
  vec2 f = freq;
  for (int o = 0; o < 8; o++) {
    if (o >= oct) break;
    s += a * gnoise(uv * f, f, seed + float(o) * 17.0);
    n += a; a *= 0.5; f *= 2.0;
  }
  return s / n;
}
float ridged(vec2 uv, vec2 freq, int oct, float seed) {
  float s = 0.0, a = 0.5, n = 0.0;
  vec2 f = freq;
  for (int o = 0; o < 8; o++) {
    if (o >= oct) break;
    s += a * (1.0 - abs(gnoise(uv * f, f, seed + float(o) * 13.0) * 2.0 - 1.0));
    n += a; a *= 0.5; f *= 2.0;
  }
  return s / n;
}
// Voronoi periódico: x = F1, y = F2, z = id de celda.
vec3 voronoi(vec2 uv, vec2 per, float seed, float jitter) {
  vec2 p = uv * per;
  vec2 i = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = wrapc(i + g, per);
    vec2 o = 0.5 + (hash22(c + seed) - 0.5) * jitter;
    float d = length(g + o - f);
    if (d < f1) { f2 = f1; f1 = d; id = hash12(c + seed * 1.7); }
    else if (d < f2) f2 = d;
  }
  return vec3(f1, f2, id);
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
`;

const PAINT = /* glsl */ `
void main() {
  vec2 uv = vUv;
  vec3 c = vec3(0.5);
  float h = 0.5;
  if (uPainter == 0) { // hierba (suelo)
    float n = fbm(uv, vec2(4), 5, 11.0);
    float patches = fbm(uv, vec2(2), 4, 13.0);
    float blades = fbm(uv, vec2(64, 64), 3, 12.0);
    float streak = gnoise(uv * vec2(180.0, 40.0), vec2(180.0, 40.0), 14.0);
    c = mix(vec3(0.15, 0.2, 0.07), vec3(0.31, 0.36, 0.13), n);
    c = mix(c, vec3(0.44, 0.4, 0.2), smoothstep(0.55, 0.78, patches) * 0.75);
    c = mix(c, vec3(0.27, 0.22, 0.13), smoothstep(0.72, 0.9, fbm(uv, vec2(6), 3, 15.0)) * 0.6); // tierra asomando
    c *= 0.72 + 0.45 * blades + 0.18 * (streak - 0.5);
    vec3 v = voronoi(uv, vec2(26), 16.0, 0.9);
    float fl = smoothstep(0.1, 0.03, v.x) * step(0.93, v.z);
    c = mix(c, v.z > 0.965 ? vec3(0.85, 0.78, 0.3) : vec3(0.82, 0.82, 0.76), fl * 0.8);
    h = blades * 0.55 + n * 0.3 + streak * 0.15;
  } else if (uPainter == 1) { // tierra / camino con guijarros
    float n = fbm(uv, vec2(5), 5, 21.0);
    float fine = fbm(uv, vec2(48), 3, 23.0);
    vec3 v = voronoi(uv, vec2(18), 22.0, 0.95);
    float peb = smoothstep(0.24, 0.12, v.x) * step(0.82, v.z);
    vec3 v2 = voronoi(uv, vec2(44), 24.0, 0.95);
    float grit = smoothstep(0.22, 0.1, v2.x) * step(0.6, v2.z);
    float dust = fbm(uv, vec2(2), 4, 26.0);
    c = mix(vec3(0.23, 0.17, 0.11), vec3(0.4, 0.32, 0.22), n);
    c = mix(c, vec3(0.47, 0.41, 0.31), smoothstep(0.55, 0.8, dust) * 0.6); // polvo seco
    c = mix(c, vec3(0.16, 0.12, 0.08), smoothstep(0.45, 0.2, dust) * 0.5); // tierra húmeda
    c *= 0.85 + 0.3 * fine;
    c = mix(c, mix(vec3(0.33, 0.3, 0.26), vec3(0.45, 0.42, 0.37), v.z), peb * 0.85);
    c = mix(c, vec3(0.42, 0.38, 0.32), grit * 0.4);
    // Rodadas / huellas suaves.
    float rut = smoothstep(0.35, 0.5, fbm(uv, vec2(3, 12), 3, 25.0));
    c *= 1.0 - rut * 0.12;
    h = n * 0.35 + fine * 0.15 + peb * (0.5 + 0.4 * (1.0 - v.x * 3.0)) + grit * 0.2 - rut * 0.1;
  } else if (uPainter == 2) { // barro
    float n = fbm(uv, vec2(5), 5, 31.0);
    float puddle = smoothstep(0.58, 0.68, fbm(uv, vec2(3), 4, 32.0));
    float prints = smoothstep(0.35, 0.15, voronoi(uv, vec2(10), 33.0, 0.8).x) * step(0.7, voronoi(uv, vec2(10), 33.0, 0.8).z);
    c = mix(vec3(0.13, 0.095, 0.065), vec3(0.26, 0.19, 0.12), n);
    c *= 1.0 - prints * 0.25;
    c = mix(c, vec3(0.07, 0.06, 0.05), puddle);
    h = n * (1.0 - puddle) * 0.8 - prints * 0.2;
  } else if (uPainter == 3) { // campo arado
    float n = fbm(uv, vec2(8), 4, 41.0);
    float furrow = 0.5 + 0.5 * sin((uv.y + (gnoise(uv * vec2(2, 4), vec2(2, 4), 42.0) - 0.5) * 0.04) * 6.2831 * 12.0);
    float clods = fbm(uv, vec2(40), 3, 43.0);
    c = mix(vec3(0.17, 0.12, 0.08), vec3(0.34, 0.25, 0.16), n * 0.5 + furrow * 0.35 + clods * 0.15);
    // Brotes en las crestas.
    float sprout = smoothstep(0.8, 0.95, furrow) * smoothstep(0.55, 0.7, fbm(uv, vec2(60), 2, 44.0));
    c = mix(c, vec3(0.24, 0.32, 0.1), sprout * 0.7);
    h = furrow * 0.7 + clods * 0.3;
  } else if (uPainter == 4) { // roca
    float n = fbm(uv, vec2(3), 6, 51.0);
    float strata = gnoise(vec2(uv.x * 2.0, uv.y * 14.0 + n * 3.0), vec2(2, 14), 52.0);
    float cr = ridged(uv, vec2(5), 4, 53.0);
    float crack = smoothstep(0.93, 0.99, cr);
    float lichen = smoothstep(0.62, 0.72, fbm(uv, vec2(8), 4, 54.0));
    float moss = smoothstep(0.6, 0.75, fbm(uv, vec2(3), 4, 55.0)) * smoothstep(0.3, 0.7, 1.0 - uv.y * 0.3);
    c = mix(vec3(0.27, 0.26, 0.24), vec3(0.52, 0.5, 0.46), n * 0.7 + strata * 0.3);
    c *= 0.85 + 0.3 * fbm(uv, vec2(40), 3, 56.0);
    c = mix(c, vec3(0.1, 0.095, 0.09), crack);
    c = mix(c, vec3(0.55, 0.56, 0.4), lichen * 0.45);
    c = mix(c, vec3(0.2, 0.26, 0.1), moss * 0.6);
    h = n * 0.7 + strata * 0.2 - crack * 0.5 + fbm(uv, vec2(32), 3, 57.0) * 0.15;
  } else if (uPainter == 5 || uPainter == 19) { // tablas (5) / madera tosca (19)
    float boards = uPainter == 5 ? 5.0 : 3.0;
    float bi = floor(uv.y * boards);
    float fy = fract(uv.y * boards);
    float seed = 61.0 + bi * 7.0;
    float off = hash12(vec2(bi, 3.0));
    // Veta: ruido muy estirado + anillos.
    float warp = gnoise(vec2(uv.x * 3.0, fy * 2.0 + bi), vec2(3, 200), seed) * 0.6;
    float grain = gnoise(vec2(uv.x * 4.0 + off * 4.0, (fy + warp) * 40.0), vec2(4, 40), seed + 1.0);
    float rings = 0.5 + 0.5 * sin((fy + warp * 0.8) * 60.0 + gnoise(uv * vec2(8, 2), vec2(8, 2), seed + 2.0) * 6.0);
    float n = fbm(uv, vec2(6), 4, seed + 3.0);
    c = mix(vec3(0.25, 0.16, 0.09), vec3(0.45, 0.32, 0.19), grain * 0.5 + rings * 0.25 + n * 0.25);
    c *= 0.8 + 0.35 * off;
    // Nudos.
    vec3 kn = voronoi(uv, vec2(3, boards), seed + 4.0, 0.8);
    float knot = smoothstep(0.12, 0.04, kn.x) * step(0.75, kn.z);
    c = mix(c, vec3(0.12, 0.07, 0.04), knot * 0.8);
    float gap = smoothstep(0.035, 0.0, fy) + smoothstep(0.965, 1.0, fy);
    // Juntas a tope en posiciones aleatorias.
    float jx = fract(uv.x * 2.0 + off);
    gap = max(gap, smoothstep(0.012, 0.0, abs(jx - 0.5)) * step(0.4, off));
    c = mix(c, vec3(0.05, 0.035, 0.025), sat(gap));
    if (uPainter == 19) c = mix(c, vec3(0.32, 0.3, 0.27), smoothstep(0.55, 0.8, fbm(uv, vec2(4), 4, 66.0)) * 0.5); // envejecida
    h = 0.55 + grain * 0.2 + rings * 0.1 - knot * 0.2 - sat(gap) * 0.7;
  } else if (uPainter == 6) { // muro de mampostería irregular
    vec3 v = voronoi(uv * vec2(1.0, 1.0), vec2(5, 7), 71.0, 0.85);
    float edge = v.y - v.x;
    float mortar = smoothstep(0.1, 0.03, edge);
    float n = fbm(uv, vec2(8), 5, 72.0);
    float tone = v.z;
    c = mix(vec3(0.36, 0.33, 0.29), vec3(0.6, 0.55, 0.48), tone * 0.55 + n * 0.45);
    c = mix(c, c * vec3(1.05, 0.95, 0.85), step(0.7, fract(tone * 7.3)) * 0.5); // piedras más cálidas
    c *= 0.85 + 0.25 * fbm(uv, vec2(48), 3, 73.0);
    c = mix(c, vec3(0.3, 0.28, 0.25), mortar);
    float grime = smoothstep(0.3, 1.0, uv.y) * fbm(uv, vec2(3), 3, 74.0);
    c *= 1.0 - grime * 0.35;
    float bulge = sat(edge * 5.0);
    h = mortar > 0.5 ? 0.05 : 0.35 + sqrt(bulge) * 0.45 + n * 0.2;
  } else if (uPainter == 7) { // revoque de cal
    float n = fbm(uv, vec2(5), 5, 81.0);
    float trowel = gnoise(uv * vec2(14, 9), vec2(14, 9), 82.0);
    float dirtV = sat(uv.y * 1.3 - 0.35) * fbm(uv, vec2(3), 3, 83.0);
    float chip = smoothstep(0.7, 0.8, fbm(uv, vec2(10), 3, 84.0));
    c = mix(vec3(0.72, 0.66, 0.55), vec3(0.86, 0.81, 0.7), n * 0.7 + trowel * 0.3);
    c = mix(c, vec3(0.45, 0.38, 0.28), dirtV * 0.7);
    // Desconchón: asoma el zarzo/ladrillo.
    c = mix(c, vec3(0.46, 0.34, 0.22), chip * 0.85);
    // Churretes verticales.
    float drip = smoothstep(0.6, 0.9, gnoise(uv * vec2(30, 2), vec2(30, 2), 85.0)) * sat(uv.y * 1.5 - 0.2);
    c *= 1.0 - drip * 0.18;
    h = n * 0.25 + trowel * 0.2 - chip * 0.45 + 0.4;
  } else if (uPainter == 8) { // zarzo con barro
    float rows = 14.0;
    float ri = floor(uv.y * rows);
    float weave = 0.5 + 0.5 * sin((uv.x * 10.0 + mod(ri, 2.0) * 0.5) * 6.2831);
    float rod = sin(fract(uv.y * rows) * 3.14159);
    float daub = fbm(uv, vec2(3), 5, 91.0);
    float edge = smoothstep(0.3, 0.42, daub);
    vec3 mud = mix(vec3(0.46, 0.39, 0.3), vec3(0.63, 0.56, 0.45), fbm(uv, vec2(10), 3, 92.0));
    mud *= 0.9 + 0.2 * fbm(uv, vec2(50), 2, 94.0);
    mud = mix(mud, vec3(0.38, 0.33, 0.26), sat(uv.y * 1.1 - 0.5) * fbm(uv, vec2(2), 3, 93.0));
    vec3 rodC = mix(vec3(0.28, 0.2, 0.12), vec3(0.46, 0.34, 0.2), rod * weave);
    c = mix(rodC, mud, edge);
    h = edge * (0.65 + daub * 0.35) + (1.0 - edge) * rod * weave * 0.4;
  } else if (uPainter == 9) { // paja (techumbre): haces gruesos y desordenados
    float rows = 3.0;
    float warpY = (gnoise(uv * vec2(6, 3), vec2(6, 3), 106.0) - 0.5) * 0.12;
    float ly = fract(uv.y * rows + warpY * rows);
    float strands = gnoise(vec2(uv.x * 260.0, uv.y * 4.0), vec2(260, 4), 101.0);
    float strands2 = gnoise(vec2(uv.x * 110.0 + 3.0, uv.y * 7.0), vec2(110, 7), 102.0);
    float clumps = fbm(uv, vec2(12, 5), 3, 107.0);
    float n = fbm(uv, vec2(4), 4, 103.0);
    c = mix(vec3(0.3, 0.25, 0.15), vec3(0.58, 0.49, 0.32), strands * 0.45 + strands2 * 0.25 + clumps * 0.3);
    c *= 0.85 + 0.25 * n;
    // Sombra suave bajo cada hilada.
    c *= mix(1.0, 0.8, smoothstep(0.75, 1.0, ly));
    // Envejecimiento: gris y musgo.
    c = mix(c, vec3(0.36, 0.34, 0.29), smoothstep(0.5, 0.75, fbm(uv, vec2(3), 3, 104.0)) * 0.55);
    c = mix(c, vec3(0.22, 0.25, 0.12), smoothstep(0.68, 0.85, fbm(uv, vec2(5), 3, 105.0)) * 0.45);
    h = strands * 0.35 + strands2 * 0.2 + clumps * 0.2 + (1.0 - ly) * 0.25;
  } else if (uPainter == 10) { // tejas árabes
    float rows = 8.0, cols = 6.0;
    float r = floor(uv.y * rows);
    float cu = uv.x * cols + mod(r, 2.0) * 0.5;
    float ci = floor(cu);
    float fu = fract(cu), fv = fract(uv.y * rows);
    float curve = sin(fu * 3.14159);
    float tone = hash12(vec2(mod(ci, cols), r) + 111.0);
    c = mix(vec3(0.42, 0.2, 0.12), vec3(0.66, 0.36, 0.2), tone * 0.7 + fbm(uv, vec2(8), 3, 112.0) * 0.3);
    c = mix(c, vec3(0.22, 0.12, 0.08), smoothstep(0.8, 1.0, fv) * 0.8);
    c = mix(c, vec3(0.34, 0.36, 0.26), smoothstep(0.62, 0.8, fbm(uv, vec2(4), 3, 113.0)) * 0.5); // líquenes
    c *= 0.55 + curve * 0.45;
    h = curve * 0.7 + (1.0 - fv) * 0.3;
  } else if (uPainter == 11 || uPainter == 17) { // corteza de roble (11) / pino (17)
    if (uPainter == 11) {
      float ridge = ridged(uv, vec2(10, 1), 4, 121.0);
      float n = fbm(uv, vec2(6), 4, 122.0);
      c = mix(vec3(0.11, 0.09, 0.07), vec3(0.36, 0.31, 0.25), ridge * 0.7 + n * 0.3);
      c = mix(c, vec3(0.3, 0.34, 0.2), smoothstep(0.6, 0.75, fbm(uv, vec2(4), 3, 123.0)) * 0.5);
      h = ridge * 0.85 + n * 0.15;
    } else {
      vec3 v = voronoi(uv, vec2(6, 12), 125.0, 0.7);
      float plate = smoothstep(0.02, 0.12, v.y - v.x);
      c = mix(vec3(0.13, 0.09, 0.07), mix(vec3(0.3, 0.21, 0.15), vec3(0.43, 0.32, 0.23), v.z), plate);
      c *= 0.85 + 0.3 * fbm(uv, vec2(24), 3, 126.0);
      h = plate * (0.6 + v.z * 0.3);
    }
  } else if (uPainter == 12) { // paño tejido
    float wx = sin(uv.x * 3.14159 * 256.0), wy = sin(uv.y * 3.14159 * 256.0);
    float weave = (wx * 0.5 + 0.5) * step(0.0, wy) + (wy * 0.5 + 0.5) * step(wy, 0.0);
    float n = fbm(uv, vec2(4), 4, 151.0);
    float slub = gnoise(uv * vec2(128, 6), vec2(128, 6), 152.0);
    c = vec3(0.55, 0.5, 0.42) * (0.8 + 0.2 * weave) * (0.85 + 0.25 * n) * (0.92 + 0.12 * slub);
    c = mix(c, c * 0.7, smoothstep(0.6, 0.8, fbm(uv, vec2(3), 3, 153.0)) * 0.6);
    h = weave * 0.5 + slub * 0.2;
  } else if (uPainter == 13) { // metal forjado
    float n = fbm(uv, vec2(6), 4, 161.0);
    float scratches = gnoise(uv * vec2(300, 4), vec2(300, 4), 162.0);
    float hammer = voronoi(uv, vec2(12), 164.0, 0.9).x;
    c = mix(vec3(0.42, 0.43, 0.45), vec3(0.68, 0.69, 0.72), n * 0.5 + scratches * 0.3 + hammer * 0.2);
    c = mix(c, vec3(0.34, 0.2, 0.12), smoothstep(0.66, 0.8, fbm(uv, vec2(5), 3, 163.0)) * 0.7);
    h = scratches * 0.15 + hammer * 0.35;
  } else if (uPainter == 14) { // suelo de bosque: hojarasca, agujas, musgo
    float n = fbm(uv, vec2(4), 5, 171.0);
    // Hojas: celdas pequeñas, alargadas y giradas, con bordes irregulares.
    vec2 wuv = uv + (vec2(gnoise(uv * 12.0, vec2(12), 177.0), gnoise(uv * 12.0 + 5.0, vec2(12), 178.0)) - 0.5) * 0.02;
    vec3 lv = voronoi(wuv, vec2(34, 46), 172.0, 1.0);
    float leaf = smoothstep(0.36, 0.22, lv.x) * step(0.3, lv.z);
    vec3 lv2 = voronoi(wuv + 0.37, vec2(48, 38), 173.0, 1.0);
    float leaf2 = smoothstep(0.33, 0.2, lv2.x) * step(0.45, lv2.z);
    float needles = smoothstep(0.62, 0.75, gnoise(uv * vec2(160, 160), vec2(160), 174.0)) * smoothstep(0.5, 0.7, gnoise(uv * vec2(8), vec2(8), 175.0));
    float moss = smoothstep(0.55, 0.72, fbm(uv, vec2(3), 4, 176.0));
    c = mix(vec3(0.12, 0.095, 0.065), vec3(0.21, 0.17, 0.11), n);
    c = mix(c, mix(vec3(0.25, 0.18, 0.1), vec3(0.36, 0.27, 0.14), lv.z), leaf * 0.6);
    c = mix(c, mix(vec3(0.2, 0.15, 0.08), vec3(0.31, 0.24, 0.12), lv2.z), leaf2 * 0.5);
    c = mix(c, vec3(0.26, 0.2, 0.12), needles * 0.5);
    c = mix(c, vec3(0.17, 0.23, 0.08), moss * 0.75);
    h = n * 0.45 + leaf * 0.18 + leaf2 * 0.2 + moss * 0.2;
  } else if (uPainter == 15) { // empedrado
    vec3 v = voronoi(uv, vec2(9), 181.0, 0.75);
    float edge = v.y - v.x;
    float joint = smoothstep(0.1, 0.03, edge);
    float n = fbm(uv, vec2(12), 4, 182.0);
    c = mix(vec3(0.34, 0.32, 0.29), vec3(0.55, 0.52, 0.47), v.z * 0.6 + n * 0.4);
    c = mix(c, vec3(0.2, 0.17, 0.12), joint);
    c = mix(c, vec3(0.2, 0.25, 0.1), joint * smoothstep(0.5, 0.7, fbm(uv, vec2(6), 3, 183.0)) * 0.8); // hierba en juntas
    h = joint > 0.5 ? 0.0 : 0.3 + sqrt(sat(edge * 4.0)) * 0.6 + n * 0.1;
  } else if (uPainter == 16) { // ondas de agua (solo altura)
    float w = fbm(uv, vec2(4), 5, 191.0) * 0.6 + gnoise(uv * vec2(16, 10), vec2(16, 10), 192.0) * 0.4;
    c = vec3(w);
    h = w;
  } else if (uPainter == 18) { // cuero
    vec3 v = voronoi(uv, vec2(40), 201.0, 1.0);
    float n = fbm(uv, vec2(5), 4, 202.0);
    c = vec3(0.42, 0.29, 0.18) * (0.8 + 0.3 * n) * (0.9 + 0.1 * smoothstep(0.0, 0.2, v.y - v.x));
    c = mix(c, c * 0.7, smoothstep(0.6, 0.8, fbm(uv, vec2(3), 3, 203.0)) * 0.6);
    h = smoothstep(0.0, 0.15, v.y - v.x) * 0.4 + n * 0.3;
  }
  outColor = vec4(lin(clamp(c, 0.0, 1.0)), clamp(h, 0.0, 1.0));
}`;

const NORMAL_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tSrc;
uniform float uStrength;
uniform float uSize;
float H(ivec2 p) {
  int s = int(uSize);
  p = ivec2((p.x + s) % s, (p.y + s) % s);
  return texelFetch(tSrc, p, 0).a;
}
void main() {
  ivec2 p = ivec2(vUv * uSize);
  float dx = (H(p + ivec2(1, -1)) + 2.0 * H(p + ivec2(1, 0)) + H(p + ivec2(1, 1))) - (H(p + ivec2(-1, -1)) + 2.0 * H(p + ivec2(-1, 0)) + H(p + ivec2(-1, 1)));
  float dy = (H(p + ivec2(-1, 1)) + 2.0 * H(p + ivec2(0, 1)) + H(p + ivec2(1, 1))) - (H(p + ivec2(-1, -1)) + 2.0 * H(p + ivec2(0, -1)) + H(p + ivec2(1, -1)));
  // La intensidad se da para 256 px; se escala con la resolución.
  float k = uStrength * uSize / 256.0 * 0.25;
  vec3 n = normalize(vec3(-dx * k, -dy * k, 1.0));
  outColor = vec4(n * 0.5 + 0.5, 1.0);
}`;

export class TextureGen {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private paintMat: THREE.RawShaderMaterial;
  private normalMat: THREE.RawShaderMaterial;
  private anisotropy: number;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const geo = new THREE.BufferGeometry();
    // Triángulo que cubre la pantalla.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.paintMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: NOISE + PAINT,
      uniforms: { uPainter: { value: 0 }, uSize: { value: 256 } },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.normalMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: NORMAL_FRAG,
      uniforms: { tSrc: { value: null }, uStrength: { value: 1 }, uSize: { value: 256 } },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = new THREE.Mesh(geo, this.paintMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  private target(size: number, srgb: boolean): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.anisotropy = this.anisotropy;
    return rt;
  }

  private draw(mat: THREE.Material, rt: THREE.WebGLRenderTarget): void {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevXr = r.xr.enabled;
    r.xr.enabled = false;
    r.autoClear = false;
    this.quad.material = mat;
    r.setRenderTarget(rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    r.xr.enabled = prevXr;
  }

  /** Pinta una textura (albedo + altura) y su mapa de normales. */
  paint(name: PainterName, size: number, normalStrength: number): { map: THREE.Texture; normalMap?: THREE.Texture } {
    const color = this.target(size, true);
    this.paintMat.uniforms.uPainter.value = PAINTER_IDS[name];
    this.paintMat.uniforms.uSize.value = size;
    this.draw(this.paintMat, color);
    color.texture.name = name;
    let normalMap: THREE.Texture | undefined;
    if (normalStrength > 0) {
      const nrt = this.target(size, false);
      this.normalMat.uniforms.tSrc.value = color.texture;
      this.normalMat.uniforms.uStrength.value = normalStrength;
      this.normalMat.uniforms.uSize.value = size;
      this.draw(this.normalMat, nrt);
      nrt.texture.name = `${name}_n`;
      normalMap = nrt.texture;
    }
    return { map: color.texture, normalMap };
  }
}
