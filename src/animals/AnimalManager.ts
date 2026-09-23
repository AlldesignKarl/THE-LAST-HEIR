/**
 * Fauna con comportamiento: ciervos (pastan, se alertan, huyen, dejan
 * huellas) y lobos (manada nocturna que caza y teme al fuego).
 * Población gestionada: aparecen fuera de la vista y se retiran al
 * cambiar el día; los cadáveres se despiezan con cuchillo.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { AnimalModel } from '../actors/AnimalModel';
import type { Actor, Faction, HitInfo, HitResult } from '../actors/Actor';
import type { Hitbox } from '../actors/HumanoidModel';
import { HIT_ZONES } from '../combat/WeaponDefs';
import { DEER_MEADOW, WOLF_DEN } from '../world/WorldLayout';
import { wrapAngle } from '../core/math';
import { RAPIER, GROUP, groups, ALL } from '../engine/Physics';

type Species = 'deer' | 'wolf';

class Animal implements Actor {
  readonly kind = 'animal';
  readonly faction: Faction;
  readonly village = null;
  readonly name: string;
  readonly pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  yaw = Math.random() * 6;
  renderYaw = this.yaw;
  alive = true;
  health: number;
  maxHealth: number;
  readonly radius: number;
  readonly height: number;
  hitboxesValid = false;
  blocking = false;
  model: AnimalModel;
  state: 'graze' | 'wander' | 'alert' | 'flee' | 'hunt' | 'attack' | 'circle' | 'leave' | 'dead' = 'graze';
  stateT = 0;
  target = new THREE.Vector3();
  speed = 0;
  attackT = 0;
  trackAcc = 0;
  butchered = false;
  deathDay = -1;
  collider: RAPIER.Collider | null = null;
  body: RAPIER.RigidBody | null = null;
  lastAttacker: string | null = null;
  killedByPlayer = false;
  onDeath: ((a: Animal, killer: string | null) => void) | null = null;
  get hitboxes(): Hitbox[] { return this.model.hitboxes; }

  constructor(readonly id: string, readonly species: Species, readonly victimKind: string) {
    const wolf = species === 'wolf';
    this.faction = wolf ? 'predator' : 'prey';
    this.name = wolf ? 'Lobo' : 'Ciervo';
    this.health = this.maxHealth = wolf ? 55 : 45;
    this.radius = wolf ? 0.4 : 0.5;
    this.height = wolf ? 0.9 : 1.5;
    const stag = !wolf && Math.random() < 0.4;
    this.model = new AnimalModel(wolf
      ? { body: 0x6a6660, belly: 0x9a948a, size: 0.95 + Math.random() * 0.15, legLen: 0.45, neckLen: 0.22, wolf: true }
      : { body: 0x7a5a3c, belly: 0xb8a080, size: stag ? 1.1 : 0.95, legLen: 0.7, neckLen: 0.42, antlers: stag });
  }

  takeHit(h: HitInfo): HitResult {
    if (!this.alive) return { applied: 0, blocked: false, killed: false };
    const amount = h.amount * HIT_ZONES[h.zone] * (h.zone === 'head' ? 1.2 : 1);
    this.health -= amount;
    this.lastAttacker = h.attackerId;
    if (this.health <= 0) {
      this.alive = false;
      this.state = 'dead';
      this.model.setState('dead');
      this.onDeath?.(this, h.attackerId);
      return { applied: amount, blocked: false, killed: true };
    }
    if (this.species === 'deer') { this.state = 'flee'; this.stateT = 0; }
    else if (this.health < this.maxHealth * 0.3) { this.state = 'leave'; this.stateT = 0; }
    else { this.state = 'attack'; this.attackT = 0.2; }
    return { applied: amount, blocked: false, killed: false };
  }
}

export class AnimalManager {
  readonly animals = new Map<string, Animal>();
  private group = new THREE.Group();
  private counter = 0;
  private spawnT = 0;
  /** Días hasta que se reponen los ciervos cazados. */
  deerDeficit = 0;
  private tracks: THREE.InstancedMesh;
  private trackIdx = 0;
  private trackMat = new THREE.Matrix4();
  private tmpActors: Actor[] = [];

  constructor(private readonly g: Game) {
    g.renderer.scene.add(this.group);
    const tg = new THREE.CircleGeometry(0.06, 6);
    tg.rotateX(-Math.PI / 2);
    this.tracks = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0x2a2016, roughness: 1, transparent: true, opacity: 0.7, depthWrite: false }), 400);
    this.tracks.count = 0;
    this.tracks.frustumCulled = false;
    this.tracks.renderOrder = 1;
    g.renderer.scene.add(this.tracks);
    g.bus.on('time:hour', (e) => { if (e.hour === 6 && this.deerDeficit > 0) this.deerDeficit = Math.max(0, this.deerDeficit - 1); });
  }

  private spawn(species: Species, x: number, z: number): Animal {
    const a = new Animal(`${species}_${this.counter++}`, species, species);
    a.pos.set(x, this.g.hf.heightAt(x, z), z);
    a.prevPos.copy(a.pos);
    a.target.copy(a.pos);
    this.animals.set(a.id, a);
    this.group.add(a.model.root);
    this.g.registry.add(a);
    a.onDeath = (an, killer) => {
      an.deathDay = this.g.time.day;
      an.killedByPlayer = killer === 'player';
      if (an.species === 'deer') this.deerDeficit++;
      if (killer === 'player') this.g.skills.add('hunting', 2);
      this.g.bus.emit('sfx', { id: an.species === 'wolf' ? 'wolf_growl' : 'deer_alarm', x: an.pos.x, y: an.pos.y + 0.5, z: an.pos.z, volume: 0.6 });
      this.g.bus.emit('actor:killed', { victimId: an.id, victimKind: an.victimKind, victimFaction: an.faction, killerId: killer });
    };
    return a;
  }

  private despawn(a: Animal): void {
    this.group.remove(a.model.root);
    if (a.body) this.g.physics.removeBody(a.body);
    if (a.collider) this.g.interactables.unregisterCollider(a.collider.handle);
    this.animals.delete(a.id);
    this.g.registry.remove(a.id);
  }

  private count(s: Species): number {
    let n = 0;
    for (const a of this.animals.values()) if (a.species === s && a.alive) n++;
    return n;
  }

  /** Gestión de población: fuera de la vista del jugador. */
  private population(): void {
    const g = this.g;
    const night = g.time.isNight;
    const pp = g.player.pos;
    const meadowD = Math.hypot(pp.x - DEER_MEADOW.x, pp.z - DEER_MEADOW.z);
    // Ciervos de día.
    const wantDeer = night ? 0 : Math.max(0, 4 - this.deerDeficit);
    if (this.count('deer') < wantDeer && meadowD < 320 && meadowD > 70) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * DEER_MEADOW.radius * 0.8;
      this.spawn('deer', DEER_MEADOW.x + Math.cos(a) * r, DEER_MEADOW.z + Math.sin(a) * r);
    }
    // Lobos de noche (manada de 3), también con niebla densa.
    const wolfTime = night || g.weather.fog > 0.7;
    const denD = Math.hypot(pp.x - WOLF_DEN.x, pp.z - WOLF_DEN.z);
    if (wolfTime && this.count('wolf') < 3 && denD < 330 && denD > 60) {
      for (let i = this.count('wolf'); i < 3; i++) this.spawn('wolf', WOLF_DEN.x + (Math.random() - 0.5) * 8, WOLF_DEN.z + (Math.random() - 0.5) * 8);
    }
    // Retirada: de día los lobos se van; de noche los ciervos.
    for (const a of this.animals.values()) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(pp);
      if ((a.species === 'wolf' && !wolfTime && a.state !== 'attack') || (a.species === 'deer' && night)) {
        if (a.state !== 'leave') { a.state = 'leave'; a.stateT = 0; }
      }
      if (a.state === 'leave' && d > 90) this.despawn(a);
      if (d > 450) this.despawn(a);
    }
    // Cadáveres viejos desaparecen.
    for (const a of this.animals.values()) {
      if (!a.alive && (a.butchered || g.time.day - a.deathDay >= 2) && a.pos.distanceTo(pp) > 30) {
        // Matar por matar está mal visto: un ciervo abatido y abandonado.
        if (!a.butchered && a.killedByPlayer && a.species === 'deer') g.reputation.change('robledo', -2, 'caza desperdiciada');
        this.despawn(a);
      }
    }
  }

  onTimeSkip(): void {
    for (const a of [...this.animals.values()]) if (a.alive) this.despawn(a);
  }

  update(dt: number): void {
    const g = this.g;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 3; this.population(); }
    const pp = g.player.pos;
    for (const a of this.animals.values()) {
      a.prevPos.copy(a.pos);
      const d = a.pos.distanceTo(pp);
      const near = d < 70;
      if (a.alive) {
        if (a.species === 'deer') this.deerAI(a, dt, d);
        else this.wolfAI(a, dt, d);
        this.moveTowards(a, dt);
      }
      a.model.speed = a.speed;
      // Hitboxes en la posición lógica (la visual se interpola al renderizar).
      a.model.root.position.copy(a.pos);
      a.model.root.rotation.y = a.yaw;
      a.model.update(dt, near);
      a.hitboxesValid = near && a.alive;
      this.ensureCollider(a, near);
      // Huellas de ciervo.
      if (a.species === 'deer' && a.alive && a.speed > 0.4) {
        a.trackAcc += a.speed * dt;
        if (a.trackAcc > 0.9) { a.trackAcc = 0; this.addTrack(a); }
      }
    }
  }

  private ensureCollider(a: Animal, on: boolean): void {
    const g = this.g;
    if (on && !a.body) {
      a.body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(a.pos.x, a.pos.y + a.height / 2, a.pos.z));
      a.collider = g.physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.25, a.radius * 0.8).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)).setCollisionGroups(groups(GROUP.ACTOR, ALL & ~GROUP.ACTOR & ~GROUP.TERRAIN & ~GROUP.STATIC)), a.body);
      g.physics.tag(a.collider, { kind: 'actor', id: a.id });
      g.interactables.register(a.collider.handle, {
        id: `animal:${a.id}`, kind: 'animal', pos: a.pos,
        label: (game) => (a.alive || a.butchered ? null : game.inventory.has('knife') ? `Despiezar ${a.species === 'deer' ? 'el ciervo' : 'el lobo'}` : `${a.name} muerto · necesitas un cuchillo`),
        interact: (game) => this.butcher(a, game),
      });
    } else if (!on && a.body) {
      if (a.collider) g.interactables.unregisterCollider(a.collider.handle);
      g.physics.removeBody(a.body);
      a.body = null;
      a.collider = null;
    }
    if (a.body) {
      a.body.setNextKinematicTranslation({ x: a.pos.x, y: a.pos.y + a.height / 2 * (a.alive ? 1 : 0.4), z: a.pos.z });
      a.body.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a.yaw, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)));
    }
  }

  private butcher(a: Animal, g: Game): void {
    if (a.alive || a.butchered || !g.inventory.has('knife')) return;
    a.butchered = true;
    const meat = a.species === 'deer' ? 3 : 1;
    g.inventory.add('meat_raw', meat);
    g.bus.emit('item:acquired', { itemId: 'meat_raw', count: meat, source: 'loot' });
    const hide = a.species === 'deer' ? 'hide' : 'pelt_wolf';
    g.inventory.add(hide, 1);
    g.bus.emit('item:acquired', { itemId: hide, count: 1, source: 'loot' });
    g.skills.add('hunting', 3);
    g.time.advanceHours(0.25);
    g.particles.burst('blood', a.pos.x, a.pos.y + 0.4, a.pos.z, 20, 1.5);
    g.bus.emit('sfx', { id: 'hit_flesh', x: a.pos.x, y: a.pos.y, z: a.pos.z });
    g.bus.emit('notify', { text: `Despiezas ${a.species === 'deer' ? 'el ciervo' : 'el lobo'}: ${meat} carne, 1 piel.`, kind: 'item' });
    a.model.root.scale.multiplyScalar(0.7);
  }

  private addTrack(a: Animal): void {
    const side = this.trackIdx % 2 ? 0.12 : -0.12;
    const x = a.pos.x + Math.cos(a.yaw) * side, z = a.pos.z - Math.sin(a.yaw) * side;
    this.trackMat.makeRotationY(a.yaw).setPosition(x, this.g.hf.heightAt(x, z) + 0.03, z);
    this.tracks.setMatrixAt(this.trackIdx % 400, this.trackMat);
    this.trackIdx++;
    this.tracks.count = Math.min(400, this.trackIdx);
    this.tracks.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ IA

  /** Nivel de alarma: vista + oído (el jugador agachado es sigiloso). */
  private perceivesPlayer(a: Animal, d: number): boolean {
    const g = this.g;
    const pl = g.player;
    let r = a.species === 'deer' ? 26 : 32;
    if (pl.crouching) r *= 0.45;
    if (pl.sprinting) r *= 1.6;
    if (g.equipment.torchLit) r *= 1.4;
    r *= g.weather.visibility;
    return d < r;
  }

  private deerAI(a: Animal, dt: number, d: number): void {
    a.stateT += dt;
    const pp = this.g.player.pos;
    const threatened = this.perceivesPlayer(a, d) || (a.lastAttacker !== null && a.stateT < 30) || this.nearPredator(a, 25);
    switch (a.state) {
      case 'graze': case 'wander':
        a.speed = a.state === 'wander' ? 1.2 : 0;
        a.model.setState(a.state === 'graze' ? 'graze' : 'walk');
        if (threatened) { a.state = 'alert'; a.stateT = 0; break; }
        if (a.stateT > 4 + Math.random() * 6) {
          a.stateT = 0;
          if (a.state === 'graze') {
            a.state = 'wander';
            const ang = Math.random() * Math.PI * 2, r = Math.random() * DEER_MEADOW.radius;
            a.target.set(DEER_MEADOW.x + Math.cos(ang) * r, 0, DEER_MEADOW.z + Math.sin(ang) * r);
          } else a.state = 'graze';
        }
        break;
      case 'alert':
        a.speed = 0;
        a.model.setState('alert');
        a.yaw = Math.atan2(pp.x - a.pos.x, pp.z - a.pos.z);
        if (a.stateT > 1.2 && threatened) {
          a.state = 'flee'; a.stateT = 0;
          this.g.bus.emit('sfx', { id: 'deer_alarm', x: a.pos.x, y: a.pos.y + 1.2, z: a.pos.z });
        } else if (!threatened && a.stateT > 3) { a.state = 'graze'; a.stateT = 0; }
        break;
      case 'flee': {
        a.model.setState('run');
        a.speed = 8.5;
        const away = new THREE.Vector3(a.pos.x - pp.x, 0, a.pos.z - pp.z).normalize();
        a.target.set(a.pos.x + away.x * 20, 0, a.pos.z + away.z * 20);
        if (a.stateT > 7 && !threatened) { a.state = 'graze'; a.stateT = 0; }
        break;
      }
      case 'leave': {
        a.model.setState('walk');
        a.speed = 2;
        a.target.set(DEER_MEADOW.x - 120, 0, DEER_MEADOW.z - 60);
        break;
      }
      default: break;
    }
  }

  private nearPredator(a: Animal, r: number): boolean {
    for (const o of this.g.registry.near(a.pos, r, this.tmpActors)) if (o.faction === 'predator') return true;
    return false;
  }

  private wolfAI(a: Animal, dt: number, d: number): void {
    const g = this.g;
    a.stateT += dt;
    a.attackT -= dt;
    const pp = g.player.pos;
    const torch = g.equipment.torchLit;
    const sees = this.perceivesPlayer(a, d) || a.lastAttacker === 'player';
    switch (a.state) {
      case 'graze': case 'wander':
        a.model.setState(a.speed > 0.2 ? 'walk' : 'idle');
        a.speed = a.state === 'wander' ? 1.6 : 0;
        if (sees && !g.vitals.dead) { a.state = 'hunt'; a.stateT = 0; g.bus.emit('sfx', { id: 'wolf_growl', x: a.pos.x, y: a.pos.y + 0.6, z: a.pos.z }); break; }
        if (a.stateT > 5 + Math.random() * 5) {
          a.stateT = 0;
          if (a.state === 'graze' && Math.random() < 0.25) {
            a.model.setState('howl');
            g.bus.emit('sfx', { id: 'wolf_howl', x: a.pos.x, y: a.pos.y + 1, z: a.pos.z });
          }
          a.state = a.state === 'graze' ? 'wander' : 'graze';
          const ang = Math.random() * Math.PI * 2, r = 10 + Math.random() * 40;
          a.target.set(WOLF_DEN.x + Math.cos(ang) * r, 0, WOLF_DEN.z + Math.sin(ang) * r);
        }
        break;
      case 'hunt': {
        a.model.setState('run');
        a.speed = 6.5;
        a.target.copy(pp);
        // Con fuego cerca, rodean en vez de lanzarse.
        const keep = torch ? 5.5 : 2.2;
        if (d < keep + 1) { a.state = torch ? 'circle' : 'attack'; a.stateT = 0; }
        if (d > 70 || g.vitals.dead) { a.state = 'wander'; a.stateT = 0; }
        break;
      }
      case 'circle': {
        a.model.setState('walk');
        a.speed = 2.6;
        const ang = Math.atan2(a.pos.x - pp.x, a.pos.z - pp.z) + 0.9;
        a.target.set(pp.x + Math.sin(ang) * 6, 0, pp.z + Math.cos(ang) * 6);
        if (a.stateT > 2 && Math.random() < dt * 0.4) { a.state = 'attack'; a.stateT = 0; }
        if (!torch && a.stateT > 1) { a.state = 'attack'; a.stateT = 0; }
        if (d > 25) { a.state = 'hunt'; a.stateT = 0; }
        break;
      }
      case 'attack': {
        a.model.setState('attack');
        a.speed = 7.2;
        a.target.copy(pp);
        if (d < 1.6 && a.attackT <= 0) {
          a.attackT = 1.3 + Math.random() * 0.6;
          g.bus.emit('sfx', { id: 'wolf_bite', x: a.pos.x, y: a.pos.y + 0.6, z: a.pos.z });
          g.combat.hitPlayer({ id: a.id, pos: a.pos }, 11, null, false, 'pierce');
          // Tras morder, se retira un poco.
          a.state = torch ? 'circle' : 'hunt';
          a.stateT = 0;
          const away = new THREE.Vector3(a.pos.x - pp.x, 0, a.pos.z - pp.z).normalize();
          a.target.set(a.pos.x + away.x * 5, 0, a.pos.z + away.z * 5);
        }
        if (a.stateT > 5) { a.state = 'hunt'; a.stateT = 0; }
        break;
      }
      case 'leave':
        a.model.setState('run');
        a.speed = 5;
        a.target.set(WOLF_DEN.x - 80, 0, WOLF_DEN.z - 80);
        break;
      default: break;
    }
  }

  private moveTowards(a: Animal, dt: number): void {
    if (a.speed <= 0) return;
    const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8) { a.speed = 0; return; }
    let vx = dx / d, vz = dz / d;
    // Evitar árboles.
    for (const t of this.g.vegetation.nearbyTrees(a.pos.x, a.pos.z, 2.2)) {
      const ox = a.pos.x - t.x, oz = a.pos.z - t.z;
      const od = Math.hypot(ox, oz) || 0.01;
      if (od < 2) { vx += (ox / od) * (2 - od); vz += (oz / od) * (2 - od); }
    }
    const l = Math.hypot(vx, vz) || 1;
    const want = Math.atan2(vx / l, vz / l);
    a.yaw += Math.max(-dt * 5, Math.min(dt * 5, wrapAngle(want - a.yaw)));
    const step = Math.min(d, a.speed * dt);
    a.pos.x += Math.sin(a.yaw) * step;
    a.pos.z += Math.cos(a.yaw) * step;
    const wl = this.g.hf.waterLevelAt(a.pos.x, a.pos.z);
    a.pos.y = Math.max(this.g.hf.heightAt(a.pos.x, a.pos.z), wl !== null ? wl - 0.6 : -1e9);
  }

  syncVisuals(alpha: number, dt: number): void {
    for (const a of this.animals.values()) {
      const r = a.model.root;
      r.position.lerpVectors(a.prevPos, a.pos, alpha);
      a.renderYaw += wrapAngle(a.yaw - a.renderYaw) * Math.min(1, dt * 10);
      r.rotation.y = a.renderYaw;
      r.visible = a.pos.distanceTo(this.g.player.pos) < 200;
    }
  }

  serialize(): object {
    return { deerDeficit: this.deerDeficit };
  }

  deserialize(d: { deerDeficit: number }): void {
    this.deerDeficit = d.deerDeficit ?? 0;
  }
}
