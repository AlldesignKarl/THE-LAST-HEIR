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
import { RigidSkin, characterMaterial, SURF } from '../engine/RigidSkin';

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

/** Torso (torno): de la cintura (y=0) a los hombros (y≈0.6), radio unitario aprox. */
function torsoGeometry(): THREE.BufferGeometry {
  const prof: [number, number][] = [[0.0, -0.02], [0.8, -0.02], [0.84, 0.1], [0.9, 0.25], [1.0, 0.4], [0.98, 0.5], [0.72, 0.57], [0.3, 0.61], [0.0, 0.62]];
  return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
}

/** Zapato: esfera deformada con puntera. */
function shoeGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 10, 6);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const y = p.getY(i);
    p.setY(i, Math.max(y, -0.55)); // suela plana
    if (z > 0) p.setZ(i, z * 1.25);
  }
  g.computeVertexNormals();
  return g;
}

const G = {
  capsule: new THREE.CapsuleGeometry(1, 1, 4, 10),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  sphereLo: new THREE.SphereGeometry(1, 8, 6),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  frustum: new THREE.CylinderGeometry(0.78, 1, 1, 14),
  torso: torsoGeometry(),
  shoe: shoeGeometry(),
  halfSphere: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(1, 1, 1, 18),
};

export class HumanoidModel {
  readonly root = new THREE.Group();
  private hips!: THREE.Bone;
  private spine!: THREE.Bone;
  private neck!: THREE.Bone;
  private head!: THREE.Bone;
  private shL!: THREE.Bone;
  private shR!: THREE.Bone;
  private elL!: THREE.Bone;
  private elR!: THREE.Bone;
  private hipL!: THREE.Bone;
  private hipR!: THREE.Bone;
  private knL!: THREE.Bone;
  private knR!: THREE.Bone;
  handR!: THREE.Bone;
  handL!: THREE.Bone;
  /** Malla única (skinning rígido): 1 draw call por personaje. */
  mesh!: THREE.SkinnedMesh;
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
    const b = app.build;
    const sk = new RigidSkin();
    const skin = app.skin, tunic = app.tunic, pants = app.pants, hair = app.hair, leather = 0x4a3524, dark = 0x1a1410, iron = 0x6a6a6e;
    this.hips = sk.bone(null, 0, 0.94 * b, 0);
    this.spine = sk.bone(this.hips, 0, 0.08, 0);
    this.neck = sk.bone(this.spine, 0, 0.6, 0);
    this.head = sk.bone(this.neck, 0, 0.16, 0);
    this.shL = sk.bone(this.spine, -0.23 * b, 0.5, 0);
    this.shR = sk.bone(this.spine, 0.23 * b, 0.5, 0);
    this.elL = sk.bone(this.shL, 0, -0.3, 0);
    this.elR = sk.bone(this.shR, 0, -0.3, 0);
    this.handL = sk.bone(this.elL, 0, -0.28, 0);
    this.handR = sk.bone(this.elR, 0, -0.28, 0);
    this.hipL = sk.bone(this.hips, -0.1 * b, -0.02, 0);
    this.hipR = sk.bone(this.hips, 0.1 * b, -0.02, 0);
    this.knL = sk.bone(this.hipL, 0, -0.46, 0);
    this.knR = sk.bone(this.hipR, 0, -0.46, 0);
    // Rasgos deterministas a partir de la apariencia (variedad sin datos extra).
    const seed = (app.tunic * 7 + app.hair * 13 + app.skin * 3) >>> 0;
    const pick = (n: number, salt: number) => ((seed >>> (salt % 16)) + salt * 7) % n;
    const linen = 0xd8cfb8, lip = new THREE.Color(skin).multiplyScalar(0.78).getHex(), eyeW = 0xe6ded0, iris = pick(3, 1) === 0 ? 0x3a5a6a : 0x3a2a1a;
    const female = !!app.female;
    const sw = female ? 0.9 : 1; // anchura de hombros
    // ----- Torso y ropa
    sk.kind = SURF.cloth;
    sk.part(this.spine, G.torso, tunic, 0.2 * b * sw, 1, 0.14 * b, 0, 0.0);
    // Faldón de la túnica (hasta medio muslo) o falda larga.
    if (app.robe || female) sk.part(this.hips, G.frustum, app.robe ? tunic : tunic, 0.19 * b, 0.82, 0.16 * b, 0, -0.36);
    else sk.part(this.hips, G.frustum, tunic, 0.18 * b, 0.34, 0.14 * b, 0, -0.1);
    // Cadera (se ve por debajo del faldón al andar).
    sk.part(this.hips, G.sphereLo, pants, 0.16 * b, 0.1, 0.12 * b, 0, -0.02);
    // Cuello de la túnica.
    sk.part(this.spine, G.cyl, tunic, 0.075, 0.05, 0.07, 0, 0.6);
    sk.kind = SURF.leather;
    sk.part(this.spine, G.cyl, leather, 0.172 * b * (female ? 0.95 : 1), 0.055, 0.125 * b, 0, 0.04);
    sk.kind = SURF.metal;
    sk.part(this.spine, G.box, 0x8a7a50, 0.04, 0.04, 0.012, 0, 0.04, 0.128 * b);
    sk.kind = SURF.leather;
    sk.part(this.spine, G.box, leather, 0.08, 0.1, 0.04, 0.15 * b, -0.02, 0.06); // bolsa
    if (app.apron) {
      sk.part(this.spine, G.box, leather, 0.24, 0.42, 0.015, 0, 0.26, 0.128 * b);
      sk.part(this.hips, G.box, leather, 0.28, 0.46, 0.015, 0, -0.24, 0.13 * b, 0.1);
    }
    if (female) {
      // Corpiño con cordones.
      sk.kind = SURF.cloth;
      sk.part(this.spine, G.torso, 0x3a2e26, 0.205 * b * sw, 0.62, 0.145 * b, 0, 0.05);
      sk.kind = SURF.linen;
      sk.part(this.spine, G.cyl, linen, 0.085, 0.06, 0.075, 0, 0.58);
    }
    // ----- Cabeza
    sk.kind = SURF.skin;
    sk.part(this.neck, G.cyl, skin, 0.052, 0.13, 0.05, 0, 0.03);
    sk.part(this.head, G.sphere, skin, 0.098, 0.118, 0.108, 0, 0.03);
    sk.part(this.head, G.sphere, skin, 0.08, 0.065, 0.085, 0, -0.03, 0.018); // mandíbula
    sk.part(this.head, G.box, skin, 0.022, 0.048, 0.03, 0, 0.012, 0.108, -0.25); // nariz
    sk.part(this.head, G.sphereLo, skin, 0.016, 0.014, 0.014, 0, -0.012, 0.118); // punta
    for (const e of [-1, 1]) {
      sk.part(this.head, G.sphereLo, skin, 0.012, 0.028, 0.02, e * 0.097, 0.018, -0.005); // oreja
      sk.part(this.head, G.sphereLo, eyeW, 0.017, 0.011, 0.008, e * 0.036, 0.027, 0.097);
      sk.part(this.head, G.sphereLo, iris, 0.008, 0.008, 0.005, e * 0.036, 0.027, 0.104);
      sk.kind = SURF.hair;
      sk.part(this.head, G.box, hair, 0.038, 0.009, 0.012, e * 0.037, 0.047, 0.102, 0, 0, -e * 0.12); // ceja
      sk.kind = SURF.skin;
    }
    sk.part(this.head, G.box, lip, 0.034, 0.008, 0.01, 0, -0.045, 0.1);
    // ----- Pelo, barba y tocados
    sk.kind = SURF.hair;
    const covered = app.hood || app.helmet;
    if (!covered) {
      if (female) {
        // Toca de lino sobre el pelo recogido.
        sk.kind = SURF.linen;
        sk.part(this.head, G.sphere, linen, 0.112, 0.105, 0.118, 0, 0.055, -0.012);
        sk.part(this.head, G.box, linen, 0.2, 0.2, 0.03, 0, -0.06, -0.09, 0.15);
        sk.kind = SURF.hair;
        sk.part(this.head, G.box, hair, 0.16, 0.025, 0.02, 0, 0.075, 0.1);
      } else {
        const style = pick(3, 5);
        sk.part(this.head, G.sphere, hair, 0.106, 0.075 + style * 0.01, 0.114, 0, 0.078, -0.012);
        sk.part(this.head, G.sphereLo, hair, 0.1, 0.07, 0.06, 0, 0.02, -0.075); // nuca
        if (style === 2) {
          // Gorro de fieltro.
          sk.kind = SURF.cloth;
          sk.part(this.head, G.frustum, new THREE.Color(tunic).multiplyScalar(0.6).getHex(), 0.1, 0.09, 0.108, 0, 0.13, -0.01);
          sk.part(this.head, G.brim, new THREE.Color(tunic).multiplyScalar(0.55).getHex(), 0.118, 0.018, 0.122, 0, 0.1, -0.01);
        }
      }
    }
    sk.kind = SURF.hair;
    if (app.beard) {
      sk.part(this.head, G.sphere, hair, 0.078, 0.068, 0.06, 0, -0.058, 0.058);
      sk.part(this.head, G.box, hair, 0.05, 0.012, 0.015, 0, -0.03, 0.108); // bigote
      for (const e of [-1, 1]) sk.part(this.head, G.box, hair, 0.018, 0.07, 0.05, e * 0.085, -0.01, 0.03);
    }
    if (app.hood) {
      sk.kind = SURF.cloth;
      const hoodC = new THREE.Color(tunic).multiplyScalar(0.8).getHex();
      sk.part(this.head, G.sphere, hoodC, 0.128, 0.135, 0.132, 0, 0.045, -0.025);
      // Capuz sobre los hombros.
      sk.part(this.spine, G.frustum, hoodC, 0.14 * b, 0.16, 0.12 * b, 0, 0.56);
    }
    if (app.helmet) {
      // Capacete de hierro con ala.
      sk.kind = SURF.metal;
      sk.part(this.head, G.halfSphere, iron, 0.118, 0.12, 0.124, 0, 0.06, -0.005);
      sk.part(this.head, G.brim, iron, 0.17, 0.012, 0.17, 0, 0.065, -0.005);
      sk.kind = SURF.linen;
      sk.part(this.head, G.sphereLo, linen, 0.108, 0.07, 0.11, 0, 0.02, -0.03); // cofia
    }
    // ----- Brazos
    for (const [sh, el, hand, e] of [[this.shL, this.elL, this.handL, -1], [this.shR, this.elR, this.handR, 1]] as const) {
      sk.kind = SURF.cloth;
      sk.part(sh, G.sphereLo, tunic, 0.058, 0.06, 0.06, -0.02 * (sh === this.shL ? -1 : 1), -0.03); // hombro
      sk.part(sh, G.capsule, tunic, 0.052, 0.14, 0.052, 0, -0.15);
      if (app.apron) {
        sk.kind = SURF.skin;
        sk.part(el, G.capsule, skin, 0.04, 0.13, 0.04, 0, -0.13); // mangas remangadas
        sk.kind = SURF.cloth;
        sk.part(el, G.cyl, tunic, 0.05, 0.05, 0.05, 0, -0.01);
      } else {
        sk.part(el, G.capsule, tunic, 0.044, 0.13, 0.044, 0, -0.13);
        sk.part(el, G.cyl, new THREE.Color(tunic).multiplyScalar(0.8).getHex(), 0.047, 0.03, 0.047, 0, -0.25); // puño
      }
      sk.kind = SURF.skin;
      sk.part(hand, G.sphere, skin, 0.034, 0.052, 0.022, 0, -0.03);
      sk.part(hand, G.capsule, skin, 0.011, 0.022, 0.011, e * -0.03, -0.015, 0.012, 0, 0, e * 0.6); // pulgar
    }
    // ----- Piernas y calzado
    for (const [hp, kn] of [[this.hipL, this.knL], [this.hipR, this.knR]] as const) {
      sk.kind = SURF.cloth;
      sk.part(hp, G.capsule, pants, 0.072 * b, 0.21, 0.075 * b, 0, -0.22);
      sk.part(kn, G.capsule, pants, 0.056, 0.2, 0.058, 0, -0.2);
      sk.kind = SURF.leather;
      sk.part(kn, G.cyl, dark, 0.058, 0.12, 0.06, 0, -0.37); // caña del zapato
      sk.part(kn, G.shoe, dark, 0.052, 0.045, 0.1, 0, -0.44, 0.035);
    }
    this.mesh = sk.build(this.hips, characterMaterial());
    this.root.add(this.mesh);
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
