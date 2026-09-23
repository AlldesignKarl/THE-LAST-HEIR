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

export interface Carried {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mass: number;
  item: WorldItem | null;
  propId: string | null;
  holdDist: number;
  prevGroups: number;
}

export interface FocusTarget {
  kind: 'item' | 'prop' | 'interactable' | 'water' | 'none';
  text: string;
  sub?: string;
  item?: WorldItem;
  inter?: Interactable;
  body?: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
  point?: THREE.Vector3;
}

const REACH = 3.0;
const tmpF = new THREE.Vector3();
const tmpE = new THREE.Vector3();

export class Interaction {
  focus: FocusTarget = { kind: 'none', text: '' };
  carried: Carried | null = null;

  constructor(private readonly g: Game) {}

  update(dt: number): void {
    const g = this.g;
    const p = g.player;
    p.eyePosition(1, tmpE);
    p.forward(tmpF);
    this.updateFocus(tmpE, tmpF);

    const inp = g.input;
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
          this.focus = { kind: 'water', text: 'Arroyo', sub: '[E] Beber / llenar', point: new THREE.Vector3(hit.point.x, lvl, hit.point.z) };
          return;
        }
      }
    }
    // Agua: mirando hacia abajo estando dentro o al borde.
    const lvl = g.hf.waterLevelAt(g.player.pos.x + fwd.x, g.player.pos.z + fwd.z);
    if (lvl !== null && fwd.y < -0.35) this.focus = { kind: 'water', text: 'Arroyo', sub: '[E] Beber / llenar' };
  }

  private propName(id: string): string {
    if (id.includes('barrel')) return 'Barril';
    if (id.includes('crate')) return 'Caja';
    if (id.includes('sack')) return 'Saco';
    if (id.includes('stool')) return 'Taburete';
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
      g.actions.useWater('arroyo');
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

  private tryGrab(): void {
    const f = this.focus;
    const g = this.g;
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
    const mass = body.mass();
    const prevGroups = collider.collisionGroups();
    collider.setCollisionGroups(groups(GROUP.CARRIED, ALL & ~GROUP.PLAYER));
    body.setGravityScale(0, true);
    body.setAngularDamping(4);
    this.carried = { body, collider, mass, item, propId, holdDist: mass > 15 ? 1.7 : 1.25, prevGroups };
    g.bus.emit('sfx', { id: mass > 15 ? 'grab_heavy' : 'grab' });
  }

  private updateCarry(dt: number, eye: THREE.Vector3, fwd: THREE.Vector3): void {
    const c = this.carried!;
    const g = this.g;
    const target = eye.clone().addScaledVector(fwd, c.holdDist);
    if (c.mass > 15) target.y = Math.min(target.y, eye.y - 0.5);
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
