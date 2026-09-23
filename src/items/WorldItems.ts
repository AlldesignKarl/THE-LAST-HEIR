/**
 * Objetos físicos del mundo. Cada objeto es un cuerpo rígido de Rapier:
 * cae, rueda, se empuja, se agarra y se lanza. Persistencia:
 *  - objetos colocados por diseño (id estable) → se recuerda si se cogieron
 *  - objetos soltados/generados → se guardan con su posición
 */
import * as THREE from 'three';
import { Physics, RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import type { ModelLibrary, Shape } from '../engine/placeholder/Models';
import { itemDef } from '../data/items';

export interface WorldItem {
  uid: string;
  itemId: string;
  count: number;
  /** Pueblo propietario (coger a la vista = robo). */
  owner: string | null;
  /** Colocado por diseño (true) o soltado/generado (false). */
  authored: boolean;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Object3D;
  /** Siendo transportado por el jugador. */
  carried: boolean;
  /** Animación de recogida en curso. */
  collecting: number;
  /** Fijo (sin física hasta que se toca): objetos sobre mesas o expositores. */
  frozen: boolean;
}

export interface SpawnOpts {
  uid?: string;
  count?: number;
  owner?: string | null;
  authored?: boolean;
  rotY?: number;
  rot?: THREE.Quaternion;
  velocity?: THREE.Vector3;
  /** Empieza dormido/fijo hasta que el jugador interactúe. */
  frozen?: boolean;
}

let uidCounter = 0;

export function colliderForShape(shape: Shape): RAPIER.ColliderDesc {
  const oy = shape.oy ?? 0;
  let d: RAPIER.ColliderDesc;
  if (shape.type === 'box') d = RAPIER.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz);
  else if (shape.type === 'cyl') d = RAPIER.ColliderDesc.cylinder(shape.hh, shape.r);
  else d = RAPIER.ColliderDesc.ball(shape.r);
  return d.setTranslation(0, oy, 0);
}

export class WorldItems {
  readonly items = new Map<string, WorldItem>();
  private byCollider = new Map<number, WorldItem>();
  /** Ids de objetos de diseño ya retirados del mundo. */
  readonly removedAuthored = new Set<string>();
  private group = new THREE.Group();
  /** Destino de la animación de recogida (mano). */
  collectTarget = new THREE.Vector3();

  constructor(private readonly physics: Physics, scene: THREE.Scene, private readonly models: ModelLibrary) {
    scene.add(this.group);
  }

  spawn(itemId: string, x: number, y: number, z: number, opts: SpawnOpts = {}): WorldItem | null {
    const uid = opts.uid ?? `wi:${Date.now().toString(36)}:${(uidCounter++).toString(36)}`;
    if (opts.authored && this.removedAuthored.has(uid)) return null;
    if (this.items.has(uid)) return this.items.get(uid)!;
    const def = itemDef(itemId);
    const model = this.models.create(def.model);
    const rot = opts.rot ?? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotY ?? 0);
    const bd = (opts.frozen ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(x, y, z)
      .setRotation(rot)
      .setLinearDamping(0.2)
      .setAngularDamping(0.6)
      .setCcdEnabled(def.weight < 1);
    const body = this.physics.world.createRigidBody(bd);
    const mass = Math.max(0.05, def.weight);
    const cd = colliderForShape(model.shape)
      .setMass(mass)
      .setFriction(0.8)
      .setRestitution(0.1)
      .setCollisionGroups(groups(GROUP.PROP, ALL));
    const collider = this.physics.world.createCollider(cd, body);
    this.physics.tag(collider, { kind: 'item', id: uid });
    if (opts.velocity) body.setLinvel(opts.velocity, true);
    model.object.position.set(x, y, z);
    model.object.quaternion.copy(rot);
    this.group.add(model.object);
    const wi: WorldItem = {
      uid, itemId, count: opts.count ?? 1, owner: opts.owner ?? null, authored: !!opts.authored,
      body, collider, mesh: model.object, carried: false, collecting: 0, frozen: !!opts.frozen,
    };
    this.items.set(uid, wi);
    this.byCollider.set(collider.handle, wi);
    return wi;
  }

  forCollider(handle: number): WorldItem | undefined {
    return this.byCollider.get(handle);
  }

  /** Convierte un objeto fijo en dinámico (al agarrarlo o golpearlo). */
  unfreeze(wi: WorldItem): void {
    if (!wi.frozen) return;
    wi.frozen = false;
    wi.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  }

  /** Retira el objeto del mundo (recogido). */
  remove(wi: WorldItem): void {
    this.byCollider.delete(wi.collider.handle);
    this.physics.removeBody(wi.body);
    this.group.remove(wi.mesh);
    this.items.delete(wi.uid);
    if (wi.authored) this.removedAuthored.add(wi.uid);
  }

  /** Inicia la animación de recogida: el objeto vuela a la mano. */
  beginCollect(wi: WorldItem): void {
    this.byCollider.delete(wi.collider.handle);
    this.physics.removeBody(wi.body);
    wi.collecting = 0.001;
    this.items.delete(wi.uid);
    if (wi.authored) this.removedAuthored.add(wi.uid);
    this.collecting.push(wi);
  }

  private collecting: WorldItem[] = [];

  /** Sincroniza mallas con cuerpos y anima recogidas. */
  update(dt: number): void {
    for (const wi of this.items.values()) {
      if (wi.frozen) continue;
      if (wi.body.isSleeping()) continue;
      const t = wi.body.translation();
      const r = wi.body.rotation();
      wi.mesh.position.set(t.x, t.y, t.z);
      wi.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      // Caída fuera del mundo: recolocar.
      if (t.y < -200) wi.body.setTranslation({ x: t.x, y: 50, z: t.z }, true);
    }
    for (let i = this.collecting.length - 1; i >= 0; i--) {
      const wi = this.collecting[i];
      wi.collecting += dt / 0.28;
      const k = Math.min(1, wi.collecting);
      wi.mesh.position.lerp(this.collectTarget, k * 0.6);
      wi.mesh.scale.setScalar(Math.max(0.05, 1 - k * 0.8));
      if (k >= 1) {
        this.group.remove(wi.mesh);
        this.collecting.splice(i, 1);
      }
    }
  }

  serialize(): object {
    const dropped: { uid: string; itemId: string; count: number; owner: string | null; p: number[]; q: number[] }[] = [];
    const moved: { uid: string; p: number[]; q: number[] }[] = [];
    for (const wi of this.items.values()) {
      const t = wi.body.translation(), r = wi.body.rotation();
      const p = [t.x, t.y, t.z].map((v) => Math.round(v * 100) / 100);
      const q = [r.x, r.y, r.z, r.w].map((v) => Math.round(v * 1000) / 1000);
      if (!wi.authored) dropped.push({ uid: wi.uid, itemId: wi.itemId, count: wi.count, owner: wi.owner, p, q });
      else if (!wi.frozen) moved.push({ uid: wi.uid, p, q });
    }
    return { removed: [...this.removedAuthored], dropped, moved };
  }

  /**
   * Carga sobre un mundo recién construido: retira los objetos de diseño
   * ya recogidos, restaura los soltados y recoloca los movidos.
   */
  deserialize(d: { removed: string[]; dropped: { uid: string; itemId: string; count: number; owner: string | null; p: number[]; q: number[] }[]; moved: { uid: string; p: number[]; q: number[] }[] }): void {
    for (const wi of [...this.items.values()]) {
      if (!wi.authored || d.removed.includes(wi.uid)) {
        this.byCollider.delete(wi.collider.handle);
        this.physics.removeBody(wi.body);
        this.group.remove(wi.mesh);
        this.items.delete(wi.uid);
      }
    }
    this.removedAuthored.clear();
    for (const id of d.removed) this.removedAuthored.add(id);
    for (const it of d.dropped) {
      this.spawn(it.itemId, it.p[0], it.p[1] + 0.05, it.p[2], {
        uid: it.uid, count: it.count, owner: it.owner, rot: new THREE.Quaternion(it.q[0], it.q[1], it.q[2], it.q[3]),
      });
    }
    for (const m of d.moved) {
      const wi = this.items.get(m.uid);
      if (!wi) continue;
      this.unfreeze(wi);
      wi.body.setTranslation({ x: m.p[0], y: m.p[1] + 0.02, z: m.p[2] }, true);
      wi.body.setRotation({ x: m.q[0], y: m.q[1], z: m.q[2], w: m.q[3] }, true);
    }
  }

  clearAll(): void {
    for (const wi of [...this.items.values()]) {
      this.byCollider.delete(wi.collider.handle);
      this.physics.removeBody(wi.body);
      this.group.remove(wi.mesh);
    }
    this.items.clear();
  }
}
