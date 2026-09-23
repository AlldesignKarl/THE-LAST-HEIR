import { describe, expect, it } from 'vitest';
import { Heightfield } from '../src/world/Heightfield';
import { CAVE, CAVE_HILL, VILLAGES } from '../src/world/WorldLayout';

describe('Heightfield', () => {
  const hf = new Heightfield();

  it('es determinista', () => {
    const b = new Heightfield();
    for (let i = 0; i < 50; i++) {
      const x = (i * 37) % 900 - 450, z = (i * 91) % 900 - 450;
      expect(hf.heightAt(x, z)).toBe(b.heightAt(x, z));
    }
  });

  it('el pueblo es casi llano', () => {
    const v = VILLAGES[0];
    const hs: number[] = [];
    for (let a = 0; a < 16; a++) {
      const r = (a % 4) * 15;
      hs.push(hf.heightAt(v.x + Math.cos(a) * r, v.z + Math.sin(a) * r));
    }
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(1.2);
  });

  it('la colina de la cueva es alta sobre el túnel', () => {
    const top = hf.heightAt(CAVE_HILL.x + 10, CAVE_HILL.z);
    const mouth = hf.heightAt(CAVE.mouth.x, CAVE.mouth.z);
    expect(top - mouth).toBeGreaterThan(18);
  });

  it('el arroyo tiene agua por encima del lecho', () => {
    const lvl = hf.waterLevelAt(-92, -60);
    expect(lvl).not.toBeNull();
    expect(hf.heightAt(-92, -60)).toBeLessThan(lvl!);
  });

  it('no hay árboles en el pueblo ni en caminos', () => {
    expect(hf.forestDensity(0, 0)).toBe(0);
    expect(hf.forestDensity(0, -100)).toBe(0);
    expect(hf.forestDensity(-200, 0)).toBeGreaterThan(0.3);
  });

  it('rendimiento razonable', () => {
    const t0 = performance.now();
    let s = 0;
    for (let i = 0; i < 20000; i++) s += hf.heightAt((i % 141) * 3 - 200, Math.floor(i / 141) * 3 - 200);
    const ms = performance.now() - t0;
    expect(s).not.toBeNaN();
    expect(ms).toBeLessThan(400);
  });
});

import { toLocalXZ, toWorldXZ, pointInOBB, segmentIntersectsOBB } from '../src/core/math';
describe('transformaciones XZ', () => {
  it('toLocal es inversa de toWorld y coincide con Three', async () => {
    const THREE = await import('three');
    const rot = 0.7;
    const w = toWorldXZ(1.5, -2, rot);
    const v = new THREE.Vector3(1.5, 0, -2).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    expect(w.x).toBeCloseTo(v.x); expect(w.z).toBeCloseTo(v.z);
    const l = toLocalXZ(w.x, w.z, rot);
    expect(l.x).toBeCloseTo(1.5); expect(l.z).toBeCloseTo(-2);
  });
  it('OBB', () => {
    const rot = Math.PI / 4;
    const p = toWorldXZ(1.9, 0, rot);
    expect(pointInOBB(p.x, p.z, 0, 0, 2, 0.5, rot)).toBe(true);
    const q = toWorldXZ(0, 1.9, rot);
    expect(pointInOBB(q.x, q.z, 0, 0, 2, 0.5, rot)).toBe(false);
    expect(segmentIntersectsOBB(-5, 0, 5, 0, 0, 0, 1, 1, rot)).toBe(true);
    expect(segmentIntersectsOBB(-5, 3, 5, 3, 0, 0, 1, 1, 0)).toBe(false);
  });
});
