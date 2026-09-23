/**
 * Ataques a la aldea (GDD 4.9). Los atacantes aparecen en su campamento,
 * viajan, se reúnen, se acercan, entran (brecha o portón a golpes),
 * luchan, incendian y saquean, y se retiran si pierden al cabecilla o la
 * mitad del grupo. El resultado deja consecuencias persistentes.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { Character } from '../ai/Character';
import { findTarget } from '../ai/Targeting';
import { BANDIT_CAMP, RAID_STAGING, VILLAGES, PALISADE } from '../world/WorldLayout';
import { cardinalFrom } from '../core/math';
import type { WeaponId } from '../combat/WeaponDefs';
import type { BuildingInstance } from '../world/Buildings';
import { RAPIER, GROUP, groups, ALL } from '../engine/Physics';

type Phase = 'none' | 'gathering' | 'approach' | 'assault' | 'retreat';

interface Raider {
  c: Character;
  role: 'leader' | 'fighter' | 'archer' | 'torch';
  task: 'travel' | 'fight' | 'burn' | 'loot' | 'bash' | 'flee';
  taskT: number;
  targetBuilding: string | null;
  shootT: number;
  thinkT: number;
}

const NAMES = ['Garcí el Cuervo', 'Ruy Tuerto', 'Lope', 'Nuño', 'Fortún', 'Mateo el Rojo', 'Vela', 'Tello'];

export class RaidSystem {
  phase: Phase = 'none';
  raiders: Raider[] = [];
  raidId = '';
  spotted = false;
  /** Alerta activa para los vecinos (hasta un rato después del final). */
  alertActive = false;
  private alertT = 0;
  private bellT = 0;
  private phaseT = 0;
  private now = 0;
  private startCount = 0;
  private killedByPlayer = 0;
  private villagersKilled = 0;
  private buildingsBurned = new Set<string>();
  private lootedT = 0;
  gateHP = 100;
  entry: 'breach' | 'gate' = 'breach';
  private burning = new Map<string, number>();
  history: { day: number; result: string; attackers: number; killed: number }[] = [];
  private group = new THREE.Group();

  constructor(private readonly g: Game) {
    g.renderer.scene.add(this.group);
    g.bus.on('npc:died', () => { if (this.phase !== 'none') this.villagersKilled++; });
    g.bus.on('time:hour', (e) => { if (e.hour === 7) this.morningRepairs(); });
  }

  get active(): boolean {
    return this.phase !== 'none';
  }

  // ------------------------------------------------------------ inicio

  start(): void {
    if (this.phase !== 'none') return;
    const g = this.g;
    const n = Math.min(6, 4 + this.history.length);
    this.raidId = `raid_${g.time.day}_${Math.floor(g.time.hourFloat)}`;
    this.startCount = n;
    this.killedByPlayer = 0;
    this.villagersKilled = 0;
    this.buildingsBurned.clear();
    this.lootedT = 0;
    this.gateHP = 100;
    this.spotted = false;
    this.entry = g.settlement.palisadeRepaired ? 'gate' : 'breach';
    const night = g.time.isNight;
    for (let i = 0; i < n; i++) {
      const role: Raider['role'] = i === 0 ? 'leader' : i === 1 ? 'archer' : i <= 3 ? 'torch' : 'fighter';
      const weapon: WeaponId = role === 'leader' ? 'sword' : role === 'archer' ? 'bow' : (['club', 'axe', 'spear', 'club'] as WeaponId[])[i % 4];
      const c = new Character({
        id: `${this.raidId}_${i}`, name: role === 'leader' ? NAMES[0] : NAMES[1 + (i % (NAMES.length - 1))], kind: 'bandit', victimKind: 'bandit',
        faction: 'bandit', village: null,
        appearance: { skin: [0xb98b68, 0xc99a78, 0xa87a58][i % 3], tunic: [0x3a3a30, 0x2a2622, 0x4a3a2a, 0x302a26][i % 4], pants: 0x2a2420, hair: 0x1a1612, beard: i % 2 === 0, hood: role !== 'leader', helmet: role === 'leader', build: role === 'leader' ? 1.1 : 1 },
        weapon, health: role === 'leader' ? 150 : 85, skill: role === 'leader' ? 0.8 : 0.45,
        armor: role === 'leader' ? { slash: 0.3, blunt: 0.2, pierce: 0.2 } : { slash: 0.05, blunt: 0.05, pierce: 0 },
      }, g.materials, g.models);
      const ang = (i / n) * Math.PI * 2;
      const x = BANDIT_CAMP.x + Math.cos(ang) * 4, z = BANDIT_CAMP.z + Math.sin(ang) * 4;
      c.place(x, g.hf.heightAt(x, z), z, Math.PI);
      c.onStrike = (ch) => g.combat.resolveNpcStrike(ch);
      c.onDeath = (ch, killer) => this.onRaiderDeath(ch, killer);
      c.setTorch(night && (role === 'torch' || role === 'leader'));
      this.group.add(c.model.root);
      g.registry.add(c);
      this.raiders.push({ c, role, task: 'travel', taskT: 0, targetBuilding: null, shootT: 0, thinkT: Math.random() });
    }
    this.setPhase('gathering');
    for (const r of this.raiders) this.pathTo(r, RAID_STAGING.x + (Math.random() - 0.5) * 6, RAID_STAGING.z + (Math.random() - 0.5) * 6, 2.3);
    g.bus.emit('raid:planned', { raidId: this.raidId, village: 'robledo' });
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
  }

  private pathTo(r: Raider, x: number, z: number, speed: number): void {
    r.c.setPath(this.g.npcs!.nav.findPath(r.c.pos.x, r.c.pos.z, x, z), speed);
  }

  private alive(): Raider[] {
    return this.raiders.filter((r) => r.c.alive);
  }

  // ------------------------------------------------------------ actualización

  update(dt: number): void {
    const g = this.g;
    this.now += dt;
    if (this.alertActive) {
      this.alertT -= dt;
      if (this.alertT <= 0 && this.phase === 'none') this.alertActive = false;
      // Campana de alarma.
      this.bellT -= dt;
      const bell = g.settlement.buildings.get('church')?.bellPos;
      if (this.bellT <= 0 && bell && this.phase !== 'none' && g.npcs?.isAlive('anselmo') !== false) {
        this.bellT = 7;
        g.bus.emit('sfx', { id: 'bell', x: bell.x, y: bell.y, z: bell.z });
      }
    }
    this.updateFires(dt);
    if (this.phase === 'none') return;
    this.phaseT += dt;
    const alive = this.alive();
    const center = new THREE.Vector3();
    for (const r of alive) center.add(r.c.pos);
    if (alive.length) center.divideScalar(alive.length);
    const v = VILLAGES[0];
    const distToVillage = Math.hypot(center.x - v.x, center.z - v.z);

    // Avistamiento.
    if (!this.spotted && alive.length && (distToVillage < 95 || center.distanceTo(g.player.pos) < 35)) this.spot(center);

    // Moral: retirada.
    const leaderDead = !this.raiders[0].c.alive;
    const casualties = this.raiders.length - alive.length;
    if (this.phase !== 'retreat' && (leaderDead || casualties >= Math.ceil(this.startCount / 2) || (this.phase === 'assault' && this.phaseT > 170))) {
      this.retreat(leaderDead || casualties >= Math.ceil(this.startCount / 2));
    }

    switch (this.phase) {
      case 'gathering':
        if (alive.every((r) => r.c.arrived) || this.phaseT > 240) {
          this.setPhase('approach');
          if (!this.spotted && g.player.pos.distanceTo(center) < 150) g.bus.emit('sfx', { id: 'horn', x: center.x, y: center.y + 2, z: center.z });
          const ang = this.entry === 'breach' ? PALISADE.breachAngle : PALISADE.gateAngle;
          const ex = Math.cos(ang) * (PALISADE.radius + 5), ez = Math.sin(ang) * (PALISADE.radius + 5);
          for (const r of alive) this.pathTo(r, ex + (Math.random() - 0.5) * 4, ez + (Math.random() - 0.5) * 4, 2.6);
        }
        break;
      case 'approach':
        if (alive.some((r) => r.c.arrived) || this.phaseT > 120) {
          this.setPhase('assault');
          g.bus.emit('sfx', { id: 'horn', x: center.x, y: center.y + 2, z: center.z });
          if (!this.spotted) this.spot(center);
        }
        break;
      case 'assault':
        break;
      case 'retreat': {
        const pd = (r: Raider) => r.c.pos.distanceTo(g.player.pos);
        for (const r of alive) {
          if (r.c.arrived || r.task !== 'flee') {
            r.task = 'flee';
            this.pathTo(r, BANDIT_CAMP.x, BANDIT_CAMP.z, 4.2);
          }
        }
        if (alive.every((r) => pd(r) > 110 || r.c.pos.distanceTo(new THREE.Vector3(BANDIT_CAMP.x, r.c.pos.y, BANDIT_CAMP.z)) < 10) || this.phaseT > 120) this.finish();
        break;
      }
      default: break;
    }
    // IA individual.
    for (const r of this.raiders) this.updateRaider(r, dt);
  }

  private spot(center: THREE.Vector3): void {
    const g = this.g;
    this.spotted = true;
    this.alertActive = true;
    this.alertT = 9999;
    this.bellT = 0;
    const dir = cardinalFrom(center.x - VILLAGES[0].x, center.z - VILLAGES[0].z);
    g.bus.emit('raid:spotted', { raidId: this.raidId, village: 'robledo', direction: dir });
    g.bus.emit('notify', { text: `¡ENEMIGOS AL ${dir}! Suena la campana.`, kind: 'alert' });
    g.quests.start('defense_robledo');
    // Los guardias cierran el portón si la brecha está cerrada.
    if (g.settlement.palisadeRepaired && g.npcs?.isAlive('mendo')) {
      g.settlement.gate.open = false;
      g.bus.emit('sfx', { id: 'gate', x: g.settlement.gate.pos.x, y: g.settlement.gate.pos.y, z: g.settlement.gate.pos.z });
    }
  }

  private updateRaider(r: Raider, dt: number): void {
    const g = this.g;
    const c = r.c;
    const d = c.pos.distanceTo(g.player.pos);
    const lod = d < 60 ? 0 : d < 160 ? 1 : 2;
    c.lod = lod;
    c.ensureCollider(g.physics, lod === 0 && c.alive);
    if (!c.alive) {
      c.model.update(dt, false);
      c.hitboxesValid = false;
      return;
    }
    c.updateCombat(dt);
    r.thinkT -= dt;
    r.taskT += dt;
    if (this.phase === 'assault' || (this.phase === 'approach' && this.spotted)) this.assaultBrain(r, dt);
    else if (this.phase === 'retreat') {
      // Si les cortan el paso, se defienden.
      const t = findTarget(g, c, 3, this.now);
      if (t) c.fight(dt, t, (x, z, s) => c.setPath([{ x, z }], s));
    }
    const speed = c.move(dt, (x, z) => this.ground(x, z), (ch, out) => this.avoid(ch, out));
    let idle: 'idle' | 'work' | 'aim' = 'idle';
    if (r.task === 'burn' || r.task === 'loot' || r.task === 'bash') idle = 'work';
    if (r.role === 'archer' && r.task === 'fight') idle = 'aim';
    c.chooseAnim(speed, idle);
    c.model.update(dt, lod === 0);
    c.hitboxesValid = lod === 0;
    c.visible = lod < 2;
    this.updateTorch(c);
  }

  private assaultBrain(r: Raider, dt: number): void {
    const g = this.g;
    const c = r.c;
    const target = findTarget(g, c, r.role === 'archer' ? 35 : 18, this.now);
    if (target) {
      r.task = 'fight';
      if (r.role === 'archer') {
        const d = c.pos.distanceTo(target.pos);
        c.faceYaw = Math.atan2(target.pos.x - c.pos.x, target.pos.z - c.pos.z);
        if (d < 9) { const k = 4 / d; c.setPath([{ x: c.pos.x - (target.pos.x - c.pos.x) * k, z: c.pos.z - (target.pos.z - c.pos.z) * k }], 3); }
        else if (d > 28) this.pathTo(r, target.pos.x, target.pos.z, 2.8);
        else {
          c.stop();
          r.shootT -= dt;
          if (r.shootT <= 0) { r.shootT = 2.4 + Math.random(); g.combat.npcShoot(c, target.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), 0.6); }
        }
      } else {
        c.fight(dt, target, (x, z, s) => c.setPath(g.npcs!.nav.clear(c.pos.x, c.pos.z, x, z) ? [{ x, z }] : g.npcs!.nav.findPath(c.pos.x, c.pos.z, x, z), s));
      }
      return;
    }
    if (r.thinkT > 0 && r.task !== 'fight') {
      this.continueTask(r, dt);
      return;
    }
    r.thinkT = 1;
    // Portón cerrado: forzarlo.
    if (this.entry === 'gate' && !g.settlement.gate.open) {
      const gp = g.settlement.gate.pos;
      const outside = new THREE.Vector3(gp.x * 1.08, 0, gp.z * 1.08);
      if (c.pos.distanceTo(outside.setY(c.pos.y)) > 3) this.pathTo(r, outside.x + (Math.random() - 0.5) * 3, outside.z, 2.8);
      else { r.task = 'bash'; c.stop(); c.faceYaw = Math.atan2(gp.x - c.pos.x, gp.z - c.pos.z); }
      return;
    }
    // Incendiar o saquear.
    if (r.task === 'fight' || r.task === 'travel' || !r.targetBuilding) {
      const b = this.pickBuilding(r);
      if (b) {
        r.targetBuilding = b.def.id;
        r.task = r.role === 'torch' && c.hasTorch !== false ? 'burn' : 'loot';
        r.taskT = 0;
        const door = b.doors[0]?.outside ?? b.localToWorld(0, 0, b.def.d / 2 + 1.2);
        this.pathTo(r, door.x, door.z, 2.8);
      } else {
        r.task = 'travel';
        this.pathTo(r, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 2.5);
      }
    }
  }

  private continueTask(r: Raider, dt: number): void {
    const g = this.g;
    const c = r.c;
    if (r.task === 'bash') {
      if (g.settlement.gate.open) { r.task = 'travel'; return; }
      if (Math.random() < dt * 0.8) {
        c.startAttack(true);
        this.gateHP -= 6;
        g.bus.emit('sfx', { id: 'chop', x: g.settlement.gate.pos.x, y: g.settlement.gate.pos.y + 1.5, z: g.settlement.gate.pos.z });
        if (this.gateHP <= 0) {
          g.settlement.gate.open = true;
          g.flags.set('gate_broken');
          g.bus.emit('notify', { text: '¡Han derribado el portón!', kind: 'alert' });
          g.bus.emit('sfx', { id: 'tree_fall', x: g.settlement.gate.pos.x, y: g.settlement.gate.pos.y, z: g.settlement.gate.pos.z });
        }
      }
      return;
    }
    if ((r.task === 'burn' || r.task === 'loot') && c.arrived && r.targetBuilding) {
      const b = g.settlement.buildings.get(r.targetBuilding);
      if (!b) return;
      c.faceYaw = Math.atan2(b.def.x - c.pos.x, b.def.z - c.pos.z);
      if (r.task === 'burn' && r.taskT > 5 && !b.burning) {
        this.ignite(b);
        r.targetBuilding = null;
        r.task = 'travel';
        r.thinkT = 0;
      } else if (r.task === 'loot') {
        this.lootedT += dt;
        if (r.taskT > 12) { r.targetBuilding = null; r.task = 'travel'; r.thinkT = 0; }
      }
    }
  }

  private pickBuilding(r: Raider): BuildingInstance | null {
    const g = this.g;
    let best: BuildingInstance | null = null, bd = Infinity;
    for (const b of g.settlement.buildings.values()) {
      if (b.burning || b.def.id === 'church' || b.health < b.def.maxHealth * 0.3) continue;
      if (Math.hypot(b.def.x, b.def.z) > 60) continue;
      const d = r.c.pos.distanceTo(new THREE.Vector3(b.def.x, r.c.pos.y, b.def.z)) + Math.random() * 20;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  private ground(x: number, z: number): number {
    for (const b of this.g.settlement.buildings.values()) if (b.def.enterable && b.contains(x, z, 0.1)) return b.floorY;
    return this.g.hf.heightAt(x, z);
  }

  private avoid(c: Character, out: THREE.Vector3): THREE.Vector3 {
    const g = this.g;
    for (const r of this.raiders) {
      if (r.c === c || !r.c.alive) continue;
      const dx = c.pos.x - r.c.pos.x, dz = c.pos.z - r.c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.3 && d > 0.01) { out.x += (dx / d) * (1.3 - d) * 2; out.z += (dz / d) * (1.3 - d) * 2; }
    }
    for (const t of g.vegetation.nearbyTrees(c.pos.x, c.pos.z, 1.6)) {
      const dx = c.pos.x - t.x, dz = c.pos.z - t.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const rr = t.radius + 0.6;
      if (d < rr) { out.x += (dx / d) * (rr - d) * 3; out.z += (dz / d) * (rr - d) * 3; }
    }
    return out;
  }

  private updateTorch(c: Character): void {
    const g = this.g;
    const id = `raider_torch:${c.id}`;
    const on = c.hasTorch && c.alive && c.lod < 2;
    const p = on ? c.model.torchWorld(new THREE.Vector3()) : null;
    const l = g.lights.get(id);
    if (on && p) {
      if (l) { l.pos.copy(p); l.enabled = true; }
      else g.lights.add({ id, pos: p, color: new THREE.Color(0xff8030), intensity: 45, range: 15, flicker: 0.55, priority: 1.3, enabled: true });
      const em = g.particles.emitters.get(id);
      if (em) { em.pos.copy(p); em.enabled = true; }
      else g.particles.addEmitter({ id, kind: 'fire', pos: p, rate: 11, spread: 0.06, vel: new THREE.Vector3(0, 1, 0), sizeMul: 0.5, enabled: true });
    } else {
      if (l) l.enabled = false;
      const em = g.particles.emitters.get(id);
      if (em) em.enabled = false;
    }
  }

  // ------------------------------------------------------------ incendios

  private ignite(b: BuildingInstance): void {
    const g = this.g;
    b.burning = true;
    this.buildingsBurned.add(b.def.id);
    this.burning.set(b.def.id, 0);
    g.fires.add({ id: `blaze_${b.def.id}`, kind: 'blaze', pos: b.firePoints[0].clone(), policy: 'always', canCook: false, heat: 30, lit: true });
    g.bus.emit('building:fire', { buildingId: b.def.id, burning: true });
    g.bus.emit('notify', { text: `¡Fuego en ${b.def.name}! Coge un cubo de agua del pozo.`, kind: 'alert' });
  }

  private updateFires(dt: number): void {
    const g = this.g;
    for (const [id, water] of this.burning) {
      const b = g.settlement.buildings.get(id);
      if (!b) continue;
      b.setHealth(b.health - dt * 1.2);
      if (b.health <= b.def.maxHealth * 0.15) this.extinguishDone(b, false);
      else this.burning.set(id, water);
    }
  }

  burningBuilding(id: string): BuildingInstance | null {
    const b = this.g.settlement.buildings.get(id);
    return b && b.burning ? b : null;
  }

  /** El jugador echa un cubo de agua. Hacen falta 2. */
  douse(id: string): void {
    const g = this.g;
    const b = this.burningBuilding(id);
    if (!b) return;
    if (!g.inventory.has('bucket_water')) {
      g.bus.emit('notify', { text: 'Necesitas un cubo lleno de agua (pozo).', kind: 'warning' });
      return;
    }
    g.inventory.remove('bucket_water');
    g.inventory.add('bucket');
    g.equipment.validate();
    const w = (this.burning.get(id) ?? 0) + 1;
    this.burning.set(id, w);
    g.particles.burst('steam', b.firePoints[0].x, b.firePoints[0].y, b.firePoints[0].z, 25, 2);
    g.bus.emit('sfx', { id: 'sizzle', x: b.firePoints[0].x, y: b.firePoints[0].y, z: b.firePoints[0].z });
    if (w >= 2) {
      this.extinguishDone(b, true);
      g.reputation.change('robledo', 4, 'apagar un incendio');
    } else g.bus.emit('notify', { text: 'El fuego baja. Otro cubo más.', kind: 'info' });
  }

  private extinguishDone(b: BuildingInstance, byPlayer: boolean): void {
    const g = this.g;
    b.burning = false;
    this.burning.delete(b.def.id);
    g.fires.remove(`blaze_${b.def.id}`);
    g.bus.emit('building:fire', { buildingId: b.def.id, burning: false });
    g.bus.emit('building:damaged', { buildingId: b.def.id, health: b.health });
    if (byPlayer) g.bus.emit('notify', { text: `Apagas el fuego de ${b.def.name}.`, kind: 'info' });
  }

  // ------------------------------------------------------------ final

  private onRaiderDeath(c: Character, killer: string | null): void {
    const g = this.g;
    if (killer === 'player') this.killedByPlayer++;
    g.bus.emit('sfx', { id: 'death', x: c.pos.x, y: c.pos.y + 1, z: c.pos.z });
    g.bus.emit('actor:killed', { victimId: c.id, victimKind: 'bandit', victimFaction: 'bandit', killerId: killer });
    // Botín físico: el arma cae al suelo.
    const w = c.weapon.id;
    const itemId = w === 'fists' ? null : w;
    if (itemId) g.worldItems.spawn(itemId, c.pos.x + 0.4, c.pos.y + 0.6, c.pos.z, { rotY: Math.random() * 6, velocity: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5) });
    if (Math.random() < 0.6) g.worldItems.spawn('arrow', c.pos.x - 0.3, c.pos.y + 0.5, c.pos.z, { count: 3 + Math.floor(Math.random() * 4) });
    if (this.raiders[0].c === c) {
      g.worldItems.spawn('payment_order', c.pos.x, c.pos.y + 0.4, c.pos.z + 0.4, {});
      g.worldItems.spawn('gambeson', c.pos.x - 0.4, c.pos.y + 0.4, c.pos.z, {});
      g.bus.emit('notify', { text: `${c.name} ha caído. ¡Los bandidos vacilan!`, kind: 'alert' });
    }
    // Bolsa: monedas al recogerla (contenedor en el cadáver).
    const cid = `corpse_${c.id}`;
    g.containers.create(cid, `Cadáver de ${c.name}`, null, Math.random() < 0.5 ? [{ id: 'bread', count: 1 }] : [], 5 + Math.floor(Math.random() * 15));
    // Collider para poder registrar el cadáver.
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.pos.x, c.pos.y + 0.25, c.pos.z));
    const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.25, 0.4).setCollisionGroups(groups(GROUP.PROP, ALL & ~GROUP.PLAYER)), body);
    g.physics.tag(col, { kind: 'interactable', id: cid });
    this.corpseBodies.set(c.id, body);
    g.interactables.register(col.handle, { id: cid, kind: 'corpse', pos: c.pos.clone(), label: () => `Registrar a ${c.name}`, interact: (game) => game.ui.openContainer(cid) });
    const lid = `raider_torch:${c.id}`;
    g.lights.remove(lid);
    g.particles.removeEmitter(lid);
  }

  private retreat(defeated: boolean): void {
    const g = this.g;
    this.setPhase('retreat');
    (this as { defeated?: boolean }).defeated = defeated;
    g.bus.emit('raid:retreat', { raidId: this.raidId });
    g.bus.emit('notify', { text: defeated ? '¡Los bandidos huyen!' : 'Los bandidos se retiran con su botín.', kind: 'alert' });
    g.bus.emit('sfx', { id: 'horn' });
  }

  private finish(): void {
    const g = this.g;
    const defeated = !!(this as { defeated?: boolean }).defeated;
    const burned = this.buildingsBurned.size;
    const repelled = defeated && this.villagersKilled <= 1 && burned <= 1 && this.lootedT < 40;
    const result = repelled ? 'repelled' : 'failed';
    const killed = this.raiders.filter((r) => !r.c.alive).length;
    // Consecuencias persistentes.
    g.flags.setNum('raid_result_day', g.time.day);
    g.flags.clear('last_raid_repelled');
    g.flags.clear('last_raid_failed');
    let summary: string;
    if (repelled) {
      g.flags.set('last_raid_repelled');
      g.flags.set('raid_reward_pending');
      g.reputation.change('robledo', 8 + Math.min(10, this.killedByPlayer * 3), 'defender Robledo');
      summary = `Abatidos: ${killed}. ${this.killedByPlayer ? `Tú derribaste a ${this.killedByPlayer}.` : ''} Mendo quiere hablar contigo.`;
    } else {
      g.flags.set('last_raid_failed');
      g.flags.setNum('lucia_away_until', g.time.day + 2);
      summary = `Casas dañadas: ${burned}. Vecinos muertos: ${this.villagersKilled}. Lucía se marcha a Almenara unos días.`;
    }
    this.history.push({ day: g.time.day, result, attackers: this.startCount, killed });
    g.flags.setNum('raids', this.history.length);
    g.flags.set('raid_over');
    g.bus.emit('raid:ended', { raidId: this.raidId, village: 'robledo', result, summary });
    if (g.quests.isActive('defense_robledo')) {
      if (repelled) g.quests.complete('defense_robledo');
      else g.quests.fail('defense_robledo');
    }
    g.flags.clear('raid_over');
    // Limpieza: los que huyeron desaparecen; los muertos quedan (saqueables) hasta el día siguiente.
    for (const r of this.raiders) {
      if (r.c.alive) {
        this.group.remove(r.c.model.root);
        r.c.ensureCollider(g.physics, false);
        g.registry.remove(r.c.id);
        g.lights.remove(`raider_torch:${r.c.id}`);
        g.particles.removeEmitter(`raider_torch:${r.c.id}`);
      } else this.corpses.push({ c: r.c, day: g.time.day });
    }
    this.raiders = [];
    this.setPhase('none');
    this.alertT = 45;
    g.save.save('auto');
  }

  /** Cadáveres de bandidos (se registran para saquear). */
  corpses: { c: Character; day: number }[] = [];
  private corpseBodies = new Map<string, RAPIER.RigidBody>();

  updateCorpses(): void {
    const g = this.g;
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const k = this.corpses[i];
      if (g.time.day > k.day + 1 && k.c.pos.distanceTo(g.player.pos) > 40) {
        this.group.remove(k.c.model.root);
        g.registry.remove(k.c.id);
        g.containers.remove(`corpse_${k.c.id}`);
        const body = this.corpseBodies.get(k.c.id);
        if (body) {
          g.interactables.unregisterCollider(body.collider(0).handle);
          g.physics.removeBody(body);
          this.corpseBodies.delete(k.c.id);
        }
        this.corpses.splice(i, 1);
      }
    }
  }

  /** Cada mañana Sancho repara lo dañado (y la brecha, si hay madera). */
  private morningRepairs(): void {
    const g = this.g;
    if (!g.npcs?.isAlive('sancho')) return;
    if (g.flags.has('palisade_repair_pending')) {
      g.flags.clear('palisade_repair_pending');
      g.flags.set('palisade_repaired');
      g.settlement.setPalisadeRepaired(true);
      g.npcs.nav.setWallEnabled('breach', true);
      g.bus.emit('notify', { text: 'Sancho y los vecinos han cerrado la brecha de la empalizada.', kind: 'quest' });
    }
    if (g.flags.has('gate_broken')) {
      g.flags.clear('gate_broken');
      g.bus.emit('notify', { text: 'El portón vuelve a cerrar bien.', kind: 'info' });
    }
    let worst: BuildingInstance | null = null;
    for (const b of g.settlement.buildings.values()) if (!b.burning && b.health < b.def.maxHealth && (!worst || b.health < worst.health)) worst = b;
    if (worst) {
      worst.setHealth(worst.health + worst.def.maxHealth * 0.35);
      if (worst.health >= worst.def.maxHealth) g.bus.emit('notify', { text: `Han terminado de reparar ${worst.def.name}.`, kind: 'info' });
    }
  }

  serialize(): object {
    return { history: this.history };
  }

  deserialize(d: { history: RaidSystem['history'] }): void {
    this.history = d.history ?? [];
  }
}
