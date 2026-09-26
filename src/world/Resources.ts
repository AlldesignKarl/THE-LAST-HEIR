/**
 * Recursos recolectables: rocas que se pican (piedra) y troncos que se
 * parten con el hacha (tablones). Las rocas se agotan, encogen al picarlas
 * y vuelven a aparecer tras varios días. Estado persistente.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import { rockGeometry } from './GroundScatter';
import { QUARRY, SEA } from './WorldLayout';
import { Rng } from '../core/rng';
import type { WorldItem } from '../items/WorldItems';

const REGROW_DAYS = 3;
/** Daño de pico necesario por piedra. */
const PER_STONE = 22;

interface Rock {
  id: string;
  x: number; y: number; z: number;
  size: number;
  maxStones: number;
  stones: number;
  progress: number;
  depletedDay: number;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody | null;
}

export class Resources {
  readonly rocks = new Map<string, Rock>();
  private group = new THREE.Group();

  constructor(private readonly g: Game) {
    g.renderer.scene.add(this.group);
    const rng = new Rng(4242);
    const spots: [number, number, number][] = [];
    // Cantera: un corro de peñascos.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const r = QUARRY.r * rng.range(0.25, 0.9);
      spots.push([QUARRY.x + Math.cos(a) * r, QUARRY.z + Math.sin(a) * r, rng.range(1.1, 1.8)]);
    }
    // Algunas rocas en las islas.
    for (const is of SEA.islands) for (let i = 0; i < 2; i++) {
      const a = rng.range(0, Math.PI * 2);
      spots.push([is.x + Math.cos(a) * is.r * 0.35, is.z + Math.sin(a) * is.r * 0.35, rng.range(1.0, 1.5)]);
    }
    spots.forEach(([x, z, s], i) => {
      const geo = rockGeometry(100 + i);
      const mesh = new THREE.Mesh(geo, g.materials.get('rock'));
      mesh.castShadow = mesh.receiveShadow = true;
      const y = g.hf.heightAt(x, z);
      mesh.position.set(x, y + s * 0.35, z);
      mesh.rotation.y = rng.range(0, 6.28);
      mesh.scale.setScalar(s);
      this.group.add(mesh);
      const stones = Math.round(4 + s * 4);
      const rock: Rock = { id: `rock_${i}`, x, y, z, size: s, maxStones: stones, stones, progress: 0, depletedDay: -1, mesh, body: null };
      this.rocks.set(rock.id, rock);
      this.makeBody(rock);
    });
  }

  private makeBody(r: Rock): void {
    if (r.body) this.g.physics.removeBody(r.body);
    const k = 0.5 + 0.5 * (r.stones / r.maxStones);
    const s = r.size * k;
    r.mesh.scale.setScalar(s);
    r.mesh.position.y = r.y + s * 0.35;
    r.mesh.visible = r.stones > 0;
    r.body = null;
    if (r.stones <= 0) return;
    const body = this.g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(r.x, r.y + s * 0.3, r.z));
    const col = this.g.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(s * 0.95, s * 0.55, s * 0.9).setCollisionGroups(groups(GROUP.STATIC, ALL)), body,
    );
    this.g.physics.tag(col, { kind: 'rock', id: r.id });
    r.body = body;
  }

  /** Golpe con herramienta a una roca. `power` = daño × capacidad de minar. */
  mine(id: string, power: number, point: { x: number; y: number; z: number }): void {
    const g = this.g;
    const r = this.rocks.get(id);
    if (!r || r.stones <= 0) return;
    g.particles.burst('dust', point.x, point.y, point.z, 8, 2, undefined, 0.7);
    g.particles.burst('spark', point.x, point.y, point.z, 4, 3);
    g.bus.emit('sfx', { id: 'clash', x: point.x, y: point.y, z: point.z, volume: 0.6 });
    if (power <= 0.5) {
      g.bus.emit('notify', { text: 'Necesitas un pico para sacar piedra.', kind: 'warning' });
      return;
    }
    r.progress += power;
    while (r.progress >= PER_STONE && r.stones > 0) {
      r.progress -= PER_STONE;
      r.stones--;
      const added = g.inventory.add('stone', 1);
      if (added) g.bus.emit('item:acquired', { itemId: 'stone', count: 1, source: 'gather' });
      else g.worldItems.spawn('stone', point.x, point.y + 0.3, point.z);
      g.skills.add('survival', 0.3);
    }
    if (r.stones <= 0) {
      r.depletedDay = g.time.day;
      g.bus.emit('notify', { text: 'La roca se ha agotado. Volverá a haber piedra en unos días.', kind: 'info' });
    }
    this.makeBody(r);
  }

  /** Hachazo a un tronco caído: se parte en tablones. */
  splitLog(wi: WorldItem, point: { x: number; y: number; z: number }): boolean {
    const g = this.g;
    if (wi.itemId !== 'log' || wi.carried) return false;
    const planks = 4;
    g.worldItems.remove(wi);
    g.particles.burst('dust', point.x, point.y, point.z, 14, 2.5, undefined, 0.8);
    g.bus.emit('sfx', { id: 'chop', x: point.x, y: point.y, z: point.z });
    const added = g.inventory.add('plank', planks);
    for (let i = added; i < planks; i++) g.worldItems.spawn('plank', point.x + (i - 2) * 0.3, point.y + 0.4, point.z);
    if (added) g.bus.emit('item:acquired', { itemId: 'plank', count: added, source: 'gather' });
    g.bus.emit('notify', { text: `Partes el tronco: ${planks} tablones.`, kind: 'item' });
    g.skills.add('survival', 0.4);
    return true;
  }

  /** Cada amanecer: las rocas agotadas vuelven. */
  regrow(day: number): void {
    for (const r of this.rocks.values()) {
      if (r.stones <= 0 && day - r.depletedDay >= REGROW_DAYS) {
        r.stones = r.maxStones;
        r.progress = 0;
        this.makeBody(r);
      }
    }
  }

  serialize(): object {
    const out: Record<string, [number, number]> = {};
    for (const r of this.rocks.values()) if (r.stones < r.maxStones) out[r.id] = [r.stones, r.depletedDay];
    return out;
  }

  deserialize(d: Record<string, [number, number]>): void {
    for (const r of this.rocks.values()) {
      const s = d[r.id];
      r.stones = s ? s[0] : r.maxStones;
      r.depletedDay = s ? s[1] : -1;
      r.progress = 0;
      this.makeBody(r);
    }
  }
}
