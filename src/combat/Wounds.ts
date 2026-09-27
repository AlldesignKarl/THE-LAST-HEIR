/**
 * Heridas graves en personas (vecinos, guardias, bandidos) causadas por el
 * jugador con armas de filo o punta:
 *  - cabeza (hacha, espada, o cuchillo con golpe fuerte): decapitación;
 *    con el cuchillo en golpe ligero, degüello (muere en segundos);
 *  - brazo: se cercena; cae de rodillas apretándose el muñón y se desangra;
 *  - pierna: se cercena; cae al suelo y se desangra;
 *  - torso: cae al suelo herido de muerte y se desangra.
 * El miembro cortado es un cuerpo físico (rueda, se puede agarrar y
 * arrastrar), el muñón gotea y bajo el herido crece un charco de sangre.
 * Las armas contundentes (maza, puños) siguen con el modelo de daño normal.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Character } from '../ai/Character';
import type { Limb } from '../actors/HumanoidModel';
import type { WeaponDef } from './WeaponDefs';
import { RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import { woundCap } from '../actors/WoundMesh';

interface Piece { body: RAPIER.RigidBody; mesh: THREE.Object3D; t: number; emitter: string }
interface Pool { mesh: THREE.Mesh; target: number; grow: number; owner: Character | null }
interface Bleeder { c: Character; limb: Limb | null; emitter: string; neck?: boolean; t?: number; base?: number }

const MAX_PIECES = 24;
/** Salpicaduras: sangre oscura y húmeda (casi negra sobre la tierra). */
const SPLAT = new THREE.MeshStandardMaterial({ color: 0x220202, roughness: 0.25, metalness: 0, envMapIntensity: 0.5, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
const MAX_POOLS = 70;
const BLOOD = new THREE.MeshStandardMaterial({ color: 0x2c0202, roughness: 0.4, metalness: 0, envMapIntensity: 0.25, transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false, side: THREE.DoubleSide });

let seq = 0;

export class Wounds {
  private pieces: Piece[] = [];
  private pools: Pool[] = [];
  private bleeders: Bleeder[] = [];
  private group = new THREE.Group();

  constructor(private readonly g: Game) {
    g.renderer.scene.add(this.group);
  }

  /** Arma que corta o atraviesa (no contundente). */
  static cuts(w: WeaponDef): boolean {
    return w.type === 'slash' || w.id === 'knife' || w.id === 'spear' || w.id === 'pickaxe';
  }

  /**
   * Tras un golpe del jugador no bloqueado. `limb` es el miembro de la
   * hitbox tocada (o null en el torso).
   */
  onPlayerHit(c: Character, limb: Limb | null, w: WeaponDef, heavy: boolean, from: THREE.Vector3): void {
    if (!Wounds.cuts(w) || !c.model.hitboxes) return;
    const g = this.g;
    const away = new THREE.Vector3(c.pos.x - from.x, 0, c.pos.z - from.z).normalize();
    const canSever = w.type === 'slash' || (w.id === 'knife' && heavy) || w.id === 'pickaxe';
    if (limb === 'head') {
      if (canSever) {
        this.sever(c, 'head', away);
        if (c.alive) c.die('player');
        g.bus.emit('notify', { text: `Decapitas a ${c.name}.`, kind: 'alert' });
      } else {
        // Degüello con el cuchillo o estocada en la cara: muere en segundos.
        this.down(c, null, 'downed', c.health / 4);
      }
      return;
    }
    if (!c.alive) {
      // Ya muerto por el golpe: el miembro se corta igual.
      if (limb && canSever) this.sever(c, limb, away);
      this.pool(c, 0.7);
      return;
    }
    if (c.downed) {
      // Rematar a un herido o hacerle más sangre.
      if (limb && canSever) this.sever(c, limb, away);
      c.bleed *= 2.2;
      if (!limb) c.die('player');
      return;
    }
    if (limb && canSever) {
      this.sever(c, limb, away);
      // Sin un brazo sigue de rodillas; sin una pierna cae.
      this.down(c, limb, limb.startsWith('arm') ? 'kneel' : 'downed', c.health / (22 + Math.random() * 10));
      g.bus.emit('notify', { text: `Le cortas ${limb.startsWith('arm') ? 'el brazo' : 'la pierna'} a ${c.name}. Se desangra.`, kind: 'alert' });
    } else {
      // Tajo o estocada profunda: cae herido de muerte.
      this.down(c, null, limb?.startsWith('arm') ? 'kneel' : 'downed', c.health / (26 + Math.random() * 12));
      g.bus.emit('notify', { text: `${c.name} cae herido de muerte.`, kind: 'alert' });
    }
  }

  /** Deja a alguien en el suelo desangrándose. */
  down(c: Character, limb: Limb | null, anim: 'kneel' | 'downed', bleedPerSec: number): void {
    const g = this.g;
    if (!c.alive) return;
    c.downed = true;
    c.indoors = false; // si le has alcanzado, está a la vista
    c.bleed = Math.max(c.bleed, bleedPerSec);
    c.woundAnim = anim;
    c.stop();
    c.phase = 'none';
    c.blocking = false;
    // Suelta el arma.
    if (c.weapon.id !== 'fists' && c.weapon.model) {
      const hand = c.model.handR.getWorldPosition(new THREE.Vector3());
      const itemId = c.weapon.id;
      c.setWeapon(null);
      g.worldItems.spawn(itemId, hand.x, Math.max(hand.y, c.pos.y + 0.3), hand.z, {});
    }
    g.bus.emit('sfx', { id: 'pain', x: c.pos.x, y: c.pos.y + 1.2, z: c.pos.z });
    this.pool(c, anim === 'kneel' ? 0.55 : 0.9);
    const emitter = `bleed_${c.id}_${seq++}`;
    g.particles.addEmitter({ id: emitter, kind: 'blood', pos: c.pos.clone(), rate: 16, spread: 0.08, vel: new THREE.Vector3(0, -0.4, 0), sizeMul: 0.6, enabled: true });
    this.bleeders.push({ c, limb, emitter });
  }

  /**
   * Degüello (remate por la espalda): chorro arterial hacia delante, la
   * herida del cuello mana mientras cae y queda un charco grande.
   */
  throatCut(c: Character, dir: { x: number; y: number; z: number }): void {
    const g = this.g;
    const n = c.model.neckWorld(new THREE.Vector3());
    g.particles.burst('blood', n.x, n.y, n.z, 55, 3.2, dir, 1.1);
    g.particles.burst('blood', n.x, n.y, n.z, 25, 1.4, { x: dir.x * 0.4, y: -0.6, z: dir.z * 0.4 }, 0.8);
    const emitter = `throat_${c.id}_${seq++}`;
    g.particles.addEmitter({ id: emitter, kind: 'blood', pos: n.clone(), rate: 45, spread: 0.05, vel: new THREE.Vector3(dir.x * 1.2, -0.3, dir.z * 1.2), sizeMul: 0.75, enabled: true });
    this.bleeders.push({ c, limb: null, emitter, neck: true, t: 0, base: 45 });
    this.splatter(n, new THREE.Vector3(dir.x, 0, dir.z).normalize(), 7);
    this.pool(c, 1.1);
  }

  /** Cercena un miembro: muñón en el cuerpo y el miembro como objeto físico. */
  sever(c: Character, limb: Limb, away: THREE.Vector3): void {
    const g = this.g;
    const m = c.model;
    if (m.severed.has(limb)) return;
    m.root.updateMatrixWorld(true);
    const boneOf = { head: 'head', armL: 'shL', armR: 'shR', legL: 'hipL', legR: 'hipR' } as const;
    const bone = (m as unknown as Record<string, THREE.Bone>)[boneOf[limb]];
    const start = bone.getWorldPosition(new THREE.Vector3());
    const q = bone.getWorldQuaternion(new THREE.Quaternion());
    if (limb === 'armR' && c.weapon.id !== 'fists') {
      const itemId = c.weapon.id;
      c.setWeapon(null);
      g.worldItems.spawn(itemId, start.x, start.y, start.z, {});
    }
    m.sever(limb);
    const piece = this.buildLimb(c, limb);
    // El miembro cuelga del hueso hacia abajo (-Y local): centro a media longitud.
    const half = limb === 'head' ? 0 : limb.startsWith('arm') ? 0.29 : 0.46;
    const center = new THREE.Vector3(0, limb === 'head' ? 0.1 : -half, 0).applyQuaternion(q).add(start);
    const body = g.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(center.x, center.y, center.z).setRotation(q).setCcdEnabled(true).setLinearDamping(0.3).setAngularDamping(0.8),
    );
    const cd = limb === 'head'
      ? RAPIER.ColliderDesc.ball(0.12).setMass(4.5)
      : RAPIER.ColliderDesc.capsule(half - 0.06, limb.startsWith('arm') ? 0.055 : 0.08).setMass(limb.startsWith('arm') ? 3.5 : 10);
    const col = g.physics.world.createCollider(cd.setFriction(0.9).setRestitution(0.05).setCollisionGroups(groups(GROUP.PROP, ALL)), body);
    g.physics.tag(col, { kind: 'prop', id: `severed_${limb.startsWith('arm') ? 'arm' : limb.startsWith('leg') ? 'leg' : 'head'}` });
    body.setLinvel({ x: away.x * 2.2 + (Math.random() - 0.5), y: limb === 'head' ? 2.6 : 1.2, z: away.z * 2.2 + (Math.random() - 0.5) }, true);
    body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 8 }, true);
    this.group.add(piece);
    const emitter = `sev_${c.id}_${seq++}`;
    g.particles.addEmitter({ id: emitter, kind: 'blood', pos: center.clone(), rate: 22, spread: 0.05, vel: new THREE.Vector3(0, -0.3, 0), sizeMul: 0.55, enabled: true });
    this.pieces.push({ body, mesh: piece, t: 0, emitter });
    while (this.pieces.length > MAX_PIECES) this.removePiece(this.pieces[0]);
    // Chorro de sangre en el corte y salpicaduras en el suelo.
    g.particles.burst('blood', start.x, start.y, start.z, 40, 3.5, { x: away.x, y: 0.6, z: away.z }, 1.2);
    this.splatter(start, away, limb === 'head' ? 9 : 6);
    g.bus.emit('sfx', { id: 'hit_flesh', x: start.x, y: start.y, z: start.z, volume: 1 });
    // Goteo del muñón mientras siga con vida.
    if (c.alive) {
      const e2 = `stump_${c.id}_${limb}_${seq++}`;
      g.particles.addEmitter({ id: e2, kind: 'blood', pos: start.clone(), rate: 30, spread: 0.04, vel: new THREE.Vector3(away.x * 0.6, -0.2, away.z * 0.6), sizeMul: 0.7, enabled: true });
      this.bleeders.push({ c, limb, emitter: e2, t: 0, base: 30 });
    }
    this.pool(c, 0.8);
  }

  /** Pieza visible del miembro cortado, con la ropa y la piel de esa persona. */
  private buildLimb(c: Character, limb: Limb): THREE.Object3D {
    const app = c.model.app;
    const mat = (color: number, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, rx = 0) => { const me = new THREE.Mesh(geo, m); me.position.y = y; me.rotation.x = rx; me.castShadow = true; g.add(me); return me; };
    if (limb === 'head') {
      add(new THREE.SphereGeometry(0.105, 14, 10), mat(app.skin, 0.6), 0.02).scale.set(0.9, 1.08, 0.98);
      add(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(app.hair, 0.9), 0.045).scale.set(0.95, 1.02, 1.02);
      if (app.beard) add(new THREE.SphereGeometry(0.07, 10, 6), mat(app.hair, 0.95), -0.05).scale.set(1.1, 0.8, 0.8);
      for (const sx of [-1, 1]) { const e = add(new THREE.SphereGeometry(0.012, 6, 4), mat(0x1a1410, 0.4), 0.035); e.position.set(sx * 0.035, 0.035, 0.092); }
      add(new THREE.CylinderGeometry(0.05, 0.052, 0.07, 10), mat(app.skin, 0.6), -0.1);
      // Cara: nariz, orejas, párpados caídos y boca entreabierta.
      add(new THREE.BoxGeometry(0.02, 0.045, 0.03), mat(app.skin, 0.6), 0.01).position.set(0, 0.01, 0.105);
      for (const sx of [-1, 1]) {
        add(new THREE.SphereGeometry(0.02, 6, 4), mat(app.skin, 0.6), 0.02).position.set(sx * 0.095, 0.02, 0);
        add(new THREE.BoxGeometry(0.03, 0.008, 0.01), mat(new THREE.Color(app.skin).multiplyScalar(0.8).getHex(), 0.6), 0.03).position.set(sx * 0.035, 0.032, 0.096);
      }
      add(new THREE.BoxGeometry(0.035, 0.012, 0.01), mat(0x2a0a08, 0.5), -0.03).position.set(0, -0.035, 0.094);
      // Corte del cuello (hacia abajo).
      const cap = woundCap(0.052, true);
      cap.rotation.x = Math.PI;
      cap.position.y = -0.136;
      g.add(cap);
      return g;
    }
    const arm = limb.startsWith('arm');
    const len = arm ? 0.58 : 0.92;
    const r = arm ? 0.05 : 0.075;
    const cloth = arm ? app.tunic : app.pants;
    // Parte alta vestida, parte baja piel (brazo) o calzón (pierna).
    add(new THREE.CylinderGeometry(r * 1.1, r, len * 0.52, 10), mat(cloth), len * 0.24);
    add(new THREE.CylinderGeometry(r * 0.95, r * 0.8, len * 0.48, 10), mat(arm ? app.skin : cloth, arm ? 0.6 : 0.85), -len * 0.25);
    if (arm) add(new THREE.SphereGeometry(r * 0.95, 8, 6), mat(app.skin, 0.6), -len * 0.5).scale.set(0.9, 1.2, 0.6);
    else add(new THREE.BoxGeometry(0.1, 0.07, 0.24), mat(0x2a1c12, 0.7), -len * 0.5).position.z = 0.05;
    const cap = woundCap(r * 1.08);
    cap.position.y = len * 0.5;
    g.add(cap);
    return g;
  }

  /**
   * Salpicaduras: manchas pequeñas e irregulares en el suelo, en la
   * dirección del chorro, a distancias distintas.
   */
  splatter(from: THREE.Vector3, dir: THREE.Vector3, n: number): void {
    const g = this.g;
    for (let i = 0; i < n; i++) {
      const d = 0.3 + Math.random() * 1.9;
      const side = (Math.random() - 0.5) * 0.9;
      const x = from.x + dir.x * d - dir.z * side, z = from.z + dir.z * d + dir.x * side;
      const t = g.hf.heightAt(x, z);
      const floor = g.worldItems.groundAt?.(x, from.y, z) ?? t;
      const y = (Math.abs(floor - t) < 0.05 ? Math.max(t, g.hf.heightAt(x + 0.1, z), g.hf.heightAt(x, z + 0.1)) : floor) + 0.015;
      const mesh = new THREE.Mesh(this.splatGeometry(), SPLAT);
      const r = 0.02 + Math.random() * 0.07;
      mesh.position.set(x, y, z);
      mesh.rotation.y = Math.random() * 6;
      mesh.scale.set(r * (1 + Math.random() * 0.8), 1, r);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      (mesh.geometry as unknown as { userData: { y: number } }).userData = { y };
      this.pools.push({ mesh, target: 0, grow: 0, owner: null });
    }
    while (this.pools.length > MAX_POOLS) { const old = this.pools.shift()!; this.group.remove(old.mesh); old.mesh.geometry.dispose(); }
  }

  private splatGeometry(): THREE.BufferGeometry {
    const seg = 10;
    const pos: number[] = [0, 0, 0];
    const idx: number[] = [];
    const ph = Math.random() * 6;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const r = 1 + 0.35 * Math.sin(a * 3 + ph) + 0.2 * Math.sin(a * 7 + ph * 2);
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      idx.push(0, 1 + ((i + 1) % seg), 1 + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3));
    geo.setIndex(idx);
    return geo;
  }

  /** Charco de sangre bajo alguien (crece despacio). */
  private pool(c: Character, radius: number): void {
    const g = this.g;
    for (const p of this.pools) if (p.owner === c) { p.target = Math.max(p.target, radius * 1.25); return; }
    const mesh = new THREE.Mesh(this.poolGeometry(c), BLOOD);
    mesh.position.set(c.pos.x, 0, c.pos.z);
    mesh.scale.set(0.05, 1, 0.05);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.pools.push({ mesh, target: radius * 0.75, grow: 0.05, owner: c });
    while (this.pools.length > MAX_POOLS) { const old = this.pools.shift()!; this.group.remove(old.mesh); old.mesh.geometry.dispose(); }
    void g;
  }

  /**
   * Charco irregular que se amolda al terreno (radio 1, se escala en XZ):
   * cada vértice toma la altura del suelo bajo el radio máximo previsto.
   */
  private poolGeometry(c: Character): THREE.BufferGeometry {
    const g = this.g;
    const seg = 22, rMax = 1.0;
    const pos: number[] = [0, 0, 0];
    const idx: number[] = [];
    const flatY = this.groundY(c);
    const onTerrain = Math.abs(flatY - g.hf.heightAt(c.pos.x, c.pos.z)) < 0.05;
    const ph = Math.random() * 6;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const r = 1 + 0.18 * Math.sin(a * 3 + ph) + 0.1 * Math.sin(a * 5 + ph * 2);
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      idx.push(0, 1 + ((i + 1) % seg), 1 + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    // Altura: el máximo del terreno en el radio (no se hunde en las lomas).
    let y = flatY;
    if (onTerrain) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; y = Math.max(y, g.hf.heightAt(c.pos.x + Math.cos(a) * rMax * 0.8, c.pos.z + Math.sin(a) * rMax * 0.8)); }
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3));
    (geo as unknown as { userData: { y: number } }).userData = { y: y + 0.02 };
    return geo;
  }

  private groundY(c: Character): number {
    const g = this.g;
    const t = g.hf.heightAt(c.pos.x, c.pos.z);
    return Math.abs(c.pos.y - t) < 0.5 ? Math.max(t, c.pos.y) : c.pos.y;
  }

  private removePiece(p: Piece): void {
    this.g.physics.removeBody(p.body);
    this.group.remove(p.mesh);
    this.g.particles.removeEmitter(p.emitter);
    this.pieces.splice(this.pieces.indexOf(p), 1);
  }

  /** Cada tick de lógica. */
  update(dt: number): void {
    const g = this.g;
    for (const p of this.pieces) {
      p.t += dt;
      const t = p.body.translation(), r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      const em = g.particles.emitters.get(p.emitter);
      if (em) { em.pos.set(t.x, t.y, t.z); em.enabled = p.t < 5; }
    }
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const b = this.bleeders[i];
      const em = g.particles.emitters.get(b.emitter);
      if (!em) { this.bleeders.splice(i, 1); continue; }
      const stump = b.limb ? b.c.model.stumps.get(b.limb) : null;
      if (stump) stump.getWorldPosition(em.pos);
      else if (b.neck) b.c.model.neckWorld(em.pos);
      else em.pos.set(b.c.pos.x, b.c.pos.y + 0.35, b.c.pos.z);
      // Muerto: deja de manar poco a poco.
      if (!b.c.alive) { em.rate *= Math.pow(0.5, dt); if (em.rate < 1) { g.particles.removeEmitter(b.emitter); this.bleeders.splice(i, 1); } }
      else {
        em.enabled = b.c.visible && !b.c.indoors;
        // Mana a borbotones, al ritmo del corazón (cada vez más débil).
        if (b.base !== undefined) {
          b.t = (b.t ?? 0) + dt;
          const beat = Math.pow(Math.max(0, Math.sin(b.t * 7.2)), 6);
          const weak = Math.max(0.3, 1 - b.t / 40);
          em.rate = b.base * weak * (0.25 + 1.8 * beat);
          if (stump) {
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(stump.getWorldQuaternion(new THREE.Quaternion()));
            em.vel.copy(up).multiplyScalar(0.3 + beat * 1.6 * weak);
            em.vel.y -= 0.2;
          }
        }
      }
    }
    for (const p of this.pools) {
      const s = p.mesh.scale.x;
      if (s < p.target) { const ns = Math.min(p.target, s + dt * (p.owner?.alive && p.owner.downed ? 0.025 : 0.08)); p.mesh.scale.set(ns, 1, ns); }
      p.mesh.position.y = (p.mesh.geometry as unknown as { userData: { y: number } }).userData.y;
    }
  }

  /** Recoge charcos y restos al dormir o pasar el tiempo (se limpian o se entierran). */
  clear(): void {
    for (const p of [...this.pieces]) this.removePiece(p);
    for (const p of this.pools) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); }
    this.pools = [];
    for (const b of this.bleeders) this.g.particles.removeEmitter(b.emitter);
    this.bleeders = [];
  }
}
