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
  state: 'routine' | 'flee' | 'shelter' | 'fight' | 'defend' | 'talk' | 'report' = 'routine';
  /** Testigo que corre a contar un crimen. */
  report: { type: 'assault' | 'murder'; village: string; t: number; victim: string | null } | null = null;
  /** Recado en curso (ir a por agua, leña, al campo…). */
  errand: { place: string; back: string; phase: 'go' | 'do' | 'back'; t: number; anim: AnimState; prop: string | null } | null = null;
  errandT = 30 + Math.random() * 60;
  thinkT = Math.random();
  barkT = 10 + Math.random() * 30;
  patrolIdx = 0;
  shootT = 0;
  idleAnim: AnimState = 'idle';
  talking = false;
  lastTarget: string | null = null;
  /** Paseíllo cerca de su sitio: 'out' yendo, 'back' volviendo. */
  wander: 'none' | 'out' | 'back' = 'none';
  fidgetT = 4 + Math.random() * 14;
  /** Ya se colocó en su sitio (postura y orientación aplicadas). */
  settled = false;
  /** Enterrado (ya no se ve el cuerpo). */
  buried = false;
  constructor(readonly def: NpcDef, c: Character) {
    this.c = c;
  }
}

interface NpcSave { alive: boolean; health: number; deadDay: number; pos?: number[]; buried?: boolean; hidden?: boolean; severed?: string[] }

type ErrandDef = { place: string; anim: AnimState; prop: string | null; t: [number, number] };
const W = (place: string, anim: AnimState, prop: string | null, t: [number, number]): ErrandDef => ({ place, anim, prop, t });
/** Recados diarios por oficio: van, hacen la tarea un rato y vuelven. */
const ERRANDS: Record<string, ErrandDef[]> = {
  farmer: [W('field_3', 'farm', null, [25, 45]), W('well', 'work', 'bucket', [6, 10]), W('market_stall', 'sell', 'sack', [8, 14])],
  fisher: [W('beach_nets', 'work', null, [15, 30]), W('fish_rack_work', 'work', 'fish_crate', [10, 20]), W('pier_start', 'idle', null, [6, 12]), W('market_stall', 'sell', 'fish_crate', [8, 14])],
  baker: [W('well', 'work', 'bucket', [6, 10]), W('woodpile_zone', 'work', 'firewood', [8, 14]), W('market_stall', 'sell', 'sack', [8, 14])],
  innkeeper: [W('well', 'work', 'bucket', [6, 10]), W('market_stall', 'sell', 'sack', [8, 14]), W('woodpile_zone', 'work', 'firewood', [8, 12])],
  cooper: [W('woodpile_zone', 'work', 'plank', [10, 18]), W('well', 'work', 'bucket', [6, 10]), W('harbor_lane', 'talk', null, [8, 14])],
  widow: [W('well', 'work', 'bucket', [6, 12]), W('plaza_bench', 'talk', null, [15, 30]), W('market_stall', 'sell', 'sack', [8, 14])],
  smith: [W('woodpile_zone', 'work', 'firewood', [8, 14]), W('well', 'work', 'bucket', [6, 10])],
  carpenter: [W('woodpile_zone', 'work', 'plank', [15, 25]), W('forest_edge', 'work', null, [15, 30])],
  boatwright: [W('woodpile_zone', 'work', 'plank', [10, 20]), W('pier_start', 'work', null, [10, 20])],
  merchant: [W('well', 'work', 'bucket', [6, 10]), W('plaza', 'talk', null, [10, 20])],
  hunter: [W('forest_edge', 'idle', null, [20, 40]), W('market_stall', 'sell', null, [8, 12])],
  priest: [W('plaza', 'talk', null, [10, 20]), W('well', 'work', 'bucket', [6, 10])],
  physician: [W('plaza', 'talk', null, [10, 20]), W('market_stall', 'sell', null, [8, 12])],
};

const PATROL = ['patrol_1', 'patrol_2', 'patrol_3', 'patrol_4'];

export class NPCManager {
  readonly npcs = new Map<string, NPC>();
  private tick = 0;
  private now = 0;
  private doorTimers = new Map<Door, number>();
  /** Distancia a la que se dibujan las personas (menor en calidad baja). */
  get viewDist(): number { return this.g.qualityName === 'low' ? 85 : 150; }
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
      const o = n.onTower ? { x: 0, z: 0 } : this.slotOffset(n, n.placeId, p);
      n.c.place(p.x + o.x + (Math.random() - 0.5) * 0.2, p.y, p.z + o.z + (Math.random() - 0.5) * 0.2, p.yaw);
      n.c.stop();
      n.c.indoors = n.placeId.startsWith('in:');
      n.idleAnim = this.animFor(e, p);
      n.c.faceYaw = p.yaw;
    }
  }

  onTimeSkip(): void {
    // Quien se desangraba no llega al amanecer.
    for (const n of this.npcs.values()) if (n.c.alive && n.c.downed) n.c.die(n.c.lastAttacker);
    this.snapAll();
    // Cadáveres de más de un día: enterrados.
    for (const n of this.npcs.values()) {
      if (!n.c.alive && n.deadDay >= 0 && this.g.time.day > n.deadDay) { n.buried = true; n.c.model.root.visible = false; }
    }
  }

  private resolvePlaceId(n: NPC, e: ScheduleEntry): string {
    if (e.activity === 'patrol') return PATROL[n.patrolIdx % PATROL.length];
    return e.place;
  }

  private animFor(e: ScheduleEntry, p: Place | undefined): AnimState {
    if (p?.anim === 'hammer') return 'hammer';
    if (p?.anim === 'fish') return 'fish';
    switch (e.activity) {
      case 'work': return p?.anim === 'work' ? 'work' : p?.anim === 'chop' ? 'chop' : 'idle';
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

  /**
   * Si otro vecino ya ocupa ese lugar, cada uno se pone a un lado (en corro),
   * para que no se amontonen en el mismo punto.
   */
  private slotOffset(n: NPC, placeId: string, p: Place): { x: number; z: number } {
    if (placeId.startsWith('in:')) return { x: 0, z: 0 };
    let slot = 0;
    for (const o of this.npcs.values()) {
      if (o === n) break;
      if (o.c.alive && o.placeId === placeId) slot++;
    }
    if (slot === 0) return { x: 0, z: 0 };
    for (let k = 0; k < 6; k++) {
      const a = p.yaw + Math.PI / 2 + (slot + k) * 2.1;
      const r = 0.8 + Math.floor((slot - 1) / 5) * 0.6;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (this.nav.clear(p.x, p.z, p.x + x, p.z + z)) return { x, z };
    }
    return { x: 0, z: 0 };
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
    } else {
      const o = this.slotOffset(n, placeId, p);
      tx += o.x; tz += o.z;
    }
    const path = this.nav.findPath(c.pos.x, c.pos.z, tx, tz);
    c.setPath(path, speed);
    c.indoors = false;
    n.settled = false;
    n.wander = 'none';
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
    const pin = this.playerInside();
    if (this.tick % 60 === 0) this.lockDoors(hour);
    for (const n of this.npcs.values()) {
      this.homeVisibility(n, pin);
      const c = n.c;
      const d = c.pos.distanceTo(pp);
      // LOD de simulación.
      const lod = d < 55 ? 0 : d < 150 ? 1 : 2;
      c.lod = lod;
      c.setShadow(d < 35);
      const every = lod === 0 ? 1 : lod === 1 ? 6 : 30;
      const step = (this.tick + n.def.id.length) % every === 0;
      const prevHandle = c.collider?.handle;
      c.ensureCollider(g.physics, lod === 0 && (!c.indoors || c.homeShown) && c.alive && !c.downed && !c.seized);
      // Los handles de Rapier se reutilizan: desregistrar al destruir el collider.
      if (prevHandle !== undefined && c.collider?.handle !== prevHandle) g.interactables.unregisterCollider(prevHandle);
      if (c.collider && !g.interactables.forCollider(c.collider.handle)) this.registerTalk(n);
      if (!c.alive) {
        c.visible = d < this.viewDist && !n.buried;
        if (step) c.updateModel(dt * every, false);
        c.hitboxesValid = false;
        continue;
      }
      if (!step) continue;
      const sdt = dt * every;
      if (c.updateWounds(sdt)) {
        // Herido de muerte: en el suelo, gime y se desangra.
        n.talking = false;
        n.barkT -= sdt;
        if (n.barkT <= 0) { n.barkT = 3 + Math.random() * 4; g.bus.emit('sfx', { id: 'pain', x: c.pos.x, y: c.pos.y + 0.5, z: c.pos.z, volume: 0.45 }); }
        c.chooseAnim(0, 'idle');
        c.visible = d < this.viewDist;
        c.updateModel(sdt, lod === 0);
        c.hitboxesValid = lod === 0 && c.visible && !c.indoors;
        c.setTorch(false);
        this.updateTorchLight(n);
        continue;
      }
      this.think(n, sdt, hour, raid, night);
      c.updateCombat(sdt);
      const speed = c.move(sdt, (x, z) => this.groundFor(n, x, z), (ch, out) => this.avoid(ch, out));
      // Llegada a destino.
      if (c.arrived && n.state === 'routine' && !c.indoors) this.onArrive(n);
      c.chooseAnim(speed, n.talking ? 'talk' : n.state === 'shelter' ? 'cower' : n.idleAnim);
      c.visible = d < this.viewDist;
      c.updateModel(sdt, lod === 0);
      c.hitboxesValid = lod === 0 && c.visible && (!c.indoors || c.homeShown);
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

  /** Edificio visitable en el que está el jugador (o null). */
  private playerInside(): string | null {
    const p = this.g.player.pos;
    for (const b of this.g.settlement.buildings.values()) {
      if (b.def.enterable && !b.def.openFront && b.contains(p.x, p.z, 0.05) && p.y > b.floorY - 0.5 && p.y < b.floorY + 2.5) return b.def.id;
    }
    return null;
  }

  /**
   * Si entras en una casa, sus dueños están ahí: sentados a la mesa o, de
   * noche, durmiendo en la cama. Fuera, están "dentro" sin dibujarse.
   */
  private homeVisibility(n: NPC, pin: string | null): void {
    const c = n.c;
    const home = n.placeId.startsWith('in:') ? n.placeId.slice(3) : null;
    const show = !!pin && c.alive && !c.downed && c.indoors && home === pin && c.arrived;
    if (show && !c.homeShown) {
      const spot = this.g.settlement.homeSpots.get(pin!);
      c.homeShown = true;
      if (!spot) return;
      const sleeping = n.entry?.activity === 'sleep';
      const s = sleeping && spot.bed ? spot.bed : spot.seat;
      c.place(s.p.x, s.p.y, s.p.z, s.yaw);
      c.stop();
      c.faceYaw = s.yaw;
      n.idleAnim = sleeping && spot.bed ? 'sleep' : 'sit';
    } else if (!show && c.homeShown) c.homeShown = false;
  }

  /** De noche las casas habitadas se cierran con llave (la taberna y la iglesia no). */
  private lockDoors(hour: number): void {
    const night = hour >= 22 || hour < 6;
    for (const d of this.g.settlement.doors.values()) {
      const bid = d.buildingId;
      if (bid === 'player_hut' || bid === 'tavern' || bid === 'church') continue;
      const b = this.g.settlement.buildings.get(bid);
      if (!b?.def.enterable) continue;
      d.locked = night && this.g.settlement.isOccupied(bid);
    }
  }

  /** Suelo: planta del edificio si está dentro, plataforma si está en la torre. */
  private groundFor(n: NPC, x: number, z: number): number {
    if (n.onTower) return this.g.settlement.towerTop.y;
    for (const b of this.g.settlement.buildings.values()) {
      if (b.def.enterable && b.contains(x, z, 0.1)) return b.floorY;
    }
    // Embarcadero y puentes: se camina sobre las tablas, no por el fondo.
    const t = this.g.hf.heightAt(x, z);
    const deck = this.g.settlement.deckY(x, z);
    return deck !== null && deck > t ? deck : t;
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
    if (n.state === 'report' && n.report) { this.updateReport(n, dt); return; }
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
      if (n.errand) this.endErrand(n);
      n.entry = e;
      n.wander = 'none';
      const pid = this.resolvePlaceId(n, e);
      // Cada uno con su paso.
      const pace = 0.9 + ((n.def.id.charCodeAt(0) * 7 + n.def.id.length * 13) % 30) / 100;
      this.goTo(n, pid, (e.activity === 'patrol' ? 1.25 : 1.4) * pace);
      n.idleAnim = 'idle';
    }
    if (!this.errand(n, dt)) this.fidget(n, dt);
    void night;
  }

  /** Recados del oficio. Devuelve true si hay uno en curso. */
  private errand(n: NPC, dt: number): boolean {
    const c = n.c;
    const hour = this.g.time.hourFloat;
    const er = n.errand;
    if (er) {
      if (er.phase === 'go' && c.arrived) {
        er.phase = 'do';
        n.idleAnim = er.anim;
        const p = this.place(er.place);
        if (p) c.faceYaw = p.yaw;
      } else if (er.phase === 'do') {
        n.idleAnim = er.anim;
        er.t -= dt;
        if (er.t <= 0) { er.phase = 'back'; this.goTo(n, er.back, 1.25 + Math.random() * 0.2); n.errand = er; }
      } else if (er.phase === 'back' && c.arrived) this.endErrand(n);
      return true;
    }
    n.errandT -= dt;
    if (n.errandT > 0) return false;
    n.errandT = 50 + Math.random() * 70;
    const act = n.entry?.activity;
    if (n.state !== 'routine' || n.talking || !c.arrived || n.onTower || hour < 7 || hour > 19.5) return false;
    if (!act || !['work', 'sell', 'farm', 'social', 'wander', 'eat'].includes(act)) return false;
    const list = (ERRANDS[n.def.profession] ?? []).filter((x) => x.place !== n.placeId && this.place(x.place));
    if (!list.length) return false;
    const pick = list[Math.floor(Math.random() * list.length)];
    const back = n.placeId;
    this.goTo(n, pick.place, 1.3 + Math.random() * 0.2);
    n.errand = { place: pick.place, back, phase: 'go', t: pick.t[0] + Math.random() * (pick.t[1] - pick.t[0]), anim: pick.anim, prop: pick.prop };
    if (pick.prop) c.model.setOffhand(this.g.models, pick.prop);
    return true;
  }

  private endErrand(n: NPC): void {
    if (n.errand?.prop) n.c.model.setOffhand(this.g.models, n.c.hasTorch ? 'torch' : null);
    n.errand = null;
    n.settled = false;
  }

  /**
   * Vida en reposo: quien está de charla, de guardia, vendiendo o sin nada
   * que hacer no se queda clavado: da unos pasos, se gira hacia alguien
   * cercano, cambia de postura y vuelve a su sitio.
   */
  private fidget(n: NPC, dt: number): void {
    const c = n.c;
    if (n.state !== 'routine' || n.talking || c.indoors || n.onTower || !n.entry) return;
    if (n.wander === 'out' && c.arrived) {
      // Llegó al punto del paseo: se queda un rato y luego vuelve.
      n.wander = 'back';
      n.fidgetT = 3 + Math.random() * 6;
      n.idleAnim = 'idle';
      c.faceYaw = c.yaw + (Math.random() - 0.5) * 2;
      return;
    }
    n.fidgetT -= dt;
    if (n.fidgetT > 0 || !c.arrived) return;
    const p = this.place(n.placeId);
    if (!p) return;
    if (n.wander === 'back') {
      n.wander = 'none';
      n.settled = false;
      c.setPath(this.nav.clear(c.pos.x, c.pos.z, p.x, p.z) ? [{ x: p.x, z: p.z }] : this.nav.findPath(c.pos.x, c.pos.z, p.x, p.z), 1.0 + Math.random() * 0.3);
      n.fidgetT = 8 + Math.random() * 16;
      return;
    }
    n.fidgetT = 6 + Math.random() * 14;
    const act = n.entry.activity;
    const fixedPose = ['hammer', 'fish', 'pray', 'sit', 'drink', 'farm', 'work'].includes(n.idleAnim);
    const canWalk = !fixedPose && (act === 'social' || act === 'wander' || act === 'guard' || act === 'sell' || act === 'eat' || act === 'hunt' || act === 'work' || act === 'tavern');
    const r = Math.random();
    if (canWalk && r < 0.45) {
      // Paseíllo de 2–5 m por un sitio despejado.
      for (let k = 0; k < 6; k++) {
        const a = Math.random() * Math.PI * 2, dist = 2 + Math.random() * 3;
        const x = p.x + Math.cos(a) * dist, z = p.z + Math.sin(a) * dist;
        if (!this.nav.clear(c.pos.x, c.pos.z, x, z)) continue;
        if (Math.abs(this.g.hf.heightAt(x, z) - c.pos.y) > 0.8 || this.g.hf.waterLevelAt(x, z) !== null) continue;
        n.wander = 'out';
        c.setPath([{ x, z }], 0.85 + Math.random() * 0.35);
        return;
      }
    }
    if (!fixedPose && r < 0.8) {
      // Girarse hacia alguien cercano (conversación) o mirar a otro lado.
      let best: NPC | null = null, bd = 6;
      for (const o of this.npcs.values()) {
        if (o === n || !o.c.alive || o.c.indoors) continue;
        const d = o.c.pos.distanceTo(c.pos);
        if (d < bd) { bd = d; best = o; }
      }
      c.faceYaw = best ? Math.atan2(best.c.pos.x - c.pos.x, best.c.pos.z - c.pos.z) : p.yaw + (Math.random() - 0.5) * 2.2;
      if (best && act === 'social') n.idleAnim = Math.random() < 0.6 ? 'talk' : 'idle';
      c.model.idleStyle = Math.floor(Math.random() * 4);
    }
  }

  private onArrive(n: NPC): void {
    const c = n.c;
    if (n.wander !== 'none' || (n.errand && n.errand.phase !== 'back')) return; // de paseo o de recado
    const p = this.place(n.placeId);
    if (!p || !n.entry) return;
    if (n.placeId === 'tower_top' && !n.onTower) { this.climbTower(n); return; }
    if (n.placeId.startsWith('in:')) { c.indoors = true; return; }
    if (!n.settled) {
      n.settled = true;
      n.idleAnim = this.animFor(n.entry, p);
      c.faceYaw = p.yaw;
    }
    // Patrulla: siguiente punto.
    if (n.entry.activity === 'patrol') {
      n.patrolIdx++;
      this.goTo(n, PATROL[n.patrolIdx % PATROL.length], 1.25);
    }
    // Sonido de trabajo del herrero.
    if (n.idleAnim === 'hammer' && Math.random() < 0.02) this.g.bus.emit('sfx', { id: 'hammer', x: c.pos.x, y: c.pos.y + 1, z: c.pos.z, volume: 0.7 });
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
    // Un testigo que muere antes de contarlo se lleva el secreto; el cuerpo
    // de su víctima queda por descubrir.
    if (n.report?.victim) {
      const v = this.npcs.get(n.report.victim);
      if (v) g.bodies.registerMurder(v.c, n.report.village);
    }
    n.report = null;
    if (n.errand) this.endErrand(n);
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
  /** El primer vecino o guardia que ve lo que pasa en `pos` (o null). */
  findWitness(pos: THREE.Vector3, victim: Character | null = null): NPC | null {
    const g = this.g;
    const range = sightRange(g, true) * 0.6;
    for (const n of this.npcs.values()) {
      const c = n.c;
      if (!c.alive || c.indoors || c.downed || c === victim) continue;
      const d = c.pos.distanceTo(pos);
      if (d > Math.max(6, range)) continue;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const dot = ((pos.x - c.pos.x) * fx + (pos.z - c.pos.z) * fz) / (d || 1);
      if (d > 3 && dot < -0.35) continue;
      if (canSee(g, c.pos, pos, `${c.id}>witness`, this.now)) return n;
    }
    return null;
  }

  /**
   * Un testigo sale corriendo a contarlo: a un guardia vivo o, si no hay, a
   * la plaza. El pueblo solo se entera cuando llega (si muere antes, nada).
   */
  startReport(n: NPC, type: 'assault' | 'murder', village: string, victim: string | null = null): void {
    const g = this.g;
    if (n.report) { if (type === 'murder') n.report.type = 'murder'; n.report.victim = victim ?? n.report.victim; return; }
    n.report = { type, village, t: 0, victim };
    n.state = 'report';
    n.errand = null;
    n.talking = false;
    if (n.c.faction !== 'guard') n.c.setWeapon(null);
    g.bus.emit('sfx', { id: 'shout', x: n.c.pos.x, y: n.c.pos.y + 1.6, z: n.c.pos.z });
    g.bus.emit('notify', { text: `¡${n.def.name} te ha visto y sale corriendo a avisar!`, kind: 'alert' });
    this.runToReport(n);
  }

  private reportTarget(n: NPC): { x: number; z: number; guard: NPC | null } {
    let best: NPC | null = null, bd = Infinity;
    for (const o of this.npcs.values()) {
      if (o === n || o.c.faction !== 'guard' || !o.c.alive || o.c.downed) continue;
      const d = o.c.pos.distanceTo(n.c.pos);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) return { x: best.c.pos.x, z: best.c.pos.z, guard: best };
    const p = this.place('plaza')!;
    return { x: p.x, z: p.z, guard: null };
  }

  private runToReport(n: NPC): void {
    const t = this.reportTarget(n);
    const c = n.c;
    c.setPath(this.nav.clear(c.pos.x, c.pos.z, t.x, t.z) ? [{ x: t.x, z: t.z }] : this.nav.findPath(c.pos.x, c.pos.z, t.x, t.z), 3.9);
    c.indoors = false;
  }

  private updateReport(n: NPC, dt: number): void {
    const g = this.g;
    const r = n.report!;
    r.t += dt;
    const t = this.reportTarget(n);
    const d = Math.hypot(t.x - n.c.pos.x, t.z - n.c.pos.z);
    // Ha llegado: con un guardia al lado, o a la plaza con gente.
    let others = 0;
    if (!t.guard) for (const o of this.npcs.values()) if (o !== n && o.c.alive && !o.c.downed && !o.c.indoors && o.c.pos.distanceTo(n.c.pos) < 10) others++;
    if ((t.guard && d < 3.5) || (!t.guard && d < 6 && others > 0) || r.t > 120) {
      g.bus.emit('crime', { type: r.type, village: r.village, witnessed: true });
      if (r.victim) g.bodies.resolve(r.victim); // ya se sabe: el cuerpo no vuelve a contar
      g.bus.emit('notify', { text: t.guard ? `${n.def.name} le ha contado a ${t.guard.def.name} lo que hiciste.` : `${n.def.name} ha dado la voz de alarma en la plaza.`, kind: 'alert' });
      g.bus.emit('sfx', { id: 'shout', x: n.c.pos.x, y: n.c.pos.y + 1.6, z: n.c.pos.z });
      n.report = null;
      n.state = 'flee';
      this.goTo(n, `in:${n.def.home}`, 3.4);
      return;
    }
    if (Math.floor(r.t / 2) !== Math.floor((r.t - dt) / 2)) this.runToReport(n); // el guardia se mueve
  }

  witnessesCrime(pos: THREE.Vector3, victim: Character | null = null): boolean {
    const g = this.g;
    const range = sightRange(g, true) * 0.6;
    for (const n of this.npcs.values()) {
      const c = n.c;
      if (!c.alive || c.indoors || c.downed || c === victim) continue;
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
    const out: Record<string, NpcSave> = {};
    for (const [id, n] of this.npcs) {
      const c = n.c;
      out[id] = { alive: c.alive && !c.downed, health: c.health, deadDay: n.deadDay };
      if (!c.alive || c.downed) {
        // El cuerpo se queda donde lo dejaron (arrastrado, escondido, hundido).
        out[id].pos = [c.pos.x, c.pos.y, c.pos.z];
        out[id].buried = n.buried;
        out[id].hidden = c.hiddenBody;
        out[id].severed = [...c.model.severed];
      }
    }
    return out;
  }

  deserialize(d: Record<string, NpcSave>): void {
    for (const [id, s] of Object.entries(d)) {
      const n = this.npcs.get(id);
      if (!n) continue;
      n.deadDay = s.deadDay;
      if (!s.alive) {
        const c = n.c;
        c.alive = false;
        c.health = 0;
        c.model.setState('dead');
        n.buried = s.buried ?? true;
        if (s.pos && !n.buried && this.g.time.day <= n.deadDay) {
          c.place(s.pos[0], s.pos[1], s.pos[2]);
          c.hiddenBody = !!s.hidden;
          for (const l of s.severed ?? []) c.model.sever(l as import('../actors/HumanoidModel').Limb);
        } else {
          // Enterrado: no se muestra.
          n.buried = true;
          c.model.root.visible = false;
          c.visible = false;
        }
        this.g.registry.remove(id);
      } else n.c.health = s.health;
    }
    this.snapAll();
  }
}

export { WATCHTOWER };
