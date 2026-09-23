/**
 * Habitantes: rutinas por agenda con LOD de simulación (ADR-005),
 * reacciones a amenazas y ataques, guardias, percepción de delitos,
 * puertas, antorchas nocturnas, diálogo y persistencia (muertes).
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { Character } from './Character';
import { NPCS, scheduleAt, type NpcDef, type ScheduleEntry } from '../data/npcs';
import type { NavGraph } from '../world/NavGraph';
import type { Place } from '../world/Settlement';
import { findTarget, canSee, sightRange } from './Targeting';
import type { AnimState } from '../actors/HumanoidModel';
import type { Door } from '../world/Buildings';
import { WATCHTOWER } from '../world/WorldLayout';

export class NPC {
  readonly c: Character;
  entry: ScheduleEntry | null = null;
  placeId = '';
  onTower = false;
  deadDay = -1;
  state: 'routine' | 'flee' | 'shelter' | 'fight' | 'defend' | 'talk' = 'routine';
  thinkT = Math.random();
  barkT = 10 + Math.random() * 30;
  patrolIdx = 0;
  shootT = 0;
  idleAnim: AnimState = 'idle';
  talking = false;
  lastTarget: string | null = null;
  constructor(readonly def: NpcDef, c: Character) {
    this.c = c;
  }
}

const PATROL = ['patrol_1', 'patrol_2', 'patrol_3', 'patrol_4'];

export class NPCManager {
  readonly npcs = new Map<string, NPC>();
  private tick = 0;
  private now = 0;
  private doorTimers = new Map<Door, number>();
  private group = new THREE.Group();

  constructor(private readonly g: Game, readonly nav: NavGraph) {
    g.renderer.scene.add(this.group);
    for (const def of NPCS) {
      const c = new Character({
        id: def.id, name: def.name, kind: 'npc', victimKind: def.faction === 'guard' ? 'guard' : 'villager', faction: def.faction, village: def.village,
        appearance: def.appearance, weapon: def.weapon, shield: def.shield, health: def.health,
        skill: def.faction === 'guard' ? 0.7 : 0.35 + def.bravery * 0.2,
        armor: def.faction === 'guard' ? { slash: 0.25, blunt: 0.15, pierce: 0.15 } : undefined,
      }, g.materials, g.models);
      // Los civiles no van con el arma en la mano por el pueblo.
      if (def.faction !== 'guard') c.setWeapon(null);
      const npc = new NPC(def, c);
      this.npcs.set(def.id, npc);
      this.group.add(c.model.root);
      g.registry.add(c);
      c.onStrike = (ch) => g.combat.resolveNpcStrike(ch);
      c.onDeath = (_ch, killer) => this.onDeath(npc, killer);
      c.onHurt = (_ch, attacker) => this.onHurt(npc, attacker);
    }
    g.settlement.occupancy = (id) => this.occupancy(id);
    this.snapAll();
  }

  get(id: string): NPC | undefined {
    return this.npcs.get(id);
  }

  isAlive(id: string): boolean {
    return this.npcs.get(id)?.c.alive ?? false;
  }

  // ------------------------------------------------------------ colocación

  private place(id: string): Place | undefined {
    return this.g.settlement.places.get(id);
  }

  /** Coloca a todos donde su agenda dice (inicio, carga, dormir). */
  snapAll(): void {
    const hour = this.g.time.hourFloat;
    for (const n of this.npcs.values()) {
      if (!n.c.alive) continue;
      n.state = 'routine';
      const e = scheduleAt(n.def.schedule, hour);
      n.entry = e;
      n.placeId = this.resolvePlaceId(n, e);
      const p = this.place(n.placeId);
      if (!p) continue;
      n.onTower = n.placeId === 'tower_top';
      n.c.place(p.x + (Math.random() - 0.5) * 0.4, p.y, p.z + (Math.random() - 0.5) * 0.4, p.yaw);
      n.c.stop();
      n.c.indoors = n.placeId.startsWith('in:');
      n.idleAnim = this.animFor(e, p);
      n.c.faceYaw = p.yaw;
    }
  }

  onTimeSkip(): void {
    this.snapAll();
    // Cadáveres de más de un día: enterrados.
    for (const n of this.npcs.values()) {
      if (!n.c.alive && n.deadDay >= 0 && this.g.time.day > n.deadDay) n.c.model.root.visible = false;
    }
  }

  private resolvePlaceId(n: NPC, e: ScheduleEntry): string {
    if (e.activity === 'patrol') return PATROL[n.patrolIdx % PATROL.length];
    return e.place;
  }

  private animFor(e: ScheduleEntry, p: Place | undefined): AnimState {
    if (p?.anim === 'hammer') return 'hammer';
    switch (e.activity) {
      case 'work': return p?.anim === 'work' ? 'work' : 'idle';
      case 'pray': return 'pray';
      case 'sell': return 'sell';
      case 'farm': return 'farm';
      case 'guard': return 'guard';
      case 'tavern': case 'eat': return p?.anim === 'drink' ? 'drink' : p?.anim === 'sit' ? 'sit' : 'idle';
      case 'hunt': return 'idle';
      case 'social': return 'talk';
      default: return 'idle';
    }
  }

  /** Ruta hacia un lugar (pasando por la puerta si está dentro de un edificio). */
  goTo(n: NPC, placeId: string, speed = 1.35): void {
    const p = this.place(placeId);
    if (!p) return;
    const c = n.c;
    // Bajar de la torre.
    if (n.onTower && placeId !== 'tower_top') {
      const base = this.place('tower_base')!;
      c.place(base.x, base.y, base.z);
      n.onTower = false;
    }
    let tx = p.x, tz = p.z;
    if (placeId === 'tower_top') {
      const base = this.place('tower_base')!;
      tx = base.x; tz = base.z;
    }
    const path = this.nav.findPath(c.pos.x, c.pos.z, tx, tz);
    c.setPath(path, speed);
    c.indoors = false;
    n.placeId = placeId;
    c.faceYaw = p.yaw;
  }

  // ------------------------------------------------------------ actualización

  update(dt: number): void {
    const g = this.g;
    this.tick++;
    this.now += dt;
    const hour = g.time.hourFloat;
    const pp = g.player.pos;
    const raid = g.raids?.alertActive ?? false;
    const night = g.time.isNight;
    for (const n of this.npcs.values()) {
      const c = n.c;
      const d = c.pos.distanceTo(pp);
      // LOD de simulación.
      const lod = d < 55 ? 0 : d < 150 ? 1 : 2;
      c.lod = lod;
      c.setShadow(d < 35);
      const every = lod === 0 ? 1 : lod === 1 ? 6 : 30;
      const step = (this.tick + n.def.id.length) % every === 0;
      const prevHandle = c.collider?.handle;
      c.ensureCollider(g.physics, lod === 0 && !c.indoors && c.alive);
      // Los handles de Rapier se reutilizan: desregistrar al destruir el collider.
      if (prevHandle !== undefined && c.collider?.handle !== prevHandle) g.interactables.unregisterCollider(prevHandle);
      if (c.collider && !g.interactables.forCollider(c.collider.handle)) this.registerTalk(n);
      if (!c.alive) {
        c.visible = lod < 2;
        if (step) c.updateModel(dt * every, false);
        c.hitboxesValid = false;
        continue;
      }
      if (!step) continue;
      const sdt = dt * every;
      this.think(n, sdt, hour, raid, night);
      c.updateCombat(sdt);
      const speed = c.move(sdt, (x, z) => this.groundFor(n, x, z), (ch, out) => this.avoid(ch, out));
      // Llegada a destino.
      if (c.arrived && n.state === 'routine' && !c.indoors) this.onArrive(n);
      c.chooseAnim(speed, n.talking ? 'talk' : n.state === 'shelter' ? 'cower' : n.idleAnim);
      c.visible = lod < 2;
      c.updateModel(sdt, lod === 0);
      c.hitboxesValid = lod === 0 && c.visible && !c.indoors;
      // Antorcha de noche al andar por fuera.
      c.setTorch(night && !c.indoors && (c.faction === 'guard' || speed > 0.3) && n.def.weapon !== 'bow');
      this.updateTorchLight(n);
      // Puertas: se abren al pasar.
      if (lod === 0) this.handleDoors(c);
      // Ladridos (frases de ambiente).
      n.barkT -= sdt;
      if (n.barkT <= 0 && d < 7 && !c.indoors && n.state === 'routine' && !g.ui.blocking) {
        n.barkT = 40 + Math.random() * 60;
        g.ui.say(n.def.name, n.def.barks[Math.floor(Math.random() * n.def.barks.length)], 3.5);
      }
      if (c.faction === 'guard' && (n.def.id === 'pedro') && n.onTower) this.towerArcher(n, sdt);
    }
    // Cerrar puertas abiertas por NPCs.
    for (const [door, t] of this.doorTimers) {
      const nt = t - dt;
      if (nt <= 0) { door.open = false; this.doorTimers.delete(door); }
      else this.doorTimers.set(door, nt);
    }
  }

  /** Suelo: planta del edificio si está dentro, plataforma si está en la torre. */
  private groundFor(n: NPC, x: number, z: number): number {
    if (n.onTower) return this.g.settlement.towerTop.y;
    for (const b of this.g.settlement.buildings.values()) {
      if (b.def.enterable && b.contains(x, z, 0.1)) return b.floorY;
    }
    return this.g.hf.heightAt(x, z);
  }

  private avoidTmp: import('../actors/Actor').Actor[] = [];
  /** Separación entre actores, del jugador y de árboles. */
  private avoid(c: Character, out: THREE.Vector3): THREE.Vector3 {
    const g = this.g;
    for (const a of g.registry.near(c.pos, 1.2, this.avoidTmp)) {
      if (a === c) continue;
      const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const k = (1.2 - d) * 1.8;
      out.x += (dx / d) * k; out.z += (dz / d) * k;
    }
    const pdx = c.pos.x - g.player.pos.x, pdz = c.pos.z - g.player.pos.z;
    const pd = Math.hypot(pdx, pdz);
    if (pd < 1.0 && pd > 0.01) { out.x += (pdx / pd) * (1 - pd) * 2; out.z += (pdz / pd) * (1 - pd) * 2; }
    for (const t of g.vegetation.nearbyTrees(c.pos.x, c.pos.z, 1.6)) {
      const dx = c.pos.x - t.x, dz = c.pos.z - t.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const r = t.radius + 0.6;
      if (d < r) { out.x += (dx / d) * (r - d) * 3; out.z += (dz / d) * (r - d) * 3; }
    }
    return out;
  }

  private handleDoors(c: Character): void {
    for (const door of this.g.settlement.doors.values()) {
      const dx = door.worldPos.x - c.pos.x, dz = door.worldPos.z - c.pos.z;
      if (dx * dx + dz * dz < 2.2) {
        if (!door.open) {
          door.open = true;
          this.g.bus.emit('sfx', { id: 'door_open', x: door.worldPos.x, y: door.worldPos.y, z: door.worldPos.z, volume: 0.6 });
        }
        this.doorTimers.set(door, 2.5);
      }
    }
  }

  private updateTorchLight(n: NPC): void {
    const g = this.g;
    const id = `npc_torch:${n.def.id}`;
    const src = g.lights.get(id);
    const on = n.c.hasTorch && n.c.visible && !n.c.indoors && n.c.alive;
    if (on) {
      const p = n.c.model.torchWorld(new THREE.Vector3());
      if (src) { src.pos.copy(p); src.enabled = true; }
      else g.lights.add({ id, pos: p, color: new THREE.Color(0xff8a3a), intensity: 40, range: 14, flicker: 0.5, priority: 1.2, enabled: true });
      const em = g.particles.emitters.get(id);
      if (em) { em.pos.copy(p); em.enabled = n.c.lod === 0; }
      else g.particles.addEmitter({ id, kind: 'fire', pos: p, rate: 10, spread: 0.06, vel: new THREE.Vector3(0, 1, 0), sizeMul: 0.45, enabled: true });
    } else {
      if (src) src.enabled = false;
      const em = g.particles.emitters.get(id);
      if (em) em.enabled = false;
    }
  }

  // ------------------------------------------------------------ comportamiento

  private think(n: NPC, dt: number, hour: number, raid: boolean, night: boolean): void {
    const g = this.g;
    const c = n.c;
    n.thinkT -= dt;
    if (n.talking) { c.stop(); c.faceYaw = Math.atan2(g.player.pos.x - c.pos.x, g.player.pos.z - c.pos.z); return; }
    const isGuard = c.faction === 'guard';
    const fighter = isGuard || n.def.bravery >= 0.6;
    // Amenazas cercanas.
    const threat = n.thinkT <= 0 || n.state === 'fight' ? findTarget(g, c, isGuard ? 30 : 16, this.now) : null;
    if (n.thinkT <= 0) n.thinkT = 0.4;
    if (threat) {
      n.lastTarget = threat.id;
      if (fighter && (isGuard || raid || c.lastAttacker === threat.id || threat.id !== 'player')) {
        if (n.state !== 'fight') {
          n.state = 'fight';
          if (c.faction !== 'guard' && n.def.weapon) c.setWeapon(n.def.weapon);
          g.bus.emit('sfx', { id: 'shout', x: c.pos.x, y: c.pos.y + 1.6, z: c.pos.z });
        }
        if (n.onTower) return; // el vigía dispara desde la torre
        if (c.weapon.kind === 'bow') this.archerBehaviour(n, threat, dt);
        else c.fight(dt, threat, (x, z, s) => c.setPath(this.nav.clear(c.pos.x, c.pos.z, x, z) ? [{ x, z }] : this.nav.findPath(c.pos.x, c.pos.z, x, z), s));
        return;
      }
      if (n.state !== 'flee' && n.state !== 'shelter') {
        n.state = 'flee';
        g.bus.emit('sfx', { id: 'shout', x: c.pos.x, y: c.pos.y + 1.6, z: c.pos.z });
        this.goTo(n, `in:${n.def.home}`, 3.6);
      }
      return;
    }
    if (n.state === 'fight') {
      n.state = 'routine';
      c.phase = 'none';
      c.blocking = false;
      if (c.faction !== 'guard') c.setWeapon(null);
      n.entry = null;
    }
    // Alarma de ataque.
    if (raid) {
      if (isGuard) {
        const post = n.def.id === 'pedro' ? 'tower_top' : 'gate_n';
        if (n.state !== 'defend' || n.placeId !== post) {
          n.state = 'defend';
          this.goTo(n, post, 3.8);
          n.idleAnim = 'guard';
        }
        if (c.arrived && post === 'tower_top' && !n.onTower) this.climbTower(n);
        return;
      }
      if (fighter && n.def.weapon) {
        if (n.state !== 'defend') {
          n.state = 'defend';
          c.setWeapon(n.def.weapon);
          this.goTo(n, 'plaza', 3.5);
          n.idleAnim = 'guard';
        }
        return;
      }
      if (n.state !== 'shelter') {
        n.state = 'shelter';
        this.goTo(n, `in:${n.def.home}`, 3.8);
      }
      if (c.arrived) c.indoors = true;
      return;
    }
    if (n.state === 'flee' || n.state === 'shelter' || n.state === 'defend') {
      if (n.state === 'flee' && !c.arrived) return;
      if (n.state === 'flee' && c.arrived) c.indoors = true;
      // Pasado el peligro, retoman la rutina.
      n.state = 'routine';
      if (c.faction !== 'guard') c.setWeapon(null);
      n.entry = null;
    }
    // Ausencia temporal (p.ej. la comerciante se va tras un saqueo).
    if (g.flags.num(`${n.def.id}_away_until`) > g.time.day) {
      if (n.placeId !== `in:${n.def.home}`) this.goTo(n, `in:${n.def.home}`, 1.4);
      if (c.arrived) c.indoors = true;
      n.entry = null;
      return;
    }
    // Rutina.
    const e = scheduleAt(n.def.schedule, hour);
    if (e !== n.entry) {
      n.entry = e;
      const pid = this.resolvePlaceId(n, e);
      this.goTo(n, pid, e.activity === 'patrol' ? 1.25 : 1.4);
      n.idleAnim = 'idle';
    }
    void night;
  }

  private onArrive(n: NPC): void {
    const c = n.c;
    const p = this.place(n.placeId);
    if (!p || !n.entry) return;
    if (n.placeId === 'tower_top' && !n.onTower) { this.climbTower(n); return; }
    if (n.placeId.startsWith('in:')) { c.indoors = true; return; }
    n.idleAnim = this.animFor(n.entry, p);
    c.faceYaw = p.yaw;
    // Patrulla: siguiente punto.
    if (n.entry.activity === 'patrol') {
      n.patrolIdx++;
      this.goTo(n, PATROL[n.patrolIdx % PATROL.length], 1.25);
    }
    // Sonido de trabajo del herrero.
    if (n.idleAnim === 'hammer' && Math.random() < 0.5) this.g.bus.emit('sfx', { id: 'hammer', x: c.pos.x, y: c.pos.y + 1, z: c.pos.z, volume: 0.7 });
  }

  private climbTower(n: NPC): void {
    const top = this.place('tower_top')!;
    n.onTower = true;
    n.c.place(top.x, top.y, top.z, top.yaw);
    n.c.stop();
    n.idleAnim = 'guard';
  }

  /** El vigía de la torre dispara a los enemigos visibles. */
  private towerArcher(n: NPC, dt: number): void {
    const g = this.g;
    n.shootT -= dt;
    if (n.shootT > 0) return;
    const t = findTarget(g, n.c, 50, this.now);
    if (!t || t.id === 'player') return;
    n.shootT = 2.6 + Math.random();
    n.c.faceYaw = Math.atan2(t.pos.x - n.c.pos.x, t.pos.z - n.c.pos.z);
    g.combat.npcShoot(n.c, t.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), 0.75);
  }

  private archerBehaviour(n: NPC, t: import('./Character').CombatTarget, dt: number): void {
    const c = n.c;
    const d = c.pos.distanceTo(t.pos);
    c.faceYaw = Math.atan2(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
    if (d < 8) {
      // Retroceder para mantener distancia.
      const dx = (c.pos.x - t.pos.x) / d, dz = (c.pos.z - t.pos.z) / d;
      c.setPath([{ x: c.pos.x + dx * 4, z: c.pos.z + dz * 4 }], 3.2);
      return;
    }
    c.stop();
    n.idleAnim = 'aim';
    n.shootT -= dt;
    if (n.shootT <= 0) {
      n.shootT = 2.2 + Math.random();
      this.g.combat.npcShoot(c, t.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), 0.7);
    }
  }

  private onHurt(n: NPC, attacker: string | null): void {
    const g = this.g;
    if (attacker === 'player') {
      g.bus.emit('sfx', { id: 'pain', x: n.c.pos.x, y: n.c.pos.y + 1.5, z: n.c.pos.z });
      // Los testigos cercanos también reaccionan: los guardias persiguen.
    }
    n.thinkT = 0;
  }

  private onDeath(n: NPC, killer: string | null): void {
    const g = this.g;
    n.deadDay = g.time.day;
    n.state = 'routine';
    g.bus.emit('sfx', { id: 'death', x: n.c.pos.x, y: n.c.pos.y + 1, z: n.c.pos.z });
    g.bus.emit('npc:died', { npcId: n.def.id, killerId: killer });
    g.bus.emit('actor:killed', { victimId: n.def.id, victimKind: n.c.victimKind, victimFaction: n.c.faction, killerId: killer });
    g.bus.emit('notify', { text: `${n.def.name} ha muerto.`, kind: 'alert' });
    const h = n.c.collider?.handle;
    n.c.ensureCollider(g.physics, false);
    if (h !== undefined) g.interactables.unregisterCollider(h);
    const id = `npc_torch:${n.def.id}`;
    g.lights.remove(id);
    g.particles.removeEmitter(id);
  }

  private registerTalk(n: NPC): void {
    const c = n.c;
    if (!c.collider) return;
    this.g.interactables.register(c.collider.handle, {
      id: `npc:${n.def.id}`, kind: 'npc', pos: c.pos,
      label: (g) => {
        if (!c.alive) return null;
        if (n.state === 'fight' || n.state === 'flee') return null;
        if (g.reputation.hostile(n.def.village)) return `${n.def.name} no quiere hablar contigo`;
        return `Hablar con ${n.def.name} (${n.def.role})`;
      },
      interact: (g) => g.dialogue.start(n),
    });
  }

  // ------------------------------------------------------------ consultas

  /** ¿Hay en casa alguien de este edificio? */
  occupancy(buildingId: string): boolean {
    for (const n of this.npcs.values()) {
      if (n.def.home === buildingId && n.c.alive && n.c.indoors) return true;
    }
    if (buildingId === 'tavern') return this.isAlive('ines');
    return false;
  }

  /** ¿Alguien despierto ve al jugador cometer un delito? */
  witnessesCrime(pos: THREE.Vector3): boolean {
    const g = this.g;
    const range = sightRange(g, true) * 0.6;
    for (const n of this.npcs.values()) {
      const c = n.c;
      if (!c.alive || c.indoors) continue;
      const d = c.pos.distanceTo(pos);
      if (d > Math.max(6, range)) continue;
      // Campo de visión ~220º, o muy cerca.
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const dot = ((pos.x - c.pos.x) * fx + (pos.z - c.pos.z) * fz) / (d || 1);
      if (d > 3 && dot < -0.35) continue;
      if (canSee(g, c.pos, pos, `${c.id}>witness`, this.now)) return true;
    }
    return false;
  }

  /** Nombre del NPC vivo más cercano (para textos). */
  nearest(pos: THREE.Vector3, r: number): NPC | null {
    let best: NPC | null = null, bd = r;
    for (const n of this.npcs.values()) {
      if (!n.c.alive || n.c.indoors) continue;
      const d = n.c.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  syncVisuals(alpha: number, dt: number): void {
    for (const n of this.npcs.values()) {
      n.c.syncVisual(alpha, dt);
      n.c.syncCollider();
    }
  }

  serialize(): object {
    const out: Record<string, { alive: boolean; health: number; deadDay: number }> = {};
    for (const [id, n] of this.npcs) out[id] = { alive: n.c.alive, health: n.c.health, deadDay: n.deadDay };
    return out;
  }

  deserialize(d: Record<string, { alive: boolean; health: number; deadDay: number }>): void {
    for (const [id, s] of Object.entries(d)) {
      const n = this.npcs.get(id);
      if (!n) continue;
      n.deadDay = s.deadDay;
      if (!s.alive) {
        n.c.alive = false;
        n.c.health = 0;
        n.c.model.setState('dead');
        // Enterrado: no se muestra.
        n.c.model.root.visible = false;
        n.c.visible = false;
        this.g.registry.remove(id);
      } else n.c.health = s.health;
    }
    this.snapAll();
  }
}

export { WATCHTOWER };
