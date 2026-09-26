/**
 * Barcas de remos. Se suben con E (si Mateo te la ha alquilado), se reman
 * con W/S y se gira con A/D; flotan con el oleaje, encallan en la arena y
 * chocan con el embarcadero. Al bajar (E) el jugador aparece en la orilla o
 * en el muelle más cercano, o en el agua si no hay tierra cerca.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import { SEA } from './WorldLayout';
import { clamp, damp } from '../core/math';

export interface Boat {
  id: string;
  x: number; z: number; heading: number;
  speed: number;
  turn: number;
  object: THREE.Group;
  oars: THREE.Object3D[];
  body: RAPIER.RigidBody;
  col: RAPIER.Collider;
  stroke: number;
  /** Id del jugador que la lleva en multijugador (null = libre). */
  rider: string | null;
}

const MAX_SPEED = 3.4;

export class Boats {
  readonly boats = new Map<string, Boat>();
  riding: Boat | null = null;
  private t = 0;
  /** La misma pulsación de E que sube no debe bajar en el mismo tick. */
  private justBoarded = false;

  constructor(private readonly g: Game) {
    const p = g.settlement.pier;
    this.spawn('boat_1', p.x1 - 3, p.z - p.w / 2 - 1.3, Math.PI / 2);
    this.spawn('boat_2', p.x1 - 8, p.z + p.w / 2 + 1.3, Math.PI / 2);
  }

  private spawn(id: string, x: number, z: number, heading: number): void {
    const g = this.g;
    const object = new THREE.Group();
    const hull = g.models.create('rowboat').object;
    object.add(hull);
    const oars: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(0.2, 0.62, s * 0.66);
      const oar = g.models.create('oar').object;
      oar.position.set(0, 0, s * 1.0);
      oar.rotation.y = s * Math.PI / 2;
      pivot.add(oar);
      object.add(pivot);
      oars.push(pivot);
    }
    g.renderer.scene.add(object);
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, SEA.level, z));
    const col = g.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(2.0, 0.35, 0.62).setTranslation(0, 0.35, 0).setCollisionGroups(groups(GROUP.STATIC, ALL)), body,
    );
    g.physics.tag(col, { kind: 'boat', id });
    const boat: Boat = { id, x, z, heading, speed: 0, turn: 0, object, oars, body, col, stroke: 0, rider: null };
    this.boats.set(id, boat);
    g.interactables.register(col.handle, {
      id: `boat:${id}`, kind: 'boat', pos: object.position,
      label: (game) => (boat.rider && boat.rider !== game.localPlayerId ? 'Barca ocupada'
        : game.flags.has('boat_permit') ? 'Subir a la barca' : 'Barca de Mateo (alquílasela para usarla)'),
      interact: (game) => this.board(boat, game),
      range: 4,
    });
    this.place(boat);
  }

  private board(boat: Boat, g: Game): void {
    if (!g.flags.has('boat_permit')) {
      g.bus.emit('notify', { text: 'Es de Mateo, el patrón de barcas. Págale para usarla.', kind: 'warning' });
      return;
    }
    if (boat.rider && boat.rider !== g.localPlayerId) return;
    if (g.interaction.carried) { g.bus.emit('notify', { text: 'Suelta lo que llevas antes de subir.', kind: 'warning' }); return; }
    this.riding = boat;
    this.justBoarded = true;
    boat.rider = g.localPlayerId;
    g.player.mounted = true;
    g.bus.emit('sfx', { id: 'step_wood' });
    g.bus.emit('notify', { text: 'W/S remar · A/D girar · E bajar', kind: 'info' });
  }

  /** Bajar: busca tierra firme o el muelle cerca de la barca. */
  disembark(): void {
    const g = this.g;
    const boat = this.riding;
    if (!boat) return;
    let best: THREE.Vector3 | null = null;
    const pier = g.settlement.pier;
    for (let r = 1.8; r <= 5 && !best; r += 0.8) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = boat.x + Math.cos(ang) * r, z = boat.z + Math.sin(ang) * r;
        if (x > pier.x0 && x < pier.x1 && Math.abs(z - pier.z) < pier.w / 2 - 0.3) { best = new THREE.Vector3(x, pier.y + 0.05, z); break; }
        const h = g.hf.heightAt(x, z);
        if (h > SEA.level + 0.15) { best = new THREE.Vector3(x, h + 0.05, z); break; }
      }
    }
    // Sin tierra cerca: al agua, por el costado (se nada).
    if (!best) best = new THREE.Vector3(boat.x + Math.cos(boat.heading) * 2.4, SEA.level - 1.3, boat.z - Math.sin(boat.heading) * 2.4);
    this.riding = null;
    boat.rider = null;
    boat.speed = 0;
    g.player.mounted = false;
    g.player.teleport(best.x, best.y, best.z, g.player.yaw);
    g.bus.emit('sfx', { id: 'step_water' });
  }

  update(dt: number): void {
    const g = this.g;
    this.t += dt;
    const b = this.riding;
    if (b) {
      const inp = g.input;
      if (inp.wasPressed('interact') && !this.justBoarded) { this.disembark(); return; }
      this.justBoarded = false;
      const a = inp.analogMove();
      let fwd = (inp.isDown('forward') ? 1 : 0) - (inp.isDown('back') ? 1 : 0) + a.y;
      let turn = (inp.isDown('left') ? 1 : 0) - (inp.isDown('right') ? 1 : 0) - a.x;
      fwd = clamp(fwd, -1, 1); turn = clamp(turn, -1, 1);
      const sprint = inp.isDown('sprint') && fwd > 0.5 && g.vitals.drainStamina(8, dt);
      const target = fwd * (fwd > 0 ? MAX_SPEED * (sprint ? 1.35 : 1) : 1.4);
      b.speed = damp(b.speed, target, fwd !== 0 ? 0.9 : 0.35, dt);
      b.turn = damp(b.turn, turn * (0.5 + Math.abs(b.speed) * 0.12), 3, dt);
      if (Math.abs(fwd) > 0.1 || Math.abs(turn) > 0.1) {
        b.stroke += dt * (sprint ? 4.2 : 3.2);
        g.vitals.drainStamina(1.5, dt);
        if (Math.sin(b.stroke) > 0.98) g.bus.emit('sfx', { id: 'step_water', x: b.x, y: SEA.level, z: b.z, volume: 0.5 });
      }
    }
    for (const boat of this.boats.values()) {
      if (boat !== this.riding && !boat.rider) {
        boat.speed = damp(boat.speed, 0, 0.6, dt);
        boat.turn = damp(boat.turn, 0, 2, dt);
      }
      if (boat.rider && boat !== this.riding) { this.place(boat); continue; } // la mueve otro jugador (red)
      boat.heading += boat.turn * dt;
      const dx = Math.sin(boat.heading) * boat.speed * dt, dz = Math.cos(boat.heading) * boat.speed * dt;
      const nx = boat.x + dx, nz = boat.z + dz;
      // Proa: ¿encalla o choca con el muelle?
      const bowX = nx + Math.sin(boat.heading) * 2.1 * Math.sign(boat.speed || 1), bowZ = nz + Math.cos(boat.heading) * 2.1 * Math.sign(boat.speed || 1);
      const depth = SEA.level - g.hf.heightAt(bowX, bowZ);
      const pier = g.settlement.pier;
      const hitsPier = bowX > pier.x0 - 0.2 && bowX < pier.x1 + 0.2 && Math.abs(bowZ - pier.z) < pier.w / 2 + 0.2;
      if (depth < 0.35 || hitsPier) {
        if (Math.abs(boat.speed) > 1 && boat === this.riding) g.bus.emit('sfx', { id: 'land', volume: 0.6 });
        boat.speed = 0;
      } else {
        boat.x = nx; boat.z = nz;
      }
      this.place(boat);
      if (boat === this.riding) {
        const seat = new THREE.Vector3(-0.35, 0.45, 0).applyEuler(boat.object.rotation).add(boat.object.position);
        g.player.mountTo(seat.x, seat.y - 0.55, seat.z);
      }
      // Remos: palada al remar, en reposo al parar.
      const moving = Math.abs(boat.speed) > 0.2 || Math.abs(boat.turn) > 0.1;
      boat.oars.forEach((o, i) => {
        const s = i === 0 ? -1 : 1;
        const ph = moving ? Math.sin(boat.stroke) : 0;
        o.rotation.set(s * (0.25 + (moving ? Math.max(0, Math.cos(boat.stroke)) * 0.35 : 0)), ph * 0.7 * s, 0);
      });
    }
  }

  /** Posición visual y física con el oleaje. */
  place(b: Boat): void {
    const g = this.g;
    const wind = g.weather.wind ?? 0.3;
    const t = this.t;
    const y = g.sea.surfaceAt(b.x, b.z, t, wind) - 0.28;
    const fwdY = g.sea.surfaceAt(b.x + Math.sin(b.heading) * 1.5, b.z + Math.cos(b.heading) * 1.5, t, wind);
    const sideY = g.sea.surfaceAt(b.x + Math.cos(b.heading) * 0.8, b.z - Math.sin(b.heading) * 0.8, t, wind);
    const pitch = Math.atan2(fwdY - y - 0.28, 1.5) * 0.8;
    const roll = Math.atan2(sideY - y - 0.28, 0.8) * 0.8;
    b.object.position.set(b.x, y, b.z);
    // El casco se modela a lo largo de X: girar para que X apunte al rumbo.
    b.object.rotation.set(roll, b.heading - Math.PI / 2, -pitch, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, b.heading - Math.PI / 2, 0));
    b.body.setNextKinematicTranslation({ x: b.x, y, z: b.z });
    b.body.setNextKinematicRotation(q);
  }

  serialize(): object {
    const out: Record<string, [number, number, number]> = {};
    for (const b of this.boats.values()) out[b.id] = [b.x, b.z, b.heading];
    return out;
  }

  deserialize(d: Record<string, [number, number, number]>): void {
    if (this.riding) this.disembark();
    for (const [id, v] of Object.entries(d ?? {})) {
      const b = this.boats.get(id);
      if (!b) continue;
      [b.x, b.z, b.heading] = v;
      b.speed = 0;
      this.place(b);
    }
  }
}
