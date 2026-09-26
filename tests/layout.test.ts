import { expect, it } from 'vitest';
import { BUILDINGS, ROADS, PLAYER_PLOT, WELL, MARKET_STALLS } from '../src/world/WorldLayout';
import { pointSegmentDist } from '../src/core/math';
import { Heightfield } from '../src/world/Heightfield';
it('los edificios no se solapan ni pisan caminos, playa o parcela', () => {
  const hf = new Heightfield();
  const probs: string[] = [];
  for (const b of BUILDINGS) {
    const r = Math.hypot(b.w, b.d) / 2;
    for (const o of BUILDINGS) if (o !== b) {
      const ro = Math.hypot(o.w, o.d) / 2;
      const d = Math.hypot(b.x - o.x, b.z - o.z);
      if (d < r + ro + 1.5 && BUILDINGS.indexOf(o) > BUILDINGS.indexOf(b)) probs.push(`${b.id} ~ ${o.id} ${d.toFixed(1)}`);
    }
    for (const rd of ROADS) for (let i = 0; i < rd.points.length - 1; i++) {
      const [ax, az] = rd.points[i], [bx, bz] = rd.points[i + 1];
      const { d } = pointSegmentDist(b.x, b.z, ax, az, bx, bz);
      if (d < r + rd.width / 2 + 0.5) probs.push(`${b.id} road ${rd.id} ${d.toFixed(1)}`);
    }
    if (Math.max(Math.abs(b.x - PLAYER_PLOT.x), Math.abs(b.z - PLAYER_PLOT.z)) < PLAYER_PLOT.size / 2 + r + 1) probs.push(`${b.id} plot`);
    if (Math.hypot(b.x - WELL.x, b.z - WELL.z) < r + 2) probs.push(`${b.id} well`);
    for (const m of MARKET_STALLS) if (Math.hypot(b.x - m.x, b.z - m.z) < r + 2) probs.push(`${b.id} stall`);
    const w = hf.surfaceWeights(b.x, b.z);
    if (w.beach > 0.3) probs.push(`${b.id} beach`);
    const n = hf.normalAt(b.x, b.z, 3);
    if (n.y < 0.95) probs.push(`${b.id} slope ${n.y.toFixed(2)}`);
    if (b.id.startsWith('house_n') || b.id === 'bakery') { const rr = Math.hypot(b.x, b.z); if (rr > 58) probs.push(`${b.id} palisade r=${rr.toFixed(1)}`); }
  }
  // La choza del jugador está junto a la senda del bosque a propósito.
  expect(probs.filter((p) => !p.startsWith('player_hut road forest_path'))).toEqual([]);
});
