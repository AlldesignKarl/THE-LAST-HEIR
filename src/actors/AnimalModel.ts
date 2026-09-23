/**
 * PLACEHOLDER · Cuadrúpedo procedural (ciervo, lobo) con esqueleto rígido
 * (1 draw call) y marcha animada.
 */
import * as THREE from 'three';
import type { Hitbox } from './HumanoidModel';
import { damp } from '../core/math';
import { RigidSkin, characterMaterial, SURF } from '../engine/RigidSkin';

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

export class AnimalModel {
  readonly root = new THREE.Group();
  private body: THREE.Bone;
  private neck: THREE.Bone;
  private head: THREE.Bone;
  private legs: { hip: THREE.Bone; knee: THREE.Bone; front: boolean; side: number }[] = [];
  private tail: THREE.Bone;
  private phase = Math.random() * 6;
  speed = 0;
  state: 'idle' | 'graze' | 'alert' | 'walk' | 'run' | 'attack' | 'dead' | 'howl' = 'idle';
  private deadT = 0;
  private stT = 0;
  readonly hitboxes: Hitbox[];
  readonly mesh: THREE.SkinnedMesh;

  constructor(readonly look: AnimalLook) {
    const s = look.size;
    const b = look.body, belly = look.belly, dark = 0x1a1612, antler = 0x8a7a60;
    const sk = new RigidSkin();
    sk.kind = SURF.hair; // pelaje
    this.body = sk.bone(null, 0, look.legLen + 0.25, 0);
    this.neck = sk.bone(this.body, 0, 0.12, 0.5);
    this.neck.rotation.x = look.wolf ? -0.9 : -0.5;
    this.head = sk.bone(this.neck, 0, look.neckLen, 0);
    this.head.rotation.x = look.wolf ? 0.9 : 0.6;
    this.tail = sk.bone(this.body, 0, 0.1, -0.6);
    this.tail.rotation.x = look.wolf ? 2.3 : -0.4;
    sk.part(this.body, G.sphere, b, 0.28, 0.27, 0.62);
    sk.part(this.body, G.sphere, belly, 0.22, 0.18, 0.5, 0, -0.1, 0);
    sk.part(this.neck, G.cyl, b, 0.1, look.neckLen, 0.12, 0, look.neckLen / 2, 0);
    sk.part(this.head, G.sphere, b, 0.12, 0.12, 0.16, 0, 0, 0.03);
    sk.part(this.head, G.cone, b, 0.08, 0.26, 0.08, 0, -0.02, 0.2, Math.PI / 2);
    sk.part(this.head, G.sphere, dark, 0.025, 0.025, 0.025, 0, 0, 0.33);
    for (const sx of [-1, 1]) {
      sk.part(this.head, G.cone, b, 0.04, 0.12, 0.02, sx * 0.07, 0.13, -0.02);
      sk.part(this.head, G.sphere, dark, 0.018, 0.018, 0.018, sx * 0.065, 0.04, 0.12);
      if (look.antlers) {
        sk.part(this.head, G.cyl, antler, 0.015, 0.35, 0.015, sx * 0.08, 0.28, -0.04, 0, 0, -sx * 0.4);
        sk.part(this.head, G.cyl, antler, 0.012, 0.18, 0.012, sx * 0.18, 0.38, 0.04, 0.6, 0, -sx * 0.9);
      }
    }
    for (const [front, side] of [[true, -1], [true, 1], [false, -1], [false, 1]] as const) {
      const up = look.legLen * 0.55, lo = look.legLen * 0.55;
      const hip = sk.bone(this.body, side * 0.14, -0.05, front ? 0.38 : -0.4);
      const knee = sk.bone(hip, 0, -up, 0);
      sk.part(hip, G.cyl, b, 0.06, up, 0.07, 0, -up / 2, 0);
      sk.part(knee, G.cyl, look.wolf ? b : belly, 0.035, lo, 0.035, 0, -lo / 2, 0);
      sk.part(knee, G.sphere, dark, 0.04, 0.03, 0.05, 0, -lo, 0.02);
      this.legs.push({ hip, knee, front, side });
    }
    if (look.wolf) sk.part(this.tail, G.cone, b, 0.07, 0.4, 0.07, 0, -0.18, 0);
    else sk.part(this.tail, G.sphere, 0xe8e0d0, 0.06, 0.08, 0.05);
    this.mesh = sk.build(this.body, characterMaterial());
    this.root.add(this.mesh);
    this.root.scale.setScalar(s);
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
