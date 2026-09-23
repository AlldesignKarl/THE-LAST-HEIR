/**
 * Constructor procedural de edificios (PLACEHOLDER geométrico).
 * Genera muros con huecos, entramado, tejado a dos aguas, chimenea,
 * ventanas con luz interior, puerta con bisagra (collider cinemático) y
 * colliders de muros. Las piezas se fusionan por material (≈5 draw calls
 * por edificio). Soporta daño persistente e incendio.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingDef } from './WorldLayout';
import type { Heightfield } from './Heightfield';
import { Physics, RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import { worldBox, type MaterialLibrary, type MatId } from '../engine/placeholder/Materials';
import { toLocalXZ } from '../core/math';

export interface Opening { x: number; w: number; y0: number; y1: number }

interface Part { geo: THREE.BufferGeometry; mat: MatId; m: THREE.Matrix4 }

const WALL_T = 0.28;

export interface Door {
  id: string;
  buildingId: string;
  pivot: THREE.Object3D;
  body: RAPIER.RigidBody;
  open: boolean;
  angle: number;
  locked: boolean;
  /** Dirección de apertura (+1/-1). */
  swing: number;
  /** Posición en mundo del centro del hueco (exterior). */
  worldPos: THREE.Vector3;
  /** Punto de paso exterior (1 m fuera) e interior. */
  outside: THREE.Vector3;
  inside: THREE.Vector3;
  width: number;
}

export class BuildingInstance {
  readonly group = new THREE.Group();
  readonly rotY: number;
  readonly floorY: number;
  readonly windowMat: THREE.MeshStandardMaterial;
  readonly doors: Door[] = [];
  readonly chimneyTop: THREE.Vector3 | null = null;
  readonly body: RAPIER.RigidBody;
  /** Puntos donde puede haber fuego (mundo). */
  readonly firePoints: THREE.Vector3[] = [];
  /** Punto para luz interior (mundo). */
  readonly interiorLight: THREE.Vector3;
  readonly bellPos: THREE.Vector3 | null = null;
  health: number;
  burning = false;
  /** 0..1 nivel de iluminación de ventanas. */
  windowGlow = 0;
  private roofMesh: THREE.Mesh | null = null;
  private charredMesh: THREE.Mesh | null = null;
  private healthyMeshes: THREE.Mesh[] = [];

  constructor(
    readonly def: BuildingDef,
    hf: Heightfield,
    mats: MaterialLibrary,
    private readonly physics: Physics,
  ) {
    this.health = def.maxHealth;
    this.rotY = Math.atan2(def.faceX - def.x, def.faceZ - def.z);
    // Altura: esquina más alta + zócalo.
    const hw = def.w / 2, hd = def.d / 2;
    const cos = Math.cos(this.rotY), sin = Math.sin(this.rotY);
    const corner = (lx: number, lz: number) => hf.heightAt(def.x + lx * cos + lz * sin, def.z - lx * sin + lz * cos);
    const hs = [corner(-hw, -hd), corner(hw, -hd), corner(-hw, hd), corner(hw, hd), hf.heightAt(def.x, def.z), corner(0, hd + 1.2)];
    const maxH = Math.max(...hs), minH = Math.min(...hs);
    this.floorY = maxH + 0.18;
    this.group.position.set(def.x, this.floorY, def.z);
    this.group.rotation.y = this.rotY;

    this.windowMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, emissive: 0xffa040, emissiveIntensity: 0, roughness: 1 });

    const parts: Part[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: MatId, rotX = 0, rotZ = 0, rotY = 0, texel = 2) => {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)),
        new THREE.Vector3(1, 1, 1),
      );
      parts.push({ geo: worldBox(w, h, d, texel), mat, m });
    };
    const colliders: { hx: number; hy: number; hz: number; x: number; y: number; z: number; rx?: number; rz?: number }[] = [];
    const solid = (w: number, h: number, d: number, x: number, y: number, z: number, mat: MatId, rotX = 0, rotZ = 0) => {
      box(w, h, d, x, y, z, mat, rotX, rotZ);
      colliders.push({ hx: w / 2, hy: h / 2, hz: d / 2, x, y, z, rx: rotX, rz: rotZ });
    };

    const style = def.style;
    const H = def.wallH;
    const wallMat: MatId = style === 'stone' ? 'stoneWall' : style === 'timber' ? 'plaster' : style === 'wattle' ? 'wattle' : 'planks';

    // Zócalo de piedra hasta el terreno.
    const plinthH = this.floorY - minH + 0.4;
    solid(def.w + 0.3, plinthH, def.d + 0.3, 0, -plinthH / 2, 0, 'stoneWall');
    // Suelo interior.
    if (def.enterable) box(def.w - WALL_T, 0.06, def.d - WALL_T, 0, 0.03, 0, style === 'stone' ? 'stoneWall' : 'planks', 0, 0, 0, 1.5);

    // Huecos.
    const doorW = def.id === 'church' ? 1.8 : 1.1;
    const doorH = def.id === 'church' ? 3 : 2.1;
    const frontOpen: Opening[] = [];
    const doorX = def.openFront ? 0 : (def.w > 6 ? -def.w * 0.18 : 0);
    if (!def.openFront) frontOpen.push({ x: doorX, w: doorW, y0: 0, y1: doorH });
    const winY0 = 1.05, winY1 = 1.85;
    if (!def.openFront && def.w > 5) frontOpen.push({ x: def.w * 0.25, w: 0.8, y0: winY0, y1: winY1 });
    if (def.id === 'tavern') frontOpen.push({ x: def.w * 0.4, w: 0.8, y0: winY0, y1: winY1 });
    const sideOpen: Opening[] = def.d > 4.5 ? [{ x: 0, w: 0.7, y0: winY0, y1: winY1 }] : [];
    const backOpen: Opening[] = def.w > 6 ? [{ x: -def.w * 0.2, w: 0.7, y0: winY0, y1: winY1 }] : [];
    if (def.id === 'church') {
      sideOpen.length = 0;
      for (let i = -1; i <= 1; i++) sideOpen.push({ x: i * 4, w: 0.6, y0: 2.8, y1: 4.6 });
    }

    const wallPieces = (len: number, openings: Opening[]): { x: number; w: number; y0: number; y1: number }[] => {
      const pieces: { x: number; w: number; y0: number; y1: number }[] = [];
      const sorted = [...openings].sort((a, b) => a.x - b.x);
      let cursor = -len / 2;
      for (const o of sorted) {
        const l = o.x - o.w / 2;
        if (l > cursor) pieces.push({ x: (cursor + l) / 2, w: l - cursor, y0: 0, y1: H });
        if (o.y0 > 0) pieces.push({ x: o.x, w: o.w, y0: 0, y1: o.y0 });
        if (o.y1 < H) pieces.push({ x: o.x, w: o.w, y0: o.y1, y1: H });
        cursor = o.x + o.w / 2;
      }
      if (cursor < len / 2) pieces.push({ x: (cursor + len / 2) / 2, w: len / 2 - cursor, y0: 0, y1: H });
      return pieces;
    };

    const addWall = (len: number, openings: Opening[], place: (px: number, py: number, pw: number, ph: number) => void) => {
      for (const p of wallPieces(len, openings)) place(p.x, (p.y0 + p.y1) / 2, p.w, p.y1 - p.y0);
    };
    // Frente (+Z), fondo (-Z), izquierda (-X), derecha (+X).
    if (!def.openFront) {
      addWall(def.w, frontOpen, (px, py, pw, ph) => solid(pw, ph, WALL_T, px, py, hd - WALL_T / 2, wallMat));
    }
    addWall(def.w, backOpen, (px, py, pw, ph) => solid(pw, ph, WALL_T, px, py, -hd + WALL_T / 2, wallMat));
    addWall(def.d - WALL_T * 2, sideOpen, (px, py, pw, ph) => solid(WALL_T, ph, pw, -hw + WALL_T / 2, py, px, wallMat));
    addWall(def.d - WALL_T * 2, style === 'shed' ? [] : sideOpen, (px, py, pw, ph) => solid(WALL_T, ph, pw, hw - WALL_T / 2, py, px, wallMat));

    // Postes y vigas (entramado/cobertizo/zarzo).
    if (style !== 'stone') {
      const post = 0.22;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(post, H, post, sx * (hw - post / 2 + 0.03), H / 2, sz * (hd - post / 2 + 0.03), 'beam');
      if (style === 'timber') {
        // Vigas horizontales y riostras.
        for (const sz of [-1, 1]) {
          box(def.w, 0.18, 0.08, 0, H - 0.09, sz * (hd + 0.02), 'beam');
          box(def.w, 0.16, 0.08, 0, 1.0, sz * (hd + 0.02), 'beam');
          for (let i = -1; i <= 1; i += 2) box(0.14, 1.4, 0.08, i * def.w * 0.36, 1.75, sz * (hd + 0.02), 'beam', 0, i * 0.55);
        }
        for (const sx of [-1, 1]) {
          box(0.08, 0.18, def.d, sx * (hw + 0.02), H - 0.09, 0, 'beam');
          box(0.08, 0.16, def.d, sx * (hw + 0.02), 1.0, 0, 'beam');
        }
      }
      if (def.openFront) {
        for (let i = -1; i <= 1; i++) solid(post, H, post, i * (hw - 0.15), H / 2, hd - 0.1, 'beam');
        box(def.w, 0.25, 0.25, 0, H - 0.12, hd - 0.1, 'beam');
      }
    } else {
      // Sillares en esquinas.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.4, H, 0.4, sx * (hw - 0.15), H / 2, sz * (hd - 0.15), 'stoneWall');
    }

    // Tejado a dos aguas con cumbrera paralela a la fachada (eje X).
    const pitch = def.roof === 'thatch' ? 0.8 : def.roof === 'tile' ? 0.52 : 0.45;
    const over = def.roof === 'thatch' ? 0.6 : 0.45;
    const run = hd + over;
    const rise = run * Math.tan(pitch);
    const slabLen = run / Math.cos(pitch);
    const roofT = def.roof === 'thatch' ? 0.35 : 0.15;
    const roofMat: MatId = def.roof === 'thatch' ? 'thatch' : def.roof === 'tile' ? 'tiles' : 'planks';
    const roofParts: Part[] = [];
    const roofBox = (w: number, h: number, d: number, x: number, y: number, z: number, rotX: number) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, 0)), new THREE.Vector3(1, 1, 1));
      roofParts.push({ geo: worldBox(w, h, d, 2), mat: roofMat, m });
    };
    const eaveY = H - over * Math.tan(pitch) * 0.5;
    const ridgeY = eaveY + rise;
    for (const s of [-1, 1]) {
      // Losa inclinada: centro a mitad del faldón.
      roofBox(def.w + over * 2, roofT, slabLen, 0, eaveY + rise / 2 + roofT / 2, (s * run) / 2, s * pitch);
    }
    // Hastiales (triángulos) en los lados.
    const gable = new THREE.BufferGeometry();
    const gy0 = H, gy1 = ridgeY - 0.05, gz = hd;
    const gv = new Float32Array([0, gy0, -gz, 0, gy0, gz, 0, gy1, 0]);
    gable.setAttribute('position', new THREE.BufferAttribute(gv, 3));
    gable.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, gz, 0, gz / 2, (gy1 - gy0) / 2]), 2));
    gable.setIndex([0, 1, 2, 0, 2, 1]);
    gable.computeVertexNormals();
    for (const s of [-1, 1]) {
      const m = new THREE.Matrix4().makeTranslation(s * (hw - WALL_T / 2), 0, 0);
      const g = gable.clone();
      parts.push({ geo: g, mat: wallMat, m });
      // Cerramiento de hastial también para colisión no hace falta (inalcanzable).
    }
    if (def.openFront) {
      // Frontón sobre la fachada abierta: nada; el tejado cubre.
    }

    // Chimenea.
    if (def.hasChimney) {
      const cx = hw * 0.55, cz = -hd * 0.3;
      const ch = ridgeY + 0.9;
      box(0.7, ch, 0.7, cx, ch / 2, cz, 'stoneWall');
      (this as { chimneyTop: THREE.Vector3 | null }).chimneyTop = new THREE.Vector3(cx, ch + 0.2, cz);
    }

    // Torre (iglesia): campanario sobre la fachada izquierda.
    if (def.tower) {
      const tw = 3.2, th = H + 7;
      const tx = -hw + tw / 2 - 0.4, tz = hd - tw / 2 + 0.6;
      solid(tw, th, tw, tx, th / 2, tz, 'stoneWall');
      box(tw + 0.4, 0.3, tw + 0.4, tx, th + 0.15, tz, 'stoneWall');
      // Arcos del campanario (4 pilares) y tejadillo.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.5, 2.2, 0.5, tx + sx * (tw / 2 - 0.25), th + 1.4, tz + sz * (tw / 2 - 0.25), 'stoneWall');
      const cap = new THREE.ConeGeometry(tw * 0.8, 2.4, 4);
      cap.rotateY(Math.PI / 4);
      parts.push({ geo: cap, mat: 'tiles', m: new THREE.Matrix4().makeTranslation(tx, th + 3.7, tz) });
      const bell = new THREE.CylinderGeometry(0.25, 0.45, 0.7, 10, 1, true);
      parts.push({ geo: bell, mat: 'iron', m: new THREE.Matrix4().makeTranslation(tx, th + 1.6, tz) });
      (this as { bellPos: THREE.Vector3 | null }).bellPos = new THREE.Vector3(tx, th + 1.6, tz);
    }

    // Contraventanas y alféizares (visual).
    const addWindowDeco = (x: number, z: number, rot: number, w: number, y0: number, y1: number) => {
      box(w + 0.2, 0.08, 0.2, x, y0 - 0.04, z, 'darkWood', 0, 0, rot);
      box(w + 0.2, 0.08, 0.12, x, y1 + 0.04, z, 'darkWood', 0, 0, rot);
    };
    const glowGeos: THREE.BufferGeometry[] = [];
    const addGlow = (x: number, z: number, rot: number, w: number, y0: number, y1: number) => {
      const g = new THREE.PlaneGeometry(w, y1 - y0);
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, (y0 + y1) / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1)));
      glowGeos.push(g);
    };
    for (const o of frontOpen) if (o.y0 > 0) { addWindowDeco(o.x, hd, 0, o.w, o.y0, o.y1); addGlow(o.x, hd - WALL_T / 2, 0, o.w, o.y0, o.y1); }
    for (const o of backOpen) { addWindowDeco(o.x, -hd, Math.PI, o.w, o.y0, o.y1); addGlow(o.x, -hd + WALL_T / 2, Math.PI, o.w, o.y0, o.y1); }
    for (const o of sideOpen) {
      addWindowDeco(-hw, o.x, -Math.PI / 2, o.w, o.y0, o.y1); addGlow(-hw + WALL_T / 2, o.x, -Math.PI / 2, o.w, o.y0, o.y1);
      if (style !== 'shed') { addWindowDeco(hw, o.x, Math.PI / 2, o.w, o.y0, o.y1); addGlow(hw - WALL_T / 2, o.x, Math.PI / 2, o.w, o.y0, o.y1); }
    }

    // Fusionar por material.
    const byMat = new Map<MatId, THREE.BufferGeometry[]>();
    for (const p of parts) {
      const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo).applyMatrix4(p.m);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!byMat.has(p.mat)) byMat.set(p.mat, []);
      byMat.get(p.mat)!.push(g);
    }
    for (const [mid, geos] of byMat) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats.get(mid));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.healthyMeshes.push(mesh);
    }
    {
      const geos = roofParts.map((p) => p.geo.toNonIndexed().applyMatrix4(p.m));
      const merged = mergeGeometries(geos)!;
      this.roofMesh = new THREE.Mesh(merged, mats.get(roofMat));
      this.roofMesh.castShadow = true;
      this.roofMesh.receiveShadow = true;
      this.group.add(this.roofMesh);
      // Versión quemada (se muestra al estar dañado).
      this.charredMesh = new THREE.Mesh(merged, mats.get('charred'));
      this.charredMesh.visible = false;
      this.charredMesh.scale.set(0.7, 0.9, 0.6);
      this.group.add(this.charredMesh);
    }
    if (glowGeos.length) {
      const glow = new THREE.Mesh(mergeGeometries(glowGeos)!, this.windowMat);
      this.group.add(glow);
    }

    this.group.updateMatrixWorld(true);

    // Colliders: un cuerpo fijo con colliders por pieza.
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(def.x, this.floorY, def.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY)),
    );
    for (const c of colliders) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.rx ?? 0, 0, c.rz ?? 0));
      const col = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z).setRotation(q)
          .setCollisionGroups(groups(GROUP.STATIC, ALL)),
        this.body,
      );
      physics.tag(col, { kind: 'building', id: def.id });
    }

    // Puerta con bisagra.
    if (!def.openFront) {
      this.createDoor(mats, doorX, hd - WALL_T / 2, doorW, doorH, def.enterable === false);
    }

    const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(this.group.matrixWorld);
    this.interiorLight = toWorld(0, H * 0.7, -hd * 0.2);
    this.firePoints.push(toWorld(0, ridgeY - 0.5, 0), toWorld(hw * 0.5, H, hd * 0.3), toWorld(-hw * 0.5, H, -hd * 0.3));
    if (this.chimneyTop) this.chimneyTop.applyMatrix4(this.group.matrixWorld);
    if (this.bellPos) this.bellPos.applyMatrix4(this.group.matrixWorld);
  }

  private createDoor(mats: MaterialLibrary, x: number, z: number, w: number, h: number, locked: boolean): void {
    const pivot = new THREE.Object3D();
    pivot.position.set(x - w / 2, 0, z);
    this.group.add(pivot);
    const leaf = new THREE.Mesh(worldBox(w - 0.04, h - 0.03, 0.07, 1.2), mats.get('darkWood'));
    leaf.position.set(w / 2, h / 2, 0);
    leaf.castShadow = true;
    pivot.add(leaf);
    // Herrajes.
    for (const y of [0.4, h - 0.4]) {
      const band = new THREE.Mesh(worldBox(w * 0.8, 0.06, 0.09, 1), mats.get('iron'));
      band.position.set(w * 0.42, y, 0);
      pivot.add(band);
    }
    this.group.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
    pivot.getWorldPosition(wp);
    pivot.getWorldQuaternion(wq);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(wp.x, wp.y, wp.z).setRotation(wq),
    );
    const col = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid((w - 0.04) / 2, h / 2, 0.05).setTranslation(w / 2, h / 2, 0)
        .setCollisionGroups(groups(GROUP.STATIC, ALL)),
      body,
    );
    const id = `door:${this.def.id}`;
    this.physics.tag(col, { kind: 'door', id });
    const center = new THREE.Vector3(x, 1, z).applyMatrix4(this.group.matrixWorld);
    const outside = new THREE.Vector3(x, 0, z + 1.2).applyMatrix4(this.group.matrixWorld);
    const inside = new THREE.Vector3(x, 0, z - 1.3).applyMatrix4(this.group.matrixWorld);
    this.doors.push({ id, buildingId: this.def.id, pivot, body, open: false, angle: 0, locked, swing: -1, worldPos: center, outside, inside, width: w });
  }

  /** Animación de puertas (llamar cada tick). */
  updateDoors(dt: number): void {
    for (const d of this.doors) {
      const target = d.open ? d.swing * 1.75 : 0;
      if (Math.abs(d.angle - target) < 0.001) continue;
      const step = 3.2 * dt;
      d.angle += Math.max(-step, Math.min(step, target - d.angle));
      d.pivot.rotation.y = d.angle;
      d.pivot.updateMatrixWorld(true);
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
      d.pivot.getWorldPosition(wp);
      d.pivot.getWorldQuaternion(wq);
      d.body.setNextKinematicTranslation(wp);
      d.body.setNextKinematicRotation(wq);
    }
  }

  get damaged(): boolean {
    return this.health < this.def.maxHealth * 0.5;
  }

  setHealth(h: number): void {
    this.health = Math.max(0, Math.min(this.def.maxHealth, h));
    const dmg = this.damaged;
    if (this.roofMesh) this.roofMesh.visible = !dmg;
    if (this.charredMesh) this.charredMesh.visible = dmg;
  }

  /** Posición mundial de un punto local. */
  localToWorld(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.group.matrixWorld);
  }

  /** Rectángulo de navegación (mundo) inflado. */
  footprint(inflate = 0.8): { x: number; z: number; hw: number; hd: number; rot: number } {
    return { x: this.def.x, z: this.def.z, hw: this.def.w / 2 + inflate, hd: this.def.d / 2 + inflate, rot: this.rotY };
  }

  /** ¿Está el punto dentro del edificio? */
  contains(x: number, z: number, margin = 0): boolean {
    const l = toLocalXZ(x - this.def.x, z - this.def.z, this.rotY);
    return Math.abs(l.x) < this.def.w / 2 - margin && Math.abs(l.z) < this.def.d / 2 - margin;
  }
}
