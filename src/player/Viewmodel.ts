/**
 * Brazos y armas en primera persona. Se renderizan en una escena propia
 * (sin atravesar paredes) con luces que imitan las del mundo. Las poses se
 * interpolan con inercia y rebote para transmitir peso.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { itemDef } from '../data/items';
import { WEAPONS, BOW } from '../combat/WeaponDefs';
import { damp } from '../core/math';

interface Pose { p: THREE.Vector3; r: THREE.Euler }

const P = (x: number, y: number, z: number, rx: number, ry: number, rz: number): Pose => ({ p: new THREE.Vector3(x, y, z), r: new THREE.Euler(rx, ry, rz) });

const POSES = {
  idle: P(0.26, -0.3, -0.46, 0.15, 0.12, -0.05),
  idleFists: P(0.22, -0.32, -0.42, 0.3, 0.1, 0),
  lightWind: P(0.5, -0.05, -0.32, 0.4, -0.7, -1.2),
  lightEnd: P(-0.35, -0.38, -0.5, -0.4, 0.8, 1.1),
  heavyWind: P(0.18, 0.2, -0.22, 1.5, 0.05, -0.1),
  heavyEnd: P(0.02, -0.5, -0.62, -1.1, 0.0, 0.0),
  block: P(0.02, -0.12, -0.42, 0.0, 0.0, 1.45),
  reach: P(0.12, -0.42, -0.72, -0.6, 0.1, 0),
  kick: P(0.3, -0.2, -0.3, 0.6, 0.2, 0),
  lowered: P(0.3, -0.7, -0.35, 0.8, 0.2, 0),
  bowIdle: P(0.18, -0.3, -0.4, 0.2, 0, 0),
  bowDrawn: P(0.06, -0.08, -0.18, 0.1, 0, 0),
};

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private right = new THREE.Group();
  private left = new THREE.Group();
  private rightHand = new THREE.Group();
  private leftHand = new THREE.Group();
  private weaponObj: THREE.Object3D | null = null;
  private offObj: THREE.Object3D | null = null;
  private curMain: string | null = 'x';
  private curOff: string | null = 'x';
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private dir = new THREE.DirectionalLight(0xffffff, 1);
  private torchLight = new THREE.PointLight(0xff9040, 0, 6, 2);
  private fireLights = [new THREE.PointLight(0xff8040, 0, 12, 2), new THREE.PointLight(0xff8040, 0, 12, 2)];
  private reachT = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private cur = { p: new THREE.Vector3(), r: new THREE.Vector3() };
  private curL = { p: new THREE.Vector3(-0.3, -0.35, -0.45), r: new THREE.Vector3() };
  readonly torchTip = new THREE.Vector3();
  visible = true;

  constructor(private readonly g: Game) {
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(this.camera, this.hemi, this.dir, this.dir.target, this.torchLight, ...this.fireLights);
    const skin = new THREE.MeshStandardMaterial({ color: 0xc09070, roughness: 0.7 });
    const sleeve = g.materials.tint('cloth', 0x5a4a38);
    const mkArm = (grp: THREE.Group, hand: THREE.Group) => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 8), sleeve);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(0, -0.02, 0.28);
      grp.add(arm);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), skin);
      h.scale.set(1, 0.85, 1.2);
      hand.add(h);
      grp.add(hand);
      this.camera.add(grp);
    };
    mkArm(this.right, this.rightHand);
    mkArm(this.left, this.leftHand);
  }

  /** Animación de "alcanzar" al recoger un objeto. */
  reach(): void {
    this.reachT = 0.35;
  }

  private rebuild(): void {
    const eq = this.g.equipment;
    const main = eq.slots.main;
    const off = eq.slots.off;
    if (main === this.curMain && off === this.curOff) return;
    this.curMain = main;
    this.curOff = off;
    if (this.weaponObj) this.rightHand.remove(this.weaponObj);
    if (this.offObj) this.offObj.parent?.remove(this.offObj);
    this.weaponObj = this.offObj = null;
    const models = this.g.models;
    if (main) {
      const d = itemDef(main);
      const w = d.weapon ? WEAPONS[d.weapon] : null;
      if (w?.kind === 'bow') {
        const b = models.create('bow').object;
        b.rotation.set(0, 0, 0);
        b.position.set(0, 0, 0);
        this.leftHand.add(b);
        this.offObj = b;
      } else {
        const m = models.create(d.model).object;
        m.rotation.set(-Math.PI / 2 + 0.25, 0, 0);
        m.position.set(0, 0.02, -0.12);
        if (d.weapon === 'spear') m.scale.set(1, 2.2, 1);
        this.rightHand.add(m);
        this.weaponObj = m;
      }
    }
    if (off && !(main && itemDef(main).weapon === 'bow')) {
      const m = models.create(itemDef(off).model).object;
      if (off === 'torch') { m.rotation.set(-0.5, 0, 0.2); m.position.set(0, 0.05, -0.05); }
      else { m.rotation.set(0, Math.PI / 2, 0); m.position.set(0.05, 0.05, -0.1); }
      this.leftHand.add(m);
      this.offObj = m;
    }
    for (const o of [this.weaponObj, this.offObj]) o?.traverse((c) => { (c as THREE.Mesh).castShadow = false; });
  }

  update(dt: number, mainCam: THREE.PerspectiveCamera): void {
    const g = this.g;
    this.rebuild();
    this.camera.aspect = mainCam.aspect;
    this.camera.fov = mainCam.fov * 0.86;
    this.camera.updateProjectionMatrix();
    const c = g.combat;
    const pl = g.player;
    const main = g.equipment.slots.main;
    const wKind = main ? itemDef(main).weapon : undefined;
    const isBow = wKind === 'bow';
    // Pose objetivo derecha.
    let target: Pose = main ? (isBow ? POSES.bowIdle : POSES.idle) : POSES.idleFists;
    let k = 0;
    let speed = 14;
    switch (c.state) {
      case 'ready': target = POSES.lightWind; k = 0.3; speed = 10; break;
      case 'windup': target = c.heavy ? POSES.heavyWind : POSES.lightWind; k = 1; speed = c.heavy ? 7 : 11; break;
      case 'strike': target = c.heavy ? POSES.heavyEnd : POSES.lightEnd; k = 1; speed = 30; break;
      case 'recover': target = main ? POSES.idle : POSES.idleFists; speed = 5; break;
      case 'block': target = POSES.block; speed = 16; break;
      case 'kick': target = POSES.kick; speed = 12; break;
      case 'stagger': target = POSES.lowered; speed = 10; break;
      case 'draw': target = POSES.bowDrawn; speed = 4 + (c.drawT / BOW.drawTime) * 4; break;
      default: break;
    }
    if (g.interaction.carried) { target = POSES.lowered; speed = 8; }
    if (this.reachT > 0) { this.reachT -= dt; target = POSES.reach; speed = 18; }
    void k;
    // Balanceo al andar y retardo al girar (inercia).
    const bob = pl.bobAmount;
    const bx = Math.sin(pl.bobPhase) * 0.012 * bob;
    const by = Math.abs(Math.cos(pl.bobPhase)) * 0.014 * bob;
    const dyaw = pl.yaw - this.lastYaw, dpitch = pl.pitch - this.lastPitch;
    this.lastYaw = pl.yaw; this.lastPitch = pl.pitch;
    this.swayX = damp(this.swayX + dyaw * 0.6, 0, 8, dt);
    this.swayY = damp(this.swayY - dpitch * 0.6, 0, 8, dt);
    const tp = target.p, tr = target.r;
    this.cur.p.x = damp(this.cur.p.x, tp.x + bx + this.swayX * 0.4, speed, dt);
    this.cur.p.y = damp(this.cur.p.y, tp.y - by + this.swayY * 0.4, speed, dt);
    this.cur.p.z = damp(this.cur.p.z, tp.z, speed, dt);
    this.cur.r.x = damp(this.cur.r.x, tr.x, speed, dt);
    this.cur.r.y = damp(this.cur.r.y, tr.y, speed, dt);
    this.cur.r.z = damp(this.cur.r.z, tr.z, speed, dt);
    this.right.position.copy(this.cur.p);
    this.right.rotation.set(this.cur.r.x, this.cur.r.y, this.cur.r.z);
    this.right.visible = !isBow || c.state === 'draw' || true;
    // Izquierda: antorcha/escudo/arco.
    const off = g.equipment.slots.off;
    let lp = new THREE.Vector3(-0.32, -0.36, -0.46), lr = new THREE.Vector3(0.1, -0.1, 0.1);
    if (isBow) {
      lp = c.state === 'draw' ? new THREE.Vector3(-0.02, -0.06, -0.55) : new THREE.Vector3(-0.2, -0.28, -0.5);
      lr = new THREE.Vector3(0, 0, c.state === 'draw' ? 0.05 : 0.35);
      if (c.state === 'draw') {
        // Mano derecha tira de la cuerda hacia la mejilla.
        const dk = Math.min(1, c.drawT / BOW.drawTime);
        this.right.position.set(0.02 + 0.02 * dk, -0.06, -0.5 + dk * 0.32);
        this.right.rotation.set(0, 0, 0);
      }
    } else if (off === 'shield') {
      lp = c.state === 'block' ? new THREE.Vector3(-0.08, -0.18, -0.4) : new THREE.Vector3(-0.34, -0.38, -0.44);
      lr = new THREE.Vector3(0, c.state === 'block' ? 0.2 : 0.5, 0);
    } else if (off === 'torch') {
      lp = new THREE.Vector3(-0.3, -0.3 + by * 0.5, -0.48);
      lr = new THREE.Vector3(0.25, 0, 0.1);
    } else if (!main) {
      lp = new THREE.Vector3(-0.22, -0.32, -0.42);
      if (c.state === 'block') lp.set(-0.08, -0.14, -0.38);
    }
    if (g.interaction.carried) lp.set(-0.25, -0.6, -0.4);
    this.curL.p.x = damp(this.curL.p.x, lp.x - bx + this.swayX * 0.35, 12, dt);
    this.curL.p.y = damp(this.curL.p.y, lp.y - by + this.swayY * 0.35, 12, dt);
    this.curL.p.z = damp(this.curL.p.z, lp.z, 12, dt);
    this.curL.r.x = damp(this.curL.r.x, lr.x, 12, dt);
    this.curL.r.y = damp(this.curL.r.y, lr.y, 12, dt);
    this.curL.r.z = damp(this.curL.r.z, lr.z, 12, dt);
    this.left.position.copy(this.curL.p);
    this.left.rotation.set(this.curL.r.x, this.curL.r.y, this.curL.r.z);
    this.left.visible = isBow || !!off || c.state === 'block' || !main;

    // Punta de la antorcha en coordenadas de mundo (para fuego y luz).
    this.camera.updateMatrixWorld(true);
    this.leftHand.updateMatrixWorld(true);
    const tipLocal = new THREE.Vector3(0, 0.34, -0.2).applyMatrix4(this.leftHand.matrixWorld);
    // leftHand está en espacio de la cámara del viewmodel: pasar a mundo con la cámara principal.
    this.torchTip.copy(tipLocal).applyMatrix4(mainCam.matrixWorld);

    // Luces que imitan el mundo.
    const env = g.env;
    this.hemi.intensity = env.hemi.intensity;
    this.hemi.color.copy(env.hemi.color);
    this.hemi.groundColor.copy(env.hemi.groundColor);
    this.dir.intensity = env.sun.intensity * 0.8;
    this.dir.color.copy(env.sun.color);
    const sd = env.sun.position.clone().sub(env.sun.target.position).normalize().transformDirection(mainCam.matrixWorldInverse);
    this.dir.position.copy(sd.multiplyScalar(5));
    const torchOn = g.equipment.torchLit && off === 'torch';
    this.torchLight.intensity = torchOn ? 2.2 * (0.85 + Math.random() * 0.15) : 0;
    this.torchLight.position.set(-0.3, 0.1, -0.5);
    // Dos fuegos más cercanos.
    const near = [...g.fires.fires.values()].filter((f) => f.lit && !f.hidden).map((f) => ({ f, d: f.pos.distanceTo(mainCam.position) })).sort((a, b) => a.d - b.d).slice(0, 2);
    this.fireLights.forEach((l, i) => {
      const n = near[i];
      if (!n || n.d > 12) { l.intensity = 0; return; }
      l.position.copy(n.f.pos).applyMatrix4(mainCam.matrixWorldInverse);
      l.intensity = 3 * (1 - n.d / 12);
    });
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}
