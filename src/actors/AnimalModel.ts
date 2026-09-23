/**
 * PLACEHOLDER · Cuadrúpedo procedural (ciervo, lobo) con marcha animada.
 */
import * as THREE from 'three';
import type { Hitbox } from './HumanoidModel';
import { damp } from '../core/math';

export interface AnimalLook {
  body: number;
  belly: number;
  size: number; // escala
  legLen: number;
  neckLen: number;
  antlers?: boolean;
  wolf?: boolean;
}

const G = { sphere: new THREE.SphereGeometry(1, 12, 8), cyl: new THREE.CylinderGeometry(1, 1, 1, 7), cone: new THREE.ConeGeometry(1, 1, 6) };
const mats = new Map<number, THREE.MeshStandardMaterial>();
const mat = (c: number) => { let m = mats.get(c); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }); mats.set(c, m); } return m; };

function mesh(g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.scale.set(sx, sy, sz);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

export class AnimalModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private legs: { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }[] = [];
  private tail = new THREE.Group();
  private phase = Math.random() * 6;
  speed = 0;
  state: 'idle' | 'graze' | 'alert' | 'walk' | 'run' | 'attack' | 'dead' | 'howl' = 'idle';
  private deadT = 0;
  private stT = 0;
  readonly hitboxes: Hitbox[];

  constructor(readonly look: AnimalLook) {
    const s = look.size;
    const b = mat(look.body), belly = mat(look.belly), dark = mat(0x1a1612);
    this.root.scale.setScalar(s);
    this.root.add(this.body);
    this.body.position.y = look.legLen + 0.25;
    this.body.add(mesh(G.sphere, b, 0.28, 0.27, 0.62));
    this.body.add(mesh(G.sphere, belly, 0.22, 0.18, 0.5, 0, -0.1, 0));
    // Cuello y cabeza.
    this.body.add(this.neck);
    this.neck.position.set(0, 0.12, 0.5);
    this.neck.rotation.x = look.wolf ? -0.9 : -0.5;
    this.neck.add(mesh(G.cyl, b, 0.1, look.neckLen, 0.12, 0, look.neckLen / 2, 0));
    this.neck.add(this.head);
    this.head.position.y = look.neckLen;
    this.head.rotation.x = look.wolf ? 0.9 : 0.6;
    this.head.add(mesh(G.sphere, b, 0.12, 0.12, 0.16, 0, 0, 0.03));
    this.head.add(mesh(G.cone, b, 0.08, 0.26, 0.08, 0, -0.02, 0.2).rotateX(Math.PI / 2));
    this.head.add(mesh(G.sphere, dark, 0.025, 0.025, 0.025, 0, 0.0, 0.33));
    for (const sx of [-1, 1]) {
      this.head.add(mesh(G.cone, b, 0.04, 0.12, 0.02, sx * 0.07, 0.13, -0.02));
      this.head.add(mesh(G.sphere, dark, 0.018, 0.018, 0.018, sx * 0.065, 0.04, 0.12));
      if (look.antlers) {
        const a = mesh(G.cyl, mat(0x8a7a60), 0.015, 0.35, 0.015, sx * 0.08, 0.28, -0.04);
        a.rotation.z = -sx * 0.4;
        this.head.add(a);
        const t = mesh(G.cyl, mat(0x8a7a60), 0.012, 0.18, 0.012, sx * 0.18, 0.38, 0.04);
        t.rotation.set(0.6, 0, -sx * 0.9);
        this.head.add(t);
      }
    }
    // Patas.
    for (const [front, side] of [[true, -1], [true, 1], [false, -1], [false, 1]] as const) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.14, -0.05, front ? 0.38 : -0.4);
      const up = look.legLen * 0.55, lo = look.legLen * 0.55;
      hip.add(mesh(G.cyl, b, 0.06, up, 0.07, 0, -up / 2, 0));
      const knee = new THREE.Group();
      knee.position.y = -up;
      knee.add(mesh(G.cyl, look.wolf ? b : belly, 0.035, lo, 0.035, 0, -lo / 2, 0));
      knee.add(mesh(G.sphere, dark, 0.04, 0.03, 0.05, 0, -lo, 0.02));
      hip.add(knee);
      this.body.add(hip);
      this.legs.push({ hip, knee, front, side });
    }
    this.body.add(this.tail);
    this.tail.position.set(0, 0.1, -0.6);
    this.tail.add(mesh(look.wolf ? G.cone : G.sphere, look.wolf ? b : mat(0xe8e0d0), look.wolf ? 0.07 : 0.06, look.wolf ? 0.4 : 0.08, look.wolf ? 0.07 : 0.05, 0, look.wolf ? -0.18 : 0, 0));
    this.tail.rotation.x = look.wolf ? 2.3 : -0.4;
    this.hitboxes = [
      { zone: 'head', pos: new THREE.Vector3(), r: 0.16 * s },
      { zone: 'torso', pos: new THREE.Vector3(), r: 0.3 * s },
      { zone: 'torso', pos: new THREE.Vector3(), r: 0.3 * s },
      { zone: 'leg', pos: new THREE.Vector3(), r: 0.12 * s },
    ];
  }

  setState(s: AnimalModel['state']): void {
    if (s !== this.state) { this.state = s; this.stT = 0; }
  }

  update(dt: number, full: boolean): void {
    this.stT += dt;
    const run = this.state === 'run' || this.state === 'attack';
    const moving = this.state === 'walk' || run;
    this.phase += dt * (run ? 11 : 6) * Math.max(0.5, Math.min(1.5, this.speed / (run ? 8 : 1.5)));
    const neckBase = this.look.wolf ? -0.9 : -0.5;
    let neckX = neckBase, bodyX = 0, bodyY = this.look.legLen + 0.25;
    if (this.state === 'graze') neckX = neckBase + 1.4 + Math.sin(this.stT * 2) * 0.05;
    if (this.state === 'alert') neckX = neckBase - 0.35;
    if (this.state === 'howl') neckX = neckBase - 0.9;
    if (this.state === 'dead') {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.5);
      this.root.rotation.z = k * 1.45;
      bodyY = this.look.legLen * (1 - k * 0.6) + 0.25;
    }
    if (run) bodyX = Math.sin(this.phase) * 0.08;
    this.neck.rotation.x = damp(this.neck.rotation.x, neckX, 6, dt);
    this.body.rotation.x = bodyX;
    this.body.position.y = bodyY + (moving ? Math.abs(Math.sin(this.phase)) * 0.04 : 0);
    for (const l of this.legs) {
      const ph = this.phase + (l.front ? 0 : Math.PI) + (l.side > 0 ? Math.PI * (run ? 0.15 : 1) : 0);
      const a = moving && this.state !== 'dead' ? (run ? 0.75 : 0.4) : 0;
      l.hip.rotation.x = Math.sin(ph) * a;
      l.knee.rotation.x = (l.front ? -1 : 1) * Math.max(0, Math.cos(ph)) * a * 1.1;
    }
    this.tail.rotation.z = Math.sin(this.stT * 3) * 0.1;
    if (full) {
      this.root.updateMatrixWorld(true);
      this.head.getWorldPosition(this.hitboxes[0].pos);
      this.body.localToWorld(this.hitboxes[1].pos.set(0, 0, 0.3));
      this.body.localToWorld(this.hitboxes[2].pos.set(0, 0, -0.3));
      this.legs[0].knee.getWorldPosition(this.hitboxes[3].pos);
    }
  }
}
