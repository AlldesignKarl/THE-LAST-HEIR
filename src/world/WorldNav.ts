/**
 * Construye el grafo de navegación del slice a partir del Settlement:
 * muros de edificios (con hueco de puerta), empalizada (portón y brecha
 * como muros activables), lugares, caminos y puntos de interés.
 */
import { NavGraph, type Wall } from './NavGraph';
import type { Settlement } from './Settlement';
import { PALISADE, ROADS, RAID_STAGING, BANDIT_CAMP, CAVE, DEER_MEADOW, GROVE_NE } from './WorldLayout';
import { toWorldXZ } from '../core/math';

export function buildWorldNav(s: Settlement): NavGraph {
  const walls: Wall[] = [];
  for (const b of s.buildings.values()) {
    const d = b.def;
    const hw = d.w / 2, hd = d.d / 2;
    const W = (ax: number, az: number, bx: number, bz: number) => {
      const a = toWorldXZ(ax, az, b.rotY), c = toWorldXZ(bx, bz, b.rotY);
      walls.push({ ax: d.x + a.x, az: d.z + a.z, bx: d.x + c.x, bz: d.z + c.z });
    };
    W(-hw, -hd, hw, -hd); // fondo
    W(-hw, -hd, -hw, hd); // izquierda
    W(hw, -hd, hw, hd); // derecha
    if (!d.openFront) {
      const door = b.doors[0];
      if (door) {
        // Hueco de la puerta en el frente.
        const lx = door.pivot.position.x; // borde izquierdo del hueco
        W(-hw, hd, lx, hd);
        W(lx + door.width, hd, hw, hd);
      } else W(-hw, hd, hw, hd);
    }
  }
  // Empalizada.
  const P = PALISADE;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const a0 = P.from + (i / steps) * (P.to - P.from);
    const a1 = P.from + ((i + 1) / steps) * (P.to - P.from);
    const mid = (a0 + a1) / 2;
    const seg = { ax: Math.cos(a0) * P.radius, az: Math.sin(a0) * P.radius, bx: Math.cos(a1) * P.radius, bz: Math.sin(a1) * P.radius };
    if (angDiff(mid, P.gateAngle) < (P.gateWidth / 2 + 2) / P.radius) walls.push({ ...seg, id: 'gate' });
    else if (angDiff(mid, P.breachAngle) < (P.breachWidth / 2 + 2) / P.radius) walls.push({ ...seg, id: 'breach' });
    else walls.push(seg);
  }
  const nav = new NavGraph([], walls);
  // Lugares.
  for (const p of s.places.values()) nav.addNode(p.x, p.z, p.id);
  // Esquinas de edificios y puertas.
  for (const b of s.buildings.values()) {
    const d = b.def;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const w = toWorldXZ(sx * (d.w / 2 + 1.1), sz * (d.d / 2 + 1.1), b.rotY);
      nav.addNode(d.x + w.x, d.z + w.z);
    }
    for (const door of b.doors) {
      nav.addNode(door.outside.x, door.outside.z, `out:${d.id}`);
      nav.addNode(door.inside.x, door.inside.z, `ins:${d.id}`);
    }
  }
  // Portón y brecha (dentro/fuera).
  for (const [ang, name] of [[P.gateAngle, 'gate'], [P.breachAngle, 'breach']] as const) {
    nav.addNode(Math.cos(ang) * (P.radius - 3), Math.sin(ang) * (P.radius - 3), `${name}_in`);
    nav.addNode(Math.cos(ang) * (P.radius + 4), Math.sin(ang) * (P.radius + 4), `${name}_out`);
  }
  // Extremos de la empalizada (rodearla).
  nav.addNode(-P.radius - 3, 2, 'pal_w');
  nav.addNode(P.radius + 3, 2, 'pal_e');
  // Caminos (cada ~18 m, hasta 450 m del pueblo).
  for (const r of ROADS) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 18));
      for (let k = 0; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        if (Math.hypot(x, z) < 450) nav.addNode(x, z);
      }
    }
  }
  nav.addNode(RAID_STAGING.x, RAID_STAGING.z, 'staging');
  nav.addNode(BANDIT_CAMP.x, BANDIT_CAMP.z + 4, 'camp');
  nav.addNode(CAVE.mouth.x - 1, CAVE.mouth.z, 'cave_mouth');
  nav.addNode(DEER_MEADOW.x, DEER_MEADOW.z, 'meadow');
  nav.addNode(GROVE_NE.x, GROVE_NE.z + 25, 'grove');
  nav.build(90);
  nav.setWallEnabled('breach', s.palisadeRepaired);
  nav.setWallEnabled('gate', !s.gate.open);
  return nav;
}
