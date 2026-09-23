/**
 * Agua del arroyo: cinta a lo largo del cauce con normales animadas.
 */
import * as THREE from 'three';
import type { Heightfield } from './Heightfield';
import { STREAM } from './WorldLayout';
import type { TextureLibrary } from '../engine/placeholder/Textures';

export class Water {
  readonly mesh: THREE.Mesh;
  private normal: THREE.Texture;

  constructor(hf: Heightfield, scene: THREE.Scene, textures: TextureLibrary) {
    const pts = STREAM.points;
    const halfW = STREAM.width / 2 + 0.9;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let dist = 0;
    let row = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / 3));
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let s = 0; s <= steps; s++) {
        if (i > 0 && s === 0) continue;
        const t = s / steps;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const lvl = hf.waterLevelAt(x, z) ?? hf.heightAt(x, z);
        const nx = -dz, nz = dx;
        pos.push(x + nx * halfW, lvl, z + nz * halfW, x - nx * halfW, lvl, z - nz * halfW);
        uv.push(0, dist / 4, 1, dist / 4);
        if (row > 0) {
          const a = (row - 1) * 2, b = a + 1, c = row * 2, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
        row++;
        dist += len / steps;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Textura propia del agua (nadie más la usa: se puede desplazar su offset).
    this.normal = textures.get('waterNormal').normalMap!;
    this.normal.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1d2f2c,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.82,
      normalMap: this.normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  update(dt: number): void {
    this.normal.offset.y -= dt * 0.18;
  }
}
