/**
 * PLACEHOLDER · Humanoide procedural con rig jerárquico y animación por
 * poses. Interfaz pensada para sustituirse por un SkinnedMesh glTF con
 * AnimationMixer: el resto del juego solo usa `setState`, `update`,
 * `hitboxes` y los puntos de anclaje de manos.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../engine/placeholder/Materials';
import type { ModelLibrary } from '../engine/placeholder/Models';
import { damp } from '../core/math';

export interface Appearance {
  skin: number;
  tunic: number;
  pants: number;
  hair: number;
  beard: boolean;
  hood?: boolean;
  helmet?: boolean;
  apron?: boolean;
  robe?: boolean;
  build: number; // 0.9..1.1
  female?: boolean;
}

export type AnimState =
  | 'idle' | 'walk' | 'run' | 'windup' | 'strike' | 'recover' | 'block' | 'hit' | 'dead'
  | 'work' | 'hammer' | 'pray' | 'sit' | 'guard' | 'farm' | 'sell' | 'drink' | 'chop' | 'cower' | 'aim' | 'talk';

export interface Hitbox { zone: 'head' | 'torso' | 'arm' | 'leg'; pos: THREE.Vector3; r: number }

const skinMats = new Map<number, THREE.MeshStandardMaterial>();
function colorMat(c: number, rough = 0.9, base?: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let m = skinMats.get(c);
  if (!m) {
    m = base ? base.clone() : new THREE.MeshStandardMaterial({ roughness: rough });
    m.color.setHex(c);
    skinMats.set(c, m);
  }
  return m;
}

const G = {
  capsule: new THREE.CapsuleGeometry(1, 1, 4, 8),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
};

function part(geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, y = 0, x = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export class HumanoidModel {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private elL = new THREE.Group();
  private elR = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private knL = new THREE.Group();
  private knR = new THREE.Group();
  readonly handR = new THREE.Group();
  readonly handL = new THREE.Group();
  private weaponObj: THREE.Object3D | null = null;
  private offObj: THREE.Object3D | null = null;
  state: AnimState = 'idle';
  private stateT = 0;
  private phase = Math.random() * 10;
  /** Velocidad horizontal para la cadencia. */
  speed = 0;
  /** 0..1 progreso de la fase de ataque actual. */
  attackProgress = 0;
  heavy = false;
  private deadT = 0;
  private hitT = 0;
  private cur: Record<string, number> = {};
  readonly hitboxes: Hitbox[];
  weaponKind: string | null = null;

  constructor(readonly app: Appearance, mats: MaterialLibrary) {
    const skin = colorMat(app.skin, 0.75);
    const tunic = colorMat(app.tunic, 0.95, mats.get('cloth'));
    const pants = colorMat(app.pants, 0.95, mats.get('cloth'));
    const hair = colorMat(app.hair, 1);
    const leather = mats.get('leather');
    const b = app.build;
    this.root.add(this.hips);
    this.hips.position.y = 0.94 * b;
    // Torso.
    this.hips.add(this.spine);
    this.spine.position.y = 0.08;
    const torso = part(G.capsule, tunic, 0.2 * b, 0.2, 0.13 * b, 0.28);
    this.spine.add(torso);
    this.spine.add(part(G.box, leather, 0.42 * b, 0.06, 0.28 * b, 0.04)); // cinturón
    if (app.robe || app.female) this.hips.add(part(G.cyl, app.robe ? tunic : pants, 0.24 * b, 0.75, 0.18 * b, -0.36));
    if (app.apron) this.spine.add(part(G.box, leather, 0.34, 0.7, 0.03, -0.05, 0, 0.14));
    // Cabeza.
    this.spine.add(this.neck);
    this.neck.position.y = 0.6;
    this.neck.add(part(G.cyl, skin, 0.055, 0.12, 0.055, 0.03));
    this.neck.add(this.head);
    this.head.position.y = 0.16;
    this.head.add(part(G.sphere, skin, 0.105, 0.125, 0.115, 0.02));
    this.head.add(part(G.sphere, hair, 0.11, 0.07, 0.115, 0.08, 0, -0.01));
    if (app.beard) this.head.add(part(G.sphere, hair, 0.08, 0.07, 0.06, -0.06, 0, 0.06));
    this.head.add(part(G.sphere, colorMat(0x1a1410), 0.015, 0.015, 0.01, 0.03, -0.04, 0.105));
    this.head.add(part(G.sphere, colorMat(0x1a1410), 0.015, 0.015, 0.01, 0.03, 0.04, 0.105));
    this.head.add(part(G.sphere, skin, 0.018, 0.03, 0.025, 0.0, 0, 0.115));
    if (app.hood) this.head.add(part(G.sphere, tunic, 0.125, 0.13, 0.13, 0.04, 0, -0.02));
    if (app.helmet) {
      const iron = mats.get('iron');
      this.head.add(part(G.sphere, iron, 0.12, 0.09, 0.125, 0.08));
      this.head.add(part(G.box, iron, 0.02, 0.09, 0.02, 0.0, 0, 0.125));
    }
    // Brazos.
    for (const [sh, el, hand, side] of [[this.shL, this.elL, this.handL, -1], [this.shR, this.elR, this.handR, 1]] as const) {
      this.spine.add(sh);
      sh.position.set(side * 0.23 * b, 0.5, 0);
      sh.add(part(G.capsule, tunic, 0.055, 0.13, 0.055, -0.14));
      sh.add(el);
      el.position.y = -0.3;
      el.add(part(G.capsule, app.apron ? skin : tunic, 0.045, 0.12, 0.045, -0.13));
      el.add(hand);
      hand.position.y = -0.28;
      hand.add(part(G.sphere, skin, 0.045, 0.05, 0.035));
    }
    // Piernas.
    for (const [hp, kn, side] of [[this.hipL, this.knL, -1], [this.hipR, this.knR, 1]] as const) {
      this.hips.add(hp);
      hp.position.set(side * 0.1 * b, -0.02, 0);
      hp.add(part(G.capsule, pants, 0.075 * b, 0.2, 0.075 * b, -0.22));
      hp.add(kn);
      kn.position.y = -0.46;
      kn.add(part(G.capsule, pants, 0.06, 0.18, 0.06, -0.2));
      kn.add(part(G.box, leather, 0.1, 0.07, 0.2, -0.44, 0, 0.04));
    }
    this.hitboxes = [
      { zone: 'head', pos: new THREE.Vector3(), r: 0.14 },
      { zone: 'torso', pos: new THREE.Vector3(), r: 0.24 },
      { zone: 'torso', pos: new THREE.Vector3(), r: 0.22 },
      { zone: 'arm', pos: new THREE.Vector3(), r: 0.1 },
      { zone: 'arm', pos: new THREE.Vector3(), r: 0.1 },
      { zone: 'leg', pos: new THREE.Vector3(), r: 0.12 },
      { zone: 'leg', pos: new THREE.Vector3(), r: 0.12 },
    ];
    void mats;
    void (null as unknown as ModelLibrary);
  }

  /** Coloca el arma en la mano derecha (modelo de ModelLibrary). */
  setWeapon(models: ModelLibrary, modelId: string | null, kind: string | null): void {
    if (this.weaponObj) this.handR.remove(this.weaponObj);
    this.weaponObj = null;
    this.weaponKind = kind;
    if (!modelId) return;
    const m = models.create(modelId).object;
    if (kind === 'bow') {
      m.rotation.set(0, 0, 0);
      this.handL.add(m);
      this.offObj = m;
      return;
    }
    m.rotation.set(Math.PI / 2, 0, 0);
    m.position.set(0, -0.02, kind === 'spear' ? 0.5 : 0.18);
    if (kind === 'spear') m.scale.set(1, 2.2, 1);
    this.handR.add(m);
    this.weaponObj = m;
  }

  setOffhand(models: ModelLibrary, modelId: string | null): void {
    if (this.offObj) this.offObj.parent?.remove(this.offObj);
    this.offObj = null;
    if (!modelId) return;
    const m = models.create(modelId).object;
    if (modelId === 'shield') {
      m.rotation.set(0, Math.PI / 2, 0);
      m.position.set(-0.06, 0.1, 0);
      this.elL.add(m);
    } else {
      m.rotation.set(Math.PI * 0.35, 0, 0);
      m.position.set(0, 0, 0.1);
      this.handL.add(m);
    }
    this.offObj = m;
  }

  setState(s: AnimState): void {
    if (s === this.state) return;
    this.state = s;
    this.stateT = 0;
    if (s === 'dead') this.deadT = 0;
    if (s === 'hit') this.hitT = 0.3;
  }

  /** Posición mundial del punto de antorcha (mano izquierda). */
  torchWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.handL.getWorldPosition(out).add(new THREE.Vector3(0, 0.35, 0));
  }

  private target(key: string, v: number, dt: number, speed = 12): number {
    const c = this.cur[key] ?? v;
    const n = damp(c, v, speed, dt);
    this.cur[key] = n;
    return n;
  }

  update(dt: number, full: boolean): void {
    this.stateT += dt;
    this.phase += dt * (this.state === 'run' ? 9.5 : 6.2) * Math.max(0.4, Math.min(1.6, this.speed / (this.state === 'run' ? 4.5 : 1.5)));
    this.hitT = Math.max(0, this.hitT - dt);
    const s = this.state;
    // Poses objetivo (radianes).
    let hipsY = 0, spineX = 0, spineY = 0, headX = 0, shLx = 0, shRx = 0, shLz = 0.08, shRz = -0.08, elL = -0.15, elR = -0.15;
    let hipLx = 0, hipRx = 0, knL = 0, knR = 0, rootX = 0, hipsYaw = 0;
    const sw = Math.sin(this.phase);
    if (s === 'walk' || s === 'run') {
      const a = s === 'run' ? 0.75 : 0.45;
      hipLx = sw * a; hipRx = -sw * a;
      knL = Math.max(0, -Math.cos(this.phase)) * a * 1.4 + 0.05;
      knR = Math.max(0, Math.cos(this.phase)) * a * 1.4 + 0.05;
      shLx = -sw * a * 0.7; shRx = sw * a * 0.7;
      elL = elR = s === 'run' ? -1.1 : -0.25;
      spineX = s === 'run' ? 0.18 : 0.04;
      hipsY = Math.abs(Math.cos(this.phase)) * (s === 'run' ? 0.06 : 0.03);
    } else if (s === 'idle' || s === 'talk' || s === 'guard' || s === 'sell') {
      const br = Math.sin(this.stateT * 1.6) * 0.02;
      spineX = br;
      if (s === 'guard') { shRx = -0.3; elR = -0.6; shLx = -0.2; elL = -0.5; }
      if (s === 'talk') { shRx = -0.3 + Math.sin(this.stateT * 2.3) * 0.2; elR = -0.9; headX = Math.sin(this.stateT * 1.3) * 0.08; }
      if (s === 'sell') { shRx = -0.2; elR = -0.4 + Math.sin(this.stateT * 1.8) * 0.3; }
    } else if (s === 'windup' || s === 'strike' || s === 'recover') {
      const p = this.attackProgress;
      const spear = this.weaponKind === 'spear';
      if (s === 'windup') {
        shRx = spear ? -0.2 : -2.4 * p - (this.heavy ? 0.4 * p : 0); shRz = spear ? 0 : -0.5 * p; elR = spear ? -1.4 * p : -1.2 * p;
        spineY = 0.4 * p; spineX = -0.05 * p;
      } else if (s === 'strike') {
        shRx = spear ? -1.4 : -2.6 + p * 2.9; shRz = spear ? 0 : -0.5 + p * 0.9; elR = spear ? -0.1 : -1.2 + p * 1.1;
        spineY = 0.4 - p * 0.9; spineX = 0.1 + p * 0.1;
      } else {
        shRx = 0.3 - p * 0.3; elR = -0.2; spineY = -0.5 * (1 - p);
      }
      shLx = -0.4; elL = -0.8;
      hipLx = 0.25; hipRx = -0.2; knR = 0.2;
    } else if (s === 'block') {
      shRx = -1.4; shRz = 0.4; elR = -1.3; shLx = -1.2; elL = -1.4; spineX = 0.1; hipLx = 0.3; hipRx = -0.25; knL = knR = 0.25; hipsY = -0.06;
    } else if (s === 'aim') {
      shLx = -1.5; shLz = 0.1; elL = 0; shRx = -1.5; shRz = -0.6; elR = -2.2; spineY = -0.4;
    } else if (s === 'hit') {
      spineX = -0.35; headX = -0.3; shLx = 0.3; shRx = 0.3;
    } else if (s === 'work' || s === 'hammer' || s === 'chop') {
      const hc = Math.sin(this.stateT * (s === 'hammer' ? 5 : 3.2));
      shRx = -1.6 - hc * 0.9; elR = -0.6 - Math.max(0, hc) * 0.6; spineX = 0.25; shLx = -0.6; elL = -0.8;
    } else if (s === 'farm') {
      const fc = Math.sin(this.stateT * 2.4);
      spineX = 0.75 + fc * 0.1; shRx = -0.9 - fc * 0.5; shLx = -0.9 - fc * 0.5; elL = elR = -0.4; knL = knR = 0.35; hipLx = hipRx = -0.3;
    } else if (s === 'pray') {
      hipLx = hipRx = -1.4; knL = knR = 1.5; hipsY = -0.42; shLx = shRx = -0.9; shLz = -0.35; shRz = 0.35; elL = elR = -1.2; headX = 0.35;
    } else if (s === 'sit' || s === 'drink') {
      hipLx = hipRx = -1.5; knL = knR = 1.5; hipsY = -0.45; spineX = 0.1;
      if (s === 'drink') { const dc = Math.max(0, Math.sin(this.stateT * 0.8)); shRx = -0.6 - dc * 1.4; elR = -1.4 - dc * 0.6; headX = -dc * 0.35; }
    } else if (s === 'cower') {
      spineX = 0.7; headX = 0.4; shLx = shRx = -2.2; elL = elR = -1.8; knL = knR = 0.9; hipLx = hipRx = -0.8; hipsY = -0.3;
    } else if (s === 'dead') {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.7);
      rootX = -k * k * 1.5;
      hipsY = -k * 0.75;
      shLx = shRx = -0.4 * k; elL = elR = -0.2; knL = knR = 0.3 * k; hipsYaw = 0.2 * k;
    }
    if (this.hitT > 0 && s !== 'dead') { spineX -= this.hitT * 1.2; headX -= this.hitT; }
    const sp = s === 'dead' ? 20 : s === 'strike' ? 30 : 14;
    this.root.rotation.x = this.target('rootX', rootX, dt, 8);
    this.hips.position.y = 0.94 * this.app.build + this.target('hipsY', hipsY, dt, sp);
    this.hips.rotation.y = this.target('hipsYaw', hipsYaw, dt);
    this.spine.rotation.x = this.target('spineX', spineX, dt, sp);
    this.spine.rotation.y = this.target('spineY', spineY, dt, sp);
    this.head.rotation.x = this.target('headX', headX, dt);
    this.shL.rotation.x = this.target('shLx', shLx, dt, sp);
    this.shR.rotation.x = this.target('shRx', shRx, dt, sp);
    this.shL.rotation.z = this.target('shLz', shLz, dt, sp);
    this.shR.rotation.z = this.target('shRz', shRz, dt, sp);
    this.elL.rotation.x = this.target('elL', elL, dt, sp);
    this.elR.rotation.x = this.target('elR', elR, dt, sp);
    this.hipL.rotation.x = this.target('hipLx', hipLx, dt, sp);
    this.hipR.rotation.x = this.target('hipRx', hipRx, dt, sp);
    this.knL.rotation.x = this.target('knL', knL, dt, sp);
    this.knR.rotation.x = this.target('knR', knR, dt, sp);
    if (full) this.updateHitboxes();
  }

  updateHitboxes(): void {
    this.root.updateMatrixWorld(true);
    const hb = this.hitboxes;
    this.head.getWorldPosition(hb[0].pos);
    hb[0].pos.y += 0.03;
    this.spine.localToWorld(hb[1].pos.set(0, 0.42, 0));
    this.spine.localToWorld(hb[2].pos.set(0, 0.1, 0));
    this.elL.getWorldPosition(hb[3].pos);
    this.elR.getWorldPosition(hb[4].pos);
    this.knL.getWorldPosition(hb[5].pos);
    this.knR.getWorldPosition(hb[6].pos);
    hb[5].pos.y += 0.15;
    hb[6].pos.y += 0.15;
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
  }
}
