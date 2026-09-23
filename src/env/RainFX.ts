/**
 * Lluvia: gotas como segmentos alrededor de la cámara (un draw call).
 */
import * as THREE from 'three';

const N = 2200;
const BOX = 26;

export class RainFX {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private speed: Float32Array;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(N * 6);
    this.speed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * BOX * 2, y = Math.random() * 20, z = (Math.random() - 0.5) * BOX * 2;
      this.set(i, x, y, z);
      this.speed[i] = 16 + Math.random() * 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9aa4b0, transparent: true, opacity: 0, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
    scene.add(this.lines);
  }

  private set(i: number, x: number, y: number, z: number): void {
    const o = i * 6;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.pos[o + 3] = x + 0.05; this.pos[o + 4] = y + 0.55; this.pos[o + 5] = z;
  }

  update(dt: number, cam: THREE.Vector3, intensity: number, wind: number): void {
    const mat = this.lines.material as THREE.LineBasicMaterial;
    mat.opacity = Math.min(0.55, intensity * 0.6);
    this.lines.visible = intensity > 0.02;
    if (!this.lines.visible) return;
    this.lines.position.copy(cam);
    const active = Math.floor(N * Math.min(1, intensity));
    this.lines.geometry.setDrawRange(0, active * 2);
    for (let i = 0; i < active; i++) {
      const o = i * 6;
      let y = this.pos[o + 1] - this.speed[i] * dt;
      let x = this.pos[o] + wind * 3 * dt;
      let z = this.pos[o + 2];
      if (y < -8) {
        y = 12 + Math.random() * 6;
        x = (Math.random() - 0.5) * BOX * 2;
        z = (Math.random() - 0.5) * BOX * 2;
      }
      if (x > BOX) x -= BOX * 2;
      this.set(i, x, y, z);
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
