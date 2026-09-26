/**
 * Combate: estado del jugador, resolución de golpes (jugador ↔ IA),
 * proyectiles y efectos de impacto (hit-stop, sacudida, partículas).
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { WEAPONS, BOW, HIT_ZONES, applyArmor, type WeaponDef, type HitZone } from './WeaponDefs';
import type { Actor, Faction } from '../actors/Actor';
import { facingDot, hostile } from '../actors/Actor';
import type { Character } from '../ai/Character';
import { GROUP } from '../engine/Physics';
import { itemDef } from '../data/items';
import { segmentSegmentDist3 } from '../core/math';

export type PlayerCombatState = 'idle' | 'ready' | 'windup' | 'strike' | 'recover' | 'block' | 'draw' | 'kick' | 'stagger';

interface Arrow {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  shooter: string;
  shooterFaction: Faction;
  damage: number;
  life: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export class Combat {
  state: PlayerCombatState = 'idle';
  stateT = 0;
  heavy = false;
  private holdT = 0;
  drawT = 0;
  /** 0..1 progreso de la fase (para el viewmodel). */
  progress = 0;
  private hitThisSwing = new Set<string>();
  private swingBlocked = false;
  recentlyActive = false;
  private activeT = 0;
  hitStop = 0;
  shake = 0;
  private arrows: Arrow[] = [];
  private actorsTmp: Actor[] = [];

  constructor(private readonly g: Game) {}

  get weapon(): WeaponDef {
    const main = this.g.equipment.slots.main;
    const w = main ? itemDef(main).weapon : undefined;
    return WEAPONS[w ?? 'fists'];
  }

  get aimingBow(): boolean {
    return this.state === 'draw';
  }

  get playerWindingUp(): boolean {
    return this.state === 'windup' || (this.state === 'draw' && this.drawT > 0.4);
  }

  get playerBlocking(): boolean {
    return this.state === 'block';
  }

  private setState(s: PlayerCombatState, t = 0): void {
    this.state = s;
    this.stateT = t;
  }

  // ------------------------------------------------------------ jugador

  update(dt: number): void {
    const g = this.g;
    const inp = g.input;
    const v = g.vitals;
    const w = this.weapon;
    this.activeT = Math.max(0, this.activeT - dt);
    this.recentlyActive = this.activeT > 0 || this.state !== 'idle';
    this.shake = Math.max(0, this.shake - dt * 3);
    const carrying = !!g.interaction.carried;
    const busy = g.ui.blocking || carrying;
    g.player.combatBusy = this.state !== 'idle';

    switch (this.state) {
      case 'idle':
        if (busy) break;
        if (inp.wasPressed('kick')) { this.setState('kick', 0.38); this.hitThisSwing.clear(); v.useStamina(10, true); this.activeT = 3; break; }
        if (w.kind === 'bow') {
          if (inp.isDown('attack')) {
            if (!g.inventory.has('arrow')) {
              if (inp.wasPressed('attack')) g.bus.emit('notify', { text: 'No te quedan flechas.', kind: 'warning' });
            } else {
              this.setState('draw');
              this.drawT = 0;
              g.bus.emit('sfx', { id: 'bow_draw' });
            }
          }
          break;
        }
        if (inp.isDown('block') && v.stamina > 5) { this.setState('block'); break; }
        if (inp.wasPressed('attack')) { this.setState('ready'); this.holdT = 0; }
        break;
      case 'ready': {
        this.holdT += dt;
        const release = !inp.isDown('attack');
        if (release || this.holdT >= 0.28) this.beginSwing(!release);
        break;
      }
      case 'windup': {
        const t = this.heavy ? w.heavy : w.light;
        this.stateT -= dt;
        this.progress = 1 - Math.max(0, this.stateT) / t.windup;
        if (this.stateT <= 0) {
          this.setState('strike', t.active);
          this.hitThisSwing.clear();
          this.swingBlocked = false;
          g.bus.emit('sfx', { id: this.heavy ? 'swing_heavy' : 'swing' });
        }
        break;
      }
      case 'strike': {
        const t = this.heavy ? w.heavy : w.light;
        const p0 = this.progress;
        this.stateT -= dt;
        this.progress = 1 - Math.max(0, this.stateT) / t.active;
        if (!this.swingBlocked) this.sweep(p0, this.progress, w, t.damage);
        if (this.stateT <= 0) this.setState('recover', this.swingBlocked ? t.recovery * 1.6 : t.recovery);
        break;
      }
      case 'recover': {
        const t = this.heavy ? w.heavy : w.light;
        this.stateT -= dt;
        this.progress = 1 - Math.max(0, this.stateT) / t.recovery;
        if (this.stateT <= 0) this.setState('idle');
        // Encadenar ataques al final de la recuperación.
        if (this.stateT < t.recovery * 0.35 && inp.wasPressed('attack')) { this.setState('ready'); this.holdT = 0; }
        break;
      }
      case 'block':
        this.activeT = 2;
        if (!inp.isDown('block') || v.stamina <= 0 || busy) this.setState('idle');
        else if (inp.wasPressed('kick')) { this.setState('kick', 0.38); this.hitThisSwing.clear(); }
        break;
      case 'draw': {
        this.activeT = 3;
        this.drawT += dt * g.skills.mul('archery');
        if (this.drawT >= BOW.drawTime) v.drainStamina(BOW.holdStamina, dt);
        if (v.stamina <= 0 && this.drawT >= BOW.drawTime) {
          this.setState('idle');
          g.bus.emit('notify', { text: 'Te tiemblan los brazos: sueltas la cuerda.', kind: 'info' });
          break;
        }
        if (inp.wasPressed('block')) { this.setState('idle'); break; }
        if (!inp.isDown('attack')) {
          const power = Math.min(1, this.drawT / BOW.drawTime);
          if (power >= BOW.minDraw) this.firePlayerArrow(power);
          this.setState('recover', 0);
          this.heavy = false;
          this.stateT = 0.35;
        }
        break;
      }
      case 'kick':
        this.stateT -= dt;
        this.progress = 1 - this.stateT / 0.38;
        if (this.progress > 0.35 && this.hitThisSwing.size === 0) this.kickHit();
        if (this.stateT <= 0) this.setState('idle');
        break;
      case 'stagger':
        this.stateT -= dt;
        if (this.stateT <= 0) this.setState('idle');
        break;
    }
    this.updateArrows(dt);
  }

  private beginSwing(heavy: boolean): void {
    const g = this.g;
    const w = this.weapon;
    const t = heavy ? w.heavy : w.light;
    if (!g.vitals.useStamina(t.stamina * (heavy ? 1 : 1), false)) {
      if (g.vitals.stamina > 3) {
        heavy = false;
        g.vitals.useStamina(g.vitals.stamina, true);
      } else {
        this.setState('idle');
        g.bus.emit('sfx', { id: 'grunt' });
        return;
      }
    }
    this.heavy = heavy;
    // Parte del tiempo de preparación ya se "gastó" manteniendo el botón.
    const wind = heavy ? Math.max(0.2, t.windup - this.holdT) : t.windup;
    this.setState('windup', wind);
    this.progress = 0;
    this.activeT = 3;
  }

  /** Dirección del filo en el instante p (0..1) del golpe. */
  private bladeDir(p: number, heavy: boolean, out: THREE.Vector3): THREE.Vector3 {
    const pl = this.g.player;
    let yawOff: number, pitchOff: number;
    if (heavy) {
      // Tajo vertical descendente.
      yawOff = 0.12 - p * 0.24;
      pitchOff = 0.9 - p * 1.6;
    } else {
      // Tajo diagonal de derecha a izquierda.
      yawOff = -1.0 + p * 2.0;
      pitchOff = 0.35 - p * 0.55;
    }
    const yaw = pl.yaw - yawOff;
    const pitch = pl.pitch + pitchOff;
    return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }

  private sweep(p0: number, p1: number, w: WeaponDef, baseDmg: number): void {
    const g = this.g;
    const eye = g.player.eyePosition(1, new THREE.Vector3());
    const shoulder = eye.clone().add(new THREE.Vector3(0, -0.25, 0));
    const steps = 3;
    const near = g.registry.near(g.player.pos, w.reach + 2, this.actorsTmp);
    for (let s = 1; s <= steps; s++) {
      const p = p0 + ((p1 - p0) * s) / steps;
      this.bladeDir(p, this.heavy, tmpA);
      const inner = shoulder.clone().addScaledVector(tmpA, 0.35);
      const outer = shoulder.clone().addScaledVector(tmpA, w.reach);
      // Obstáculos: muros, árboles, objetos.
      const hit = g.physics.raycast(shoulder.x, shoulder.y, shoulder.z, tmpA.x, tmpA.y, tmpA.z, w.reach, GROUP.STATIC | GROUP.PROP | GROUP.TERRAIN, g.player.collider);
      let limit = w.reach;
      if (hit) {
        limit = hit.toi;
        const key = `w:${hit.collider.handle}`;
        if (!this.hitThisSwing.has(key)) {
          this.hitThisSwing.add(key);
          this.hitWorld(hit, tmpA, w, baseDmg);
        }
      }
      // Actores.
      for (const a of near) {
        if (this.hitThisSwing.has(a.id) || !a.alive) continue;
        if (!a.hitboxesValid) continue;
        let bestZone: HitZone | null = null;
        let bestD = Infinity;
        for (const hb of a.hitboxes) {
          const d = segmentSegmentDist3(inner, outer, hb.pos, hb.pos);
          if (d < hb.r + 0.06 && d < bestD && hb.pos.distanceTo(shoulder) <= limit + 0.1) {
            bestD = d;
            bestZone = hb.zone;
          }
        }
        if (bestZone) {
          this.hitThisSwing.add(a.id);
          this.playerHitsActor(a, bestZone, baseDmg, w);
          if (this.hitThisSwing.size >= 3) return;
        }
      }
    }
  }

  private hitWorld(hit: NonNullable<ReturnType<Game['physics']['raycast']>>, dir: THREE.Vector3, w: WeaponDef, dmg: number): void {
    const g = this.g;
    const tag = hit.tag;
    if (tag?.kind === 'tree') {
      const mul = w.chop * g.skills.mul('survival');
      g.bus.emit('sfx', { id: 'chop', x: hit.point.x, y: hit.point.y, z: hit.point.z });
      g.particles.burst('dust', hit.point.x, hit.point.y, hit.point.z, 5, 1.5, undefined, 0.5);
      if (mul > 0.05) {
        g.treeFelling.damage(tag.id, dmg * mul * (this.heavy ? 1.2 : 0.8), g.player.pos);
        g.skills.add('survival', 0.5);
      }
      this.swingBlocked = w.chop < 0.5;
      this.hitStop = 0.05;
      return;
    }
    if (tag?.kind === 'rock') {
      g.resources.mine(tag.id, dmg * (w.mine ?? 0) * g.skills.mul('survival') * (this.heavy ? 1.3 : 1), hit.point);
      this.swingBlocked = true;
      this.hitStop = 0.06;
      this.shake = Math.max(this.shake, 0.15);
      return;
    }
    const body = hit.collider.parent();
    if (body && body.isDynamic()) {
      const wi = g.worldItems.forCollider(hit.collider.handle);
      // Hachazo a un tronco caído: tablones.
      if (wi && wi.itemId === 'log' && w.chop >= 0.5 && g.resources.splitLog(wi, hit.point)) { this.hitStop = 0.05; return; }
      if (wi) g.worldItems.unfreeze(wi);
      body.applyImpulseAtPoint({ x: dir.x * dmg * 0.3, y: dir.y * dmg * 0.3 + 1, z: dir.z * dmg * 0.3 }, hit.point, true);
      g.bus.emit('sfx', { id: 'block_wood', x: hit.point.x, y: hit.point.y, z: hit.point.z });
      return;
    }
    if (body && !body.isDynamic() && tag?.kind === 'item') {
      const wi = g.worldItems.forCollider(hit.collider.handle);
      if (wi) { g.worldItems.unfreeze(wi); wi.body.applyImpulse({ x: dir.x * 2, y: 1, z: dir.z * 2 }, true); }
      return;
    }
    // Muro/terreno: rebote.
    this.swingBlocked = true;
    const metal = w.id === 'sword' || w.id === 'axe' || w.id === 'spear';
    g.bus.emit('sfx', { id: metal && (tag?.kind === 'building' || tag?.kind === 'static' || tag?.kind === 'cave') ? 'clash' : 'block_wood', x: hit.point.x, y: hit.point.y, z: hit.point.z, volume: 0.6 });
    if (metal) g.particles.burst('spark', hit.point.x, hit.point.y, hit.point.z, 8, 3);
    this.shake = Math.max(this.shake, 0.25);
    this.hitStop = 0.06;
  }

  private playerHitsActor(a: Actor, zone: HitZone, baseDmg: number, w: WeaponDef): void {
    const g = this.g;
    const dmg = baseDmg * g.skills.mul('combat') * (0.9 + Math.random() * 0.2);
    const res = a.takeHit({
      amount: dmg, type: w.type, zone, attackerId: 'player', attackerFaction: 'player',
      from: g.player.pos.clone(), heavy: this.heavy, stagger: this.heavy ? w.stagger : w.stagger * 0.5,
    });
    const hp = a.hitboxes.find((h) => h.zone === zone)?.pos ?? a.pos;
    if (res.blocked) {
      g.bus.emit('sfx', { id: (a as Character).shield ? 'block_wood' : 'clash', x: hp.x, y: hp.y, z: hp.z });
      g.particles.burst('spark', hp.x, hp.y, hp.z, 10, 3);
      this.swingBlocked = true;
      this.shake = Math.max(this.shake, 0.3);
    } else {
      g.bus.emit('sfx', { id: 'hit_flesh', x: hp.x, y: hp.y, z: hp.z });
      g.particles.burst('blood', hp.x, hp.y, hp.z, 12, 2.5);
      g.skills.add('combat', 1);
      this.shake = Math.max(this.shake, this.heavy ? 0.35 : 0.2);
    }
    this.hitStop = res.blocked ? 0.07 : this.heavy ? 0.11 : 0.07;
    g.bus.emit('actor:damaged', { targetId: a.id, attackerId: 'player', amount: res.applied, part: zone, blocked: res.blocked });
    this.onPlayerAggression(a);
  }

  /** Atacar a vecinos o guardias es delito; atacar bandidos no. */
  onPlayerAggression(a: Actor): void {
    const g = this.g;
    if ((a.faction === 'villager' || a.faction === 'guard') && a.village) {
      const witnessed = g.npcs ? g.npcs.witnessesCrime(g.player.pos) || true : true;
      g.bus.emit('crime', { type: a.alive ? 'assault' : 'murder', village: a.village, witnessed });
    }
    if (a.faction === 'livestock' && a.village) g.bus.emit('crime', { type: 'livestock', village: a.village, witnessed: true });
  }

  private kickHit(): void {
    const g = this.g;
    this.hitThisSwing.add('kick');
    const f = g.player.forward(new THREE.Vector3()).setY(0).normalize();
    const probe = g.player.pos.clone().addScaledVector(f, 1.1);
    for (const a of g.registry.near(probe, 0.9, this.actorsTmp)) {
      a.takeHit({ amount: 4, type: 'blunt', zone: 'torso', attackerId: 'player', attackerFaction: 'player', from: g.player.pos.clone(), heavy: true, guardBreak: true, stagger: 0.8 });
      const c = a as Character;
      if (c.pos) c.pos.addScaledVector(f, 0.6);
      g.bus.emit('sfx', { id: 'kick', x: a.pos.x, y: a.pos.y + 1, z: a.pos.z });
      this.shake = 0.2;
      this.onPlayerAggression(a);
      return;
    }
    // Patada a objetos.
    const hit = g.physics.raycast(g.player.pos.x, g.player.pos.y + 0.5, g.player.pos.z, f.x, 0, f.z, 1.3, GROUP.PROP);
    if (hit) {
      const b = hit.collider.parent();
      if (b?.isDynamic()) b.applyImpulse({ x: f.x * 60, y: 20, z: f.z * 60 }, true);
      g.bus.emit('sfx', { id: 'kick' });
    }
  }

  // ------------------------------------------------------------ IA → objetivos

  /** Resuelve el golpe de un personaje de IA en el momento de impacto. */
  resolveNpcStrike(c: Character): void {
    const g = this.g;
    const w = c.weapon;
    const t = c.heavy ? w.heavy : w.light;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const reach = w.reach + 0.35;
    g.bus.emit('sfx', { id: c.heavy ? 'swing_heavy' : 'swing', x: c.pos.x, y: c.pos.y + 1.2, z: c.pos.z, volume: 0.7 });
    // Jugador.
    const pl = g.player;
    const playerHostile = hostile(c.faction, 'player', g.reputation.hostile(c.village ?? 'robledo'));
    if (playerHostile && !g.vitals.dead) {
      const dx = pl.pos.x - c.pos.x, dz = pl.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < reach && (dx * fx + dz * fz) / (d || 1) > 0.45 && Math.abs(pl.pos.y - c.pos.y) < 1.6) {
        this.hitPlayer(c, t.damage * (0.85 + c.skill * 0.3), w, c.heavy);
        return;
      }
    }
    // Otros actores hostiles.
    for (const a of g.registry.near(c.pos, reach + 0.5, this.actorsTmp)) {
      if (a === c || !a.alive || !hostile(c.faction, a.faction, false)) continue;
      const dx = a.pos.x - c.pos.x, dz = a.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + a.radius || (dx * fx + dz * fz) / (d || 1) < 0.45) continue;
      const zone: HitZone = Math.random() < 0.12 ? 'head' : Math.random() < 0.7 ? 'torso' : Math.random() < 0.5 ? 'arm' : 'leg';
      const res = a.takeHit({ amount: t.damage * (0.8 + c.skill * 0.3), type: w.type, zone, attackerId: c.id, attackerFaction: c.faction, from: c.pos.clone(), heavy: c.heavy, stagger: w.stagger });
      const hp = a.pos.clone().setY(a.pos.y + 1.2);
      g.bus.emit('sfx', { id: res.blocked ? 'clash' : 'hit_flesh', x: hp.x, y: hp.y, z: hp.z });
      g.particles.burst(res.blocked ? 'spark' : 'blood', hp.x, hp.y, hp.z, 8, 2.5);
      return;
    }
  }

  /** Daño al jugador con bloqueo, esquiva y armadura. */
  hitPlayer(attacker: { id: string; pos: THREE.Vector3; name?: string } | null, dmg: number, w: WeaponDef | null, heavy: boolean, type = w?.type ?? 'pierce'): void {
    const g = this.g;
    const pl = g.player;
    if (pl.iFrames > 0) {
      g.bus.emit('sfx', { id: 'dodge' });
      return;
    }
    const from = attacker?.pos ?? pl.pos;
    const eyeDirX = -Math.sin(pl.yaw), eyeDirZ = -Math.cos(pl.yaw);
    const dx = from.x - pl.pos.x, dz = from.z - pl.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const front = (eyeDirX * dx + eyeDirZ * dz) / d > 0.3;
    let amount = dmg;
    let blocked = false;
    if (this.state === 'block' && front && w) {
      const off = g.equipment.slots.off;
      const eff = off === 'shield' ? 0.95 : this.weapon.blockEff;
      const cost = dmg * eff * (off === 'shield' ? 0.45 : this.weapon.blockCost) * (heavy ? 1.4 : 1);
      g.vitals.useStamina(cost, true);
      if (g.vitals.stamina <= 0) {
        this.setState('stagger', 0.8);
        amount *= 0.6;
        g.bus.emit('notify', { text: '¡Te rompen la guardia!', kind: 'warning' });
      } else {
        amount *= 1 - eff;
        blocked = true;
      }
      g.bus.emit('sfx', { id: off === 'shield' ? 'block_wood' : 'clash', x: pl.pos.x, y: pl.pos.y + 1.4, z: pl.pos.z });
      const sp = pl.eyePosition(1, tmpB).addScaledVector(new THREE.Vector3(eyeDirX, 0, eyeDirZ), 0.6);
      g.particles.burst('spark', sp.x, sp.y - 0.2, sp.z, 10, 3);
      this.shake = Math.max(this.shake, 0.3);
    }
    if (!blocked) {
      const r = Math.random();
      const zone: HitZone = r < (heavy ? 0.18 : 0.08) ? 'head' : r < 0.7 ? 'torso' : r < 0.85 ? 'arm' : 'leg';
      amount *= HIT_ZONES[zone] * (zone === 'head' ? 0.7 : 1);
      const arm = g.equipment.armorValues();
      amount = applyArmor(amount, type, arm);
      if (type === 'slash' && amount > 12 && Math.random() < 0.35) g.vitals.bleeding = Math.max(g.vitals.bleeding, 8);
      if (this.state === 'windup' || this.state === 'draw') this.setState('stagger', 0.35);
      this.shake = Math.max(this.shake, 0.5);
      g.bus.emit('sfx', { id: 'hit_flesh', x: pl.pos.x, y: pl.pos.y + 1.2, z: pl.pos.z });
      g.bus.emit('sfx', { id: 'pain' });
    }
    g.vitals.hurt(amount);
    g.bus.emit('player:damaged', { amount, attackerId: attacker?.id ?? null, blocked });
  }

  // ------------------------------------------------------------ flechas

  private firePlayerArrow(power: number): void {
    const g = this.g;
    g.inventory.remove('arrow', 1);
    const eye = g.player.eyePosition(1, new THREE.Vector3());
    const dir = g.player.forward(new THREE.Vector3());
    const moving = Math.hypot(g.player.vel.x, g.player.vel.z) > 0.5 ? 0.02 : 0;
    const spread = (0.012 + moving) / g.skills.mul('archery') * (1.2 - power * 0.4);
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    this.spawnArrow(eye.addScaledVector(dir, 0.5), dir.multiplyScalar(BOW.arrowSpeed * (0.45 + power * 0.55)), 'player', 'player', BOW.arrowDamage * (0.35 + power * 0.65));
    g.bus.emit('sfx', { id: 'bow_release' });
    g.skills.add('archery', 0.5);
    this.shake = 0.1;
  }

  /** Disparo de un arquero de IA hacia un punto. */
  npcShoot(c: Character, target: THREE.Vector3, accuracy: number): void {
    const from = c.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    const to = target.clone();
    const dist = from.distanceTo(to);
    const speed = BOW.arrowSpeed * 0.85;
    const tFlight = dist / speed;
    to.y += 0.5 * 9.81 * tFlight * tFlight; // compensar caída
    const dir = to.sub(from).normalize();
    const spread = (1 - accuracy) * 0.08;
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread * 0.5; dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    this.spawnArrow(from.addScaledVector(dir, 0.5), dir.multiplyScalar(speed), c.id, c.faction, BOW.arrowDamage * 0.6);
    this.g.bus.emit('sfx', { id: 'bow_release', x: c.pos.x, y: c.pos.y + 1.5, z: c.pos.z });
  }

  private spawnArrow(pos: THREE.Vector3, vel: THREE.Vector3, shooter: string, faction: Faction, damage: number): void {
    const m = this.g.models.create('arrow').object;
    m.position.copy(pos);
    this.g.renderer.scene.add(m);
    this.arrows.push({ mesh: m, pos: pos.clone(), vel: vel.clone(), shooter, shooterFaction: faction, damage, life: 6 });
  }

  private updateArrows(dt: number): void {
    const g = this.g;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      const prev = a.pos.clone();
      a.vel.y -= 9.81 * dt;
      a.pos.addScaledVector(a.vel, dt);
      const seg = a.pos.clone().sub(prev);
      const len = seg.length();
      const dir = seg.clone().divideScalar(len || 1);
      let done = false;
      // Actores.
      const mid = prev.clone().addScaledVector(dir, len / 2);
      for (const act of g.registry.near(mid, len / 2 + 2, this.actorsTmp)) {
        if (act.id === a.shooter || !act.alive || !act.hitboxesValid) continue;
        if (a.shooterFaction !== 'player' && !hostile(a.shooterFaction, act.faction, false)) continue;
        for (const hb of act.hitboxes) {
          if (segmentSegmentDist3(prev, a.pos, hb.pos, hb.pos) < hb.r) {
            const speedK = a.vel.length() / BOW.arrowSpeed;
            const res = act.takeHit({ amount: a.damage * Math.min(1.1, speedK + 0.2), type: 'pierce', zone: hb.zone, attackerId: a.shooter, attackerFaction: a.shooterFaction, from: prev, heavy: false, stagger: 0.4 });
            g.bus.emit('sfx', { id: res.blocked ? 'block_wood' : 'arrow_hit', x: hb.pos.x, y: hb.pos.y, z: hb.pos.z });
            if (!res.blocked) g.particles.burst('blood', hb.pos.x, hb.pos.y, hb.pos.z, 8, 2);
            if (a.shooter === 'player') {
              g.bus.emit('actor:damaged', { targetId: act.id, attackerId: 'player', amount: res.applied, part: hb.zone, blocked: res.blocked });
              this.onPlayerAggression(act);
              if (hb.zone === 'head') g.skills.add('archery', 2);
            }
            done = true;
            break;
          }
        }
        if (done) break;
      }
      // Jugador (flechas enemigas).
      if (!done && a.shooter !== 'player') {
        const pp = g.player.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
        if (segmentSegmentDist3(prev, a.pos, pp, pp.clone().setY(pp.y + 0.6)) < 0.38) {
          this.hitPlayer({ id: a.shooter, pos: prev }, a.damage, null, false, 'pierce');
          done = true;
        }
      }
      // Mundo.
      if (!done) {
        const hit = g.physics.raycast(prev.x, prev.y, prev.z, dir.x, dir.y, dir.z, len, GROUP.TERRAIN | GROUP.STATIC | GROUP.PROP);
        if (hit) {
          g.bus.emit('sfx', { id: 'arrow_hit', x: hit.point.x, y: hit.point.y, z: hit.point.z, volume: 0.6 });
          if (hit.tag?.kind === 'tree' && a.shooter === 'player') g.treeFelling.damage(hit.tag.id, 2, prev);
          // La flecha queda clavada: se puede recuperar.
          if (a.shooter === 'player' && Math.random() < 0.8) {
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            const p = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z).addScaledVector(dir, -0.25);
            g.worldItems.spawn('arrow', p.x, p.y, p.z, { rot: q, frozen: true });
          }
          done = true;
        }
      }
      if (done || a.life <= 0 || a.pos.y < -50) {
        g.renderer.scene.remove(a.mesh);
        this.arrows.splice(i, 1);
        continue;
      }
      a.mesh.position.copy(a.pos);
      a.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.vel.clone().normalize());
    }
  }

  /** ¿Algún enemigo activo cerca del jugador? */
  enemiesNear(r: number): boolean {
    const g = this.g;
    for (const a of g.registry.near(g.player.pos, r, this.actorsTmp)) {
      if (hostile(a.faction, 'player', g.reputation.hostile(a.village ?? 'robledo'))) return true;
    }
    return false;
  }

  facing(a: Actor): number {
    return facingDot(a, this.g.player.pos);
  }
}
