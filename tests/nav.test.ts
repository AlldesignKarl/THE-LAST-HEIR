import { describe, expect, it } from 'vitest';
import { NavGraph } from '../src/world/NavGraph';
import { segmentIntersectsOBB } from '../src/core/math';

describe('NavGraph', () => {
  it('rodea un edificio y no atraviesa muros', () => {
    const obbs = [{ x: 0, z: 0, hw: 5, hd: 5, rot: 0.3 }];
    const walls = [{ ax: -20, az: 12, bx: 20, bz: 12 }];
    const nav = new NavGraph(obbs, walls);
    nav.addObstacleCorners(1.5);
    nav.addNode(-25, 12, 'west_end');
    nav.addNode(25, 12, 'east_end');
    nav.build();
    const path = nav.findPath(-12, 0, 12, 0);
    expect(path.length).toBeGreaterThan(1);
    let px = -12, pz = 0;
    for (const p of path) {
      expect(segmentIntersectsOBB(px, pz, p.x, p.z, 0, 0, 5, 5, 0.3)).toBe(false);
      px = p.x; pz = p.z;
    }
    expect(path[path.length - 1]).toEqual({ x: 12, z: 0 });
  });

  it('usa un hueco del muro y respeta muros desactivables', () => {
    const walls = [
      { ax: -30, az: 0, bx: -2, bz: 0 },
      { ax: 2, az: 0, bx: 30, bz: 0 },
      { ax: -2, az: 0, bx: 2, bz: 0, id: 'gate' },
    ];
    const nav = new NavGraph([], walls);
    nav.addNode(0, -2); nav.addNode(0, 2); nav.addNode(-31, 0); nav.addNode(31, 0);
    nav.build();
    expect(nav.clear(0, -5, 0, 5)).toBe(false);
    nav.setWallEnabled('gate', false);
    expect(nav.clear(0, -5, 0, 5)).toBe(true);
    nav.setWallEnabled('gate', true);
    const p = nav.findPath(-10, -5, -10, 5);
    // Debe dar la vuelta por un extremo.
    expect(p.some((q) => Math.abs(q.x) > 29)).toBe(true);
  });
});
