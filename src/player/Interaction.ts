/**
 * Interacción en primera persona (ADR-009):
 *  E  → usar / recoger (con animación de mano: el objeto vuela a la mano)
 *  R  → agarrar y transportar objetos físicos (soltar con R, lanzar con clic)
 * Los objetos ajenos cogidos a la vista de alguien cuentan como robo.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import type { WorldItem } from '../items/WorldItems';
import { itemDef } from '../data/items';
import type { Interactable } from '../world/Interactables';
import type { Character } from '../ai/Character';
import { dragGround } from '../social/Bodies';

export interface Carried {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mass: number;
  item: WorldItem | null;
  propId: string | null;
  holdDist: number;
  prevGroups: number;
  /** Radio aproximado del objeto (para no hundirlo en paredes). */
  radius: number;
}

export interface FocusTarget {
  kind: 'item' | 'prop' | 'interactable' | 'water' | 'takedown' | 'none';
  text: string;
  sub?: string;
  item?: WorldItem;
  inter?: Interactable;
  body?: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
  point?: THREE.Vector3;
  /** Cuerpo (muerto o moribundo) que se puede arrastrar. */
  corpse?: Character;
}

const REACH = 3.0;
const tmpF = new THREE.Vector3();
const tmpE = new THREE.Vector3();

export class Interaction {
  focus: FocusTarget = { kind: 'none', text: '' };
  carried: Carried | null = null;
  /** Cuerpo que se lleva al hombro. */
  dragging: Character | null = null;
  private carryT = 0;
  private pickFrom = new THREE.Vector3();
  /** Dejando el cuerpo en el suelo (animación de bajarlo del hombro). */
  private lowering: { c: Character; t: number; fromPos: THREE.Vector3; fromQ: THREE.Quaternion; toPos: THREE.Vector3; toQ: THREE.Quaternion; yaw: number } | null = null;

  constructor(private readonly g: Game) {}

  update(dt: number): void {
    const g = this.g;
    const p = g.player;
    p.eyePosition(1, tmpE);
    p.forward(tmpF);
    this.updateFocus(tmpE, tmpF);

    const inp = g.input;
    if (this.lowering) { this.updateLowering(dt); return; }
    if (this.dragging) {
      this.updateCarryBody(dt);
      if (this.carryT > 0.8 && (inp.wasPressed('grab') || inp.wasPressed('interact'))) this.releaseDrag();
      return;
    }
    if (this.carried) {
      this.updateCarry(dt, tmpE, tmpF);
      if (inp.wasPressed('grab')) this.drop(false);
      else if (inp.wasPressed('attack')) this.drop(true);
      else if (inp.wasPressed('interact') && this.carried?.item) {
        const wi = this.carried.item;
        this.drop(false);
        this.collect(wi);
      }
      return;
    }
    if (inp.wasPressed('interact')) this.useFocus();
    else if (inp.wasPressed('grab')) this.tryGrab();
  }

  private updateFocus(eye: THREE.Vector3, fwd: THREE.Vector3): void {
    const g = this.g;
    const hit = g.physics.raycast(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, 4, ALL & ~GROUP.PLAYER, g.player.collider);
    this.focus = { kind: 'none', text: '' };
    // Remate por la espalda: tiene prioridad sobre lo demás.
    const td = g.takedown?.candidate;
    if (td) {
      const touch = g.input.touchMode;
      this.focus = { kind: 'takedown', text: `${td.c.name} (de espaldas)`, sub: `${touch ? 'Remate' : '[G]'} ${td.kind === 'throat' ? 'Degollar' : 'Romper el cuello'}` };
      return;
    }
    if (hit) {
      const wi = g.worldItems.forCollider(hit.collider.handle);
      if (wi && hit.toi <= REACH) {
        const d = itemDef(wi.itemId);
        const owned = wi.owner ? ' (ajeno)' : '';
        const count = wi.count > 1 ? ` ×${wi.count}` : '';
        this.focus = {
          kind: 'item', item: wi,
          text: d.heavy ? `${d.name}${owned}` : `${d.name}${count}${owned}`,
          sub: d.heavy ? '[R] Agarrar (pesado)' : '[E] Coger   [R] Agarrar',
        };
        return;
      }
      const inter = g.interactables.forCollider(hit.collider.handle);
      if (inter && hit.toi <= (inter.range ?? REACH)) {
        const label = inter.label(g);
        if (label) {
          this.focus = { kind: 'interactable', inter, text: label, sub: '[E]' };
          return;
        }
      }
      const tag = g.physics.tagOf(hit.collider);
      // Edificio en llamas: apagar con un cubo de agua.
      if (tag?.kind === 'building' && hit.toi <= REACH + 1.5 && g.raids.burningBuilding(tag.id)) {
        const bid = tag.id;
        this.focus = {
          kind: 'interactable', text: `${g.settlement.buildings.get(bid)!.def.name} arde`,
          sub: g.inventory.has('bucket_water') ? '[E] Echar el cubo de agua' : 'Necesitas un cubo lleno (pozo)',
          inter: { id: `fire:${bid}`, kind: 'fire', pos: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), label: () => 'Apagar', interact: (game) => game.raids.douse(bid) },
        };
        return;
      }
      if (tag?.kind === 'prop' && hit.toi <= REACH) {
        const body = hit.collider.parent();
        if (body && body.isDynamic()) {
          const heavy = body.mass() > 60;
          this.focus = { kind: 'prop', body, collider: hit.collider, text: this.propName(tag.id), sub: heavy ? 'Demasiado pesado. Empújalo.' : '[R] Agarrar' };
          return;
        }
      }
      // Agua del arroyo.
      if ((tag?.kind === 'terrain') && hit.toi <= REACH + 0.5) {
        const lvl = g.hf.waterLevelAt(hit.point.x, hit.point.z);
        if (lvl !== null) {
          const sea = g.hf.isSeaWater(hit.point.x, hit.point.z);
          this.focus = { kind: 'water', text: sea ? 'Mar' : 'Arroyo', sub: sea ? 'Agua salada: no se puede beber' : '[E] Beber / llenar', point: new THREE.Vector3(hit.point.x, lvl, hit.point.z) };
          return;
        }
      }
    }
    // Cuerpos en el suelo delante (muertos o desangrándose): cargar.
    const corpse = this.dragging ? null : this.corpseInFront(fwd);
    if (corpse) {
      this.focus = { kind: 'interactable', corpse, text: corpse.alive ? `${corpse.name} (se desangra)` : `Cuerpo de ${corpse.name}`, sub: '[R] Cargar al hombro' };
      return;
    }
    // Agua: mirando hacia abajo estando dentro o al borde.
    const lvl = g.hf.waterLevelAt(g.player.pos.x + fwd.x, g.player.pos.z + fwd.z);
    if (lvl !== null && fwd.y < -0.35) {
      const sea = g.hf.isSeaWater(g.player.pos.x + fwd.x, g.player.pos.z + fwd.z);
      this.focus = { kind: 'water', text: sea ? 'Mar' : 'Arroyo', sub: sea ? 'Agua salada: no se puede beber' : '[E] Beber / llenar' };
    }
  }

  private propName(id: string): string {
    if (id.includes('barrel')) return 'Barril';
    if (id.includes('crate')) return 'Caja';
    if (id.includes('sack')) return 'Saco';
    if (id.includes('stool')) return 'Taburete';
    if (id === 'severed_arm') return 'Brazo cortado';
    if (id === 'severed_leg') return 'Pierna cortada';
    if (id === 'severed_head') return 'Cabeza';
    return 'Objeto';
  }

  private useFocus(): void {
    const f = this.focus;
    const g = this.g;
    if (f.kind === 'item' && f.item) {
      const d = itemDef(f.item.itemId);
      if (d.heavy) {
        g.bus.emit('notify', { text: 'Pesa demasiado para la bolsa. Agárralo con [R].', kind: 'info' });
        return;
      }
      this.collect(f.item);
    } else if (f.kind === 'interactable' && f.inter) {
      f.inter.interact(g);
    } else if (f.kind === 'water') {
      if (f.text === 'Mar') g.bus.emit('notify', { text: 'El agua del mar es salada: te daría más sed.', kind: 'warning' });
      else g.actions.useWater('arroyo');
    }
  }

  /** Recoge un objeto al inventario con animación de mano. */
  collect(wi: WorldItem): boolean {
    const g = this.g;
    const d = itemDef(wi.itemId);
    if (!g.inventory.canAdd(wi.itemId, wi.count)) {
      g.bus.emit('notify', { text: d.heavy ? 'Demasiado pesado para la bolsa.' : 'Llevas demasiado peso.', kind: 'warning' });
      return false;
    }
    if (wi.owner) {
      const witnessed = g.npcs ? g.npcs.witnessesCrime(g.player.pos) : false;
      g.bus.emit('item:stolen', { itemId: wi.itemId, ownerVillage: wi.owner, witnessed });
      if (witnessed) g.bus.emit('crime', { type: 'theft', village: wi.owner, witnessed: true });
    }
    g.viewmodel?.reach();
    g.player.eyePosition(1, g.worldItems.collectTarget);
    g.worldItems.collectTarget.addScaledVector(new THREE.Vector3(Math.sin(g.player.yaw + 0.6), 0, Math.cos(g.player.yaw + 0.6)), -0.3).y -= 0.45;
    g.worldItems.beginCollect(wi);
    const n = g.inventory.add(wi.itemId, wi.count);
    g.bus.emit('item:acquired', { itemId: wi.itemId, count: n, source: 'pickup' });
    g.bus.emit('sfx', { id: 'pickup' });
    g.bus.emit('notify', { text: `${d.name}${n > 1 ? ` ×${n}` : ''}`, kind: 'item' });
    // Auto-equipar la primera arma si las manos están vacías.
    if (d.weapon && !g.equipment.slots.main) g.equipment.equip(wi.itemId);
    return true;
  }

  private corpseInFront(fwd: THREE.Vector3): Character | null {
    const g = this.g;
    const p = g.player.pos;
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    let best: Character | null = null, bd = 2.4;
    const cands: Character[] = [];
    for (const n of g.npcs.npcs.values()) if ((!n.c.alive && !n.buried) || n.c.downed) cands.push(n.c);
    for (const r of g.raids.raiders) if (!r.c.alive || r.c.downed) cands.push(r.c);
    for (const c of cands) {
      if (!c.model.root.visible || c.hiddenBody) continue;
      // El cuerpo tendido ocupa de los pies a la cabeza: se toma el punto medio.
      const cx = c.pos.x - Math.sin(c.yaw) * 0.8, cz = c.pos.z - Math.cos(c.yaw) * 0.8;
      for (const [x, z] of [[c.pos.x, c.pos.z], [cx, cz]]) {
        const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
        if (d > bd || Math.abs(c.pos.y - p.y) > 1.5) continue;
        if (d > 0.6 && (dx * fwd.x + dz * fwd.z) / (d * fl) < 0.55) continue;
        best = c; bd = d;
      }
    }
    return best;
  }

  /** Cargar un cuerpo al hombro: agacharse, levantarlo y echárselo encima. */
  private startCarry(c: Character): void {
    const g = this.g;
    this.dragging = c;
    this.carryT = 0;
    c.model.setState('carried');
    g.bus.emit('sfx', { id: 'grab_heavy' });
    g.bus.emit('notify', { text: 'Te cargas el cuerpo al hombro. [R] para dejarlo. En agua honda se hunde.', kind: 'info' });
  }

  private updateCarryBody(dt: number): void {
    const g = this.g;
    const c = this.dragging!;
    this.carryT += dt;
    // El cuerpo va con el jugador (para las comprobaciones de agua y testigos).
    c.pos.copy(g.player.pos);
    c.prevPos.copy(c.pos);
    c.yaw = g.player.yaw;
    g.player.speedMul = Math.min(g.player.speedMul, 0.62);
    g.player.forceCrouch = this.carryT < 0.7; // agacharse a recogerlo
    g.vitals.drainStamina(2.5, dt);
  }

  /**
   * Cada frame: posición visual sobre el hombro derecho (tras la animación
   * de recogida, que lo sube desde el suelo).
   */
  updateCarriedVisual(eye: THREE.Vector3, yaw: number): void {
    const c = this.dragging;
    if (!c) return;
    const F = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const U = new THREE.Vector3(0, 1, 0);
    const R = new THREE.Vector3().crossVectors(F, U).normalize();
    const b = c.model.app.build;
    // Carga de bombero: la cadera sobre el hombro derecho, boca abajo, con
    // las piernas colgando por delante (se ven al borde de la vista) y el
    // torso por la espalda.
    const shoulder = eye.clone().addScaledVector(U, -0.32).addScaledVector(R, 0.32).addScaledVector(F, -0.08);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, F.clone().negate(), U.clone().negate()));
    const pos = shoulder.addScaledVector(F, 0.94 * b);
    const k = Math.min(1, this.carryT / 0.7);
    if (k < 1) {
      // Recogida: del suelo al hombro.
      pos.lerpVectors(this.pickFrom, pos, k * k * (3 - 2 * k));
    }
    c.carryPose = { pos, q };
  }

  releaseDrag(): void {
    const c = this.dragging;
    if (!c) return;
    const g = this.g;
    this.dragging = null;
    const spot = this.findBodySpot();
    const fromPos = c.carryPose ? c.carryPose.pos.clone() : c.model.root.position.clone();
    const fromQ = c.carryPose ? c.carryPose.q.clone() : c.model.root.quaternion.clone();
    // Tendido boca arriba (como la pose de muerto) o de lado si aún vive.
    const toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.alive ? 0 : -1.5, spot.yaw, 0, 'XYZ'));
    this.lowering = { c, t: 0, fromPos, fromQ, toPos: new THREE.Vector3(spot.x, spot.y, spot.z), toQ, yaw: spot.yaw };
    c.model.setState(c.alive ? c.woundAnim : 'dead');
    g.player.forceCrouch = true;
    g.bus.emit('sfx', { id: 'grab_heavy', volume: 0.5 });
  }

  /** Bajar el cuerpo del hombro al suelo (0,6 s) y dejarlo quieto. */
  private updateLowering(dt: number): void {
    const L = this.lowering!;
    const g = this.g;
    L.t += dt / 0.6;
    const k = Math.min(1, L.t);
    const e = k * k * (3 - 2 * k);
    const pos = L.fromPos.clone().lerp(L.toPos, e);
    pos.y += Math.sin(e * Math.PI) * 0.08;
    L.c.carryPose = { pos, q: L.fromQ.clone().slerp(L.toQ, e) };
    if (k < 1) return;
    const c = L.c;
    this.lowering = null;
    g.player.forceCrouch = false;
    c.carryPose = null;
    c.pos.copy(L.toPos);
    c.prevPos.copy(c.pos);
    c.yaw = c.renderYaw = L.yaw;
    c.model.root.rotation.set(c.alive ? 0 : -1.5, c.yaw, 0);
    if (!c.alive) c.model.snapDead();
    g.bus.emit('sfx', { id: 'land', volume: 0.6 });
    g.bodies.checkWater(c);
  }

  /**
   * Busca dónde cabe el cuerpo tendido delante del jugador sin atravesar
   * paredes, muebles ni el suelo: prueba distancias y orientaciones y
   * comprueba con rayos que haya hueco para la cabeza y los pies.
   */
  private findBodySpot(): { x: number; y: number; z: number; yaw: number } {
    const g = this.g;
    const p = g.player.pos;
    const yaw = g.player.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const mask = GROUP.STATIC | GROUP.PROP | GROUP.TERRAIN;
    const floorAt = (x: number, z: number) => g.worldItems.groundAt?.(x, p.y + 0.4, z) ?? dragGround(g, x, z, p.y);
    const clearRay = (ox: number, oy: number, oz: number, dx: number, dz: number, len: number) => {
      const l = Math.hypot(dx, dz) || 1;
      return !g.physics.raycast(ox, oy, oz, dx / l, 0, dz / l, len, mask, g.player.collider);
    };
    for (const dist of [0.95, 0.75, 0.55, 0.35]) {
      const x = p.x + fx * dist, z = p.z + fz * dist;
      // Que no haya pared entre el jugador y el sitio.
      if (!clearRay(p.x, p.y + 0.5, p.z, fx, fz, dist + 0.25)) continue;
      const y = floorAt(x, z);
      if (Math.abs(y - p.y) > 0.6) continue;
      for (const off of [Math.PI / 2, -Math.PI / 2, 0, Math.PI, Math.PI / 4, -Math.PI / 4]) {
        const by = yaw + off;
        // La pose de muerto se extiende ~1,1 m hacia atrás (cabeza) y ~0,8 m hacia delante (pies).
        const ax = Math.sin(by), az = Math.cos(by);
        if (!clearRay(x, y + 0.25, z, -ax, -az, 1.2)) continue;
        if (!clearRay(x, y + 0.25, z, ax, az, 0.9)) continue;
        if (!clearRay(x, y + 0.25, z, az, -ax, 0.3) || !clearRay(x, y + 0.25, z, -az, ax, 0.3)) continue;
        return { x, y, z, yaw: by };
      }
    }
    // Sin hueco delante: a los pies del jugador, en la dirección de la mirada.
    return { x: p.x, y: floorAt(p.x, p.z), z: p.z, yaw: yaw + Math.PI };
  }

  private tryGrab(): void {
    const f = this.focus;
    const g = this.g;
    if (f.corpse) { this.pickFrom.copy(f.corpse.model.root.position); this.startCarry(f.corpse); return; }
    let body: RAPIER.RigidBody | undefined;
    let collider: RAPIER.Collider | undefined;
    let item: WorldItem | null = null;
    let propId: string | null = null;
    if (f.kind === 'item' && f.item) {
      g.worldItems.unfreeze(f.item);
      body = f.item.body;
      collider = f.item.collider;
      item = f.item;
      if (item.owner) {
        const witnessed = g.npcs ? g.npcs.witnessesCrime(g.player.pos) : false;
        if (witnessed) {
          g.bus.emit('crime', { type: 'theft', village: item.owner, witnessed: true });
          item.owner = null;
        }
      }
    } else if (f.kind === 'prop' && f.body && f.collider) {
      if (f.body.mass() > 60) return;
      body = f.body;
      collider = f.collider;
      propId = g.physics.tagOf(f.collider)?.id ?? null;
    }
    if (!body || !collider) return;
    body.wakeUp();
    // Detección continua: lo que se lleva o se lanza no atraviesa paredes finas.
    body.enableCcd(true);
    const mass = body.mass();
    const radius = this.colliderRadius(collider);
    const prevGroups = collider.collisionGroups();
    collider.setCollisionGroups(groups(GROUP.CARRIED, ALL & ~GROUP.PLAYER));
    body.setGravityScale(0, true);
    body.setAngularDamping(4);
    this.carried = { body, collider, mass, item, propId, holdDist: Math.max(mass > 15 ? 1.7 : 1.25, radius + 0.7), prevGroups, radius };
    g.bus.emit('sfx', { id: mass > 15 ? 'grab_heavy' : 'grab' });
  }

  private colliderRadius(col: RAPIER.Collider): number {
    const sh = col.shape as unknown as { halfExtents?: { x: number; y: number; z: number }; radius?: number; halfHeight?: number };
    if (sh.halfExtents) return Math.min(0.9, Math.max(sh.halfExtents.x, sh.halfExtents.y, sh.halfExtents.z) * 0.7 + 0.05);
    if (sh.radius !== undefined) return Math.min(0.9, Math.max(sh.radius, (sh.halfHeight ?? 0) * 0.7) + 0.05);
    return 0.25;
  }

  private updateCarry(dt: number, eye: THREE.Vector3, fwd: THREE.Vector3): void {
    const c = this.carried!;
    const g = this.g;
    const target = eye.clone().addScaledVector(fwd, c.holdDist);
    if (c.mass > 15) target.y = Math.min(target.y, eye.y - 0.5);
    // No meter lo que llevas dentro de una pared: se sostiene delante de ella.
    const toT = target.clone().sub(eye);
    const lenT = toT.length();
    toT.divideScalar(lenT || 1);
    const wall = g.physics.raycast(eye.x, eye.y, eye.z, toT.x, toT.y, toT.z, lenT + c.radius, GROUP.TERRAIN | GROUP.STATIC, g.player.collider, c.body);
    if (wall) target.copy(eye).addScaledVector(toT, Math.max(0.3, wall.toi - c.radius));
    // Si el objeto ya quedó al otro lado de algo sólido, volverlo a la mano.
    const t0 = c.body.translation();
    const toO = new THREE.Vector3(t0.x - eye.x, t0.y - eye.y, t0.z - eye.z);
    const lenO = toO.length();
    if (lenO > 0.05) {
      toO.divideScalar(lenO);
      const block = g.physics.raycast(eye.x, eye.y, eye.z, toO.x, toO.y, toO.z, lenO, GROUP.TERRAIN | GROUP.STATIC, g.player.collider, c.body);
      if (block && block.toi < lenO - 0.05) {
        c.body.setTranslation({ x: target.x, y: target.y, z: target.z }, true);
        c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    const t = c.body.translation();
    const dx = target.x - t.x, dy = target.y - t.y, dz = target.z - t.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 2.6) {
      this.drop(false);
      return;
    }
    const k = c.mass > 15 ? 8 : 14;
    let vx = dx * k, vy = dy * k, vz = dz * k;
    const vmax = 10;
    const vl = Math.hypot(vx, vy, vz);
    if (vl > vmax) { vx *= vmax / vl; vy *= vmax / vl; vz *= vmax / vl; }
    // Sumar la velocidad del jugador para que no quede atrás.
    c.body.setLinvel({ x: vx + g.player.vel.x, y: vy, z: vz + g.player.vel.z }, true);
    const av = c.body.angvel();
    c.body.setAngvel({ x: av.x * 0.85, y: av.y * 0.85, z: av.z * 0.85 }, true);
    g.player.speedMul = Math.min(g.player.speedMul, c.mass > 15 ? 0.6 : 0.9);
    // Los objetos pesados cansan.
    if (c.mass > 15) g.vitals.drainStamina(2.5, dt);
  }

  drop(throwIt: boolean): void {
    const c = this.carried;
    if (!c) return;
    this.carried = null;
    c.collider.setCollisionGroups(c.prevGroups);
    c.body.setGravityScale(1, true);
    c.body.setAngularDamping(0.6);
    if (throwIt) {
      const f = this.g.player.forward(new THREE.Vector3());
      const speed = Math.min(14, 70 / Math.max(1, c.mass));
      c.body.setLinvel({ x: f.x * speed, y: f.y * speed + 1.5, z: f.z * speed }, true);
      c.body.setAngvel({ x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: Math.random() * 4 - 2 }, true);
      this.g.vitals.useStamina(Math.min(20, c.mass), true);
      this.g.bus.emit('sfx', { id: 'throw' });
    }
  }
}
