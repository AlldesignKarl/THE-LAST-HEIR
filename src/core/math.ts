export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const saturate = (v: number): number => clamp(v, 0, 1);
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

/** Ángulo envuelto a [-PI, PI]. */
export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

export const dist2 = (ax: number, az: number, bx: number, bz: number): number => {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
};

export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }

/** Distancia de un punto a un segmento en XZ y parámetro t del punto más cercano. */
export function pointSegmentDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = saturate(t);
  const cx = ax + abx * t, cz = az + abz * t;
  return { d: Math.hypot(px - cx, pz - cz), t };
}

/** Distancia mínima entre dos segmentos 3D (para barridos de armas vs hitboxes). */
export function segmentSegmentDist3(
  p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3,
): number {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  const EPS = 1e-8;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0; t = saturate(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0; s = saturate(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? saturate((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = saturate(-c / a); }
      else if (t > 1) { t = 1; s = saturate((b - c) / a); }
    }
  }
  const cx = p1.x + d1.x * s - (p2.x + d2.x * t);
  const cy = p1.y + d1.y * s - (p2.y + d2.y * t);
  const cz = p1.z + d1.z * s - (p2.z + d2.z * t);
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Convención de rotación Y de Three.js: local→mundo
 *   wx = lx·cos + lz·sin ;  wz = −lx·sin + lz·cos
 */
export function toWorldXZ(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

/** Inversa de toWorldXZ (dx,dz relativos al centro). */
export function toLocalXZ(dx: number, dz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** Intersección segmento-rectángulo orientado (XZ). Rect: centro, medio-ancho, medio-fondo, rotación Y. */
export function segmentIntersectsOBB(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, hw: number, hd: number, rotY: number,
): boolean {
  // Transformar a espacio local del rectángulo.
  const la = toLocalXZ(ax - cx, az - cz, rotY), lb = toLocalXZ(bx - cx, bz - cz, rotY);
  const lax = la.x, laz = la.z, lbx = lb.x, lbz = lb.z;
  // Slab test (Liang–Barsky).
  let t0 = 0, t1 = 1;
  const dx = lbx - lax, dz = lbz - laz;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, lax + hw) && clip(dx, hw - lax) && clip(-dz, laz + hd) && clip(dz, hd - laz) && t0 <= t1;
}

export function pointInOBB(px: number, pz: number, cx: number, cz: number, hw: number, hd: number, rotY: number): boolean {
  const l = toLocalXZ(px - cx, pz - cz, rotY);
  return Math.abs(l.x) <= hw && Math.abs(l.z) <= hd;
}

/** Dirección cardinal en español desde un vector XZ (norte = -Z). */
export function cardinalFrom(dx: number, dz: number): string {
  const ang = Math.atan2(dx, -dz); // 0 = norte, PI/2 = este
  const names = ['NORTE', 'NORESTE', 'ESTE', 'SURESTE', 'SUR', 'SUROESTE', 'OESTE', 'NOROESTE'];
  const idx = Math.round(((ang + TAU) % TAU) / (TAU / 8)) % 8;
  return names[idx];
}

/** ¿Se cortan los segmentos AB y CD (XZ)? */
export function segmentsIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
