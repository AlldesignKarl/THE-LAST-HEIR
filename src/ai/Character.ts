/**
 * Personaje humanoide controlado por IA (aldeanos, guardias, bandidos).
 * Movimiento cinemático siguiendo rutas del NavGraph, combate con fases
 * (preparación → golpe → recuperación), bloqueo y daño localizado.
 */
import * as THREE from 'three';
import { HumanoidModel, type Appearance, type AnimState, type Hitbox } from '../actors/HumanoidModel';
import type { Actor, Faction, HitInfo, HitResult } from '../actors/Actor';
import { facingDot } from '../actors/Actor';
import { WEAPONS, HIT_ZONES, applyArmor, type WeaponDef, type WeaponId } from '../combat/WeaponDefs';
import { Physics, RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import type { MaterialLibrary } from '../engine/placeholder/Materials';
import type { ModelLibrary } from '../engine/placeholder/Models';
import { damp, wrapAngle } from '../core/math';

export interface CombatTarget {
  id: string;
  pos: THREE.Vector3;
  alive: boolean;
  radius: number;
  /** El objetivo está preparando un golpe (para reaccionar bloqueando). */
  windingUp: boolean;
}

export type CombatPhase = 'none' | 'windup' | 'strike' | 'recover' | 'block' | 'stagger';

export interface CharacterOpts {
  id: string;
  name: string;
  kind: string;
  victimKind: string;
  faction: Faction;
  village: string | null;
  appearance: Appearance;
  weapon: WeaponId | null;
  shield?: boolean;
  health: number;
  /** 0..1 pericia en combate (reacción, precisión de tiempos). */
  skill: number;
  armor?: { slash: number; blunt: number; pierce: number };
}

export class Character implements Actor {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly victimKind: string;
  faction: Faction;
  readonly village: string | null;
  readonly model: HumanoidModel;
  readonly pos = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  yaw = 0;
  private renderYaw = 0;
  alive = true;
  health: number;
  maxHealth: number;
  readonly radius = 0.35;
  readonly height = 1.8;
  get hitboxes(): Hitbox[] { return this.model.hitboxes; }
  hitboxesValid = false;
  blocking = false;
  weapon: WeaponDef;
  shield: boolean;
  skill: number;
  armor: { slash: number; blunt: number; pierce: number };
  stamina = 100;
  // Movimiento.
  path: { x: number; z: number }[] = [];
  moveSpeed = 1.4;
  arrived = true;
  private stuckT = 0;
  private lastProgressPos = new THREE.Vector3();
  faceYaw: number | null = null;
  // Combate.
  phase: CombatPhase = 'none';
  phaseT = 0;
  heavy = false;
  attackCooldown = 1;
  private blockT = 0;
  staggerT = 0;
  private strafeDir = Math.random() < 0.5 ? -1 : 1;
  private strafeT = 0;
  /** Se ha lanzado el golpe en esta fase (evita dobles impactos). */
  struckThisSwing = false;
  // Estado general.
  lod = 0;
  visible = true;
  indoors = false;
  hasTorch = false;
  anim: AnimState = 'idle';
  collider: RAPIER.Collider | null = null;
  private body: RAPIER.RigidBody | null = null;
  lastAttacker: string | null = null;
  lastHitT = 99;
  /** Callbacks del gestor. */
  onStrike: ((c: Character) => void) | null = null;
  onDeath: ((c: Character, killer: string | null) => void) | null = null;
  onHurt: ((c: Character, attacker: string | null) => void) | null = null;

  constructor(o: CharacterOpts, mats: MaterialLibrary, private readonly models: ModelLibrary) {
    this.id = o.id;
    this.name = o.name;
    this.kind = o.kind;
    this.victimKind = o.victimKind;
    this.faction = o.faction;
    this.village = o.village;
    this.health = this.maxHealth = o.health;
    this.skill = o.skill;
    this.armor = o.armor ?? { slash: 0, blunt: 0, pierce: 0 };
    this.model = new HumanoidModel(o.appearance, mats);
    this.weapon = WEAPONS[o.weapon ?? 'fists'];
    this.shield = !!o.shield;
    this.setWeapon(o.weapon);
    if (o.shield) this.model.setOffhand(models, 'shield');
  }

  setWeapon(w: WeaponId | null): void {
    this.weapon = WEAPONS[w ?? 'fists'];
    const modelId = w ? (w === 'club' ? 'axe' : w === 'spear' ? 'sword' : WEAPONS[w].model) : null;
    this.model.setWeapon(this.models, modelId, w);
  }

  setTorch(on: boolean): void {
    if (on === this.hasTorch) return;
    this.hasTorch = on;
    if (!this.shield && this.weapon.id !== 'bow' && this.weapon.id !== 'spear') this.model.setOffhand(this.models, on ? 'torch' : null);
  }

  place(x: number, y: number, z: number, yaw = this.yaw): void {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.lastProgressPos.copy(this.pos);
    this.yaw = this.renderYaw = yaw;
    this.body?.setNextKinematicTranslation({ x, y: y + 0.9, z });
    this.body?.setTranslation({ x, y: y + 0.9, z }, true);
  }

  /** Collider cinemático (solo en LOD cercano). */
  ensureCollider(physics: Physics, on: boolean): void {
    if (on && !this.body && this.alive) {
      this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y + 0.9, this.pos.z));
      this.collider = physics.world.createCollider(
        RAPIER.ColliderDesc.capsule(0.5, 0.32).setCollisionGroups(groups(GROUP.ACTOR, ALL & ~GROUP.ACTOR & ~GROUP.TERRAIN & ~GROUP.STATIC)),
        this.body,
      );
      physics.tag(this.collider, { kind: 'actor', id: this.id });
    } else if (!on && this.body) {
      physics.removeBody(this.body);
      this.body = null;
      this.collider = null;
    }
  }

  setPath(p: { x: number; z: number }[], speed: number): void {
    this.path = p;
    this.moveSpeed = speed;
    this.arrived = p.length === 0;
    this.stuckT = 0;
  }

  stop(): void {
    this.path = [];
    this.arrived = true;
  }

  get isWindingUp(): boolean {
    return this.phase === 'windup';
  }

  get combatBusy(): boolean {
    return this.phase === 'windup' || this.phase === 'strike' || this.phase === 'recover' || this.phase === 'stagger';
  }

  /**
   * Avanza el movimiento. `ground` da la altura; `avoid` devuelve un empuje
   * lateral (separación, árboles, muros).
   */
  move(dt: number, ground: (x: number, z: number) => number, avoid: (c: Character, out: THREE.Vector3) => THREE.Vector3): number {
    this.prevPos.copy(this.pos);
    if (!this.alive) return 0;
    let speed = 0;
    if (this.staggerT > 0 || this.phase === 'strike' || this.phase === 'stagger') {
      // Sin desplazamiento controlado.
    } else if (this.path.length) {
      const t = this.path[0];
      const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const reach = this.path.length === 1 ? 0.35 : 0.9;
      if (d < reach) {
        this.path.shift();
        if (!this.path.length) this.arrived = true;
      } else {
        const push = avoid(this, new THREE.Vector3());
        let vx = (dx / d) * this.moveSpeed + push.x;
        let vz = (dz / d) * this.moveSpeed + push.z;
        const vl = Math.hypot(vx, vz);
        const maxV = this.moveSpeed * (this.phase === 'windup' ? 0.3 : 1);
        if (vl > maxV) { vx *= maxV / vl; vz *= maxV / vl; }
        this.pos.x += vx * dt;
        this.pos.z += vz * dt;
        speed = Math.hypot(vx, vz);
        if (speed > 0.1) this.yaw = this.turnTowards(Math.atan2(vx, vz), dt, 8);
      }
      // Detección de atasco: si no avanza, saltar al siguiente punto.
      this.stuckT += dt;
      if (this.stuckT > 2.5) {
        if (this.pos.distanceTo(this.lastProgressPos) < 0.6 && this.path.length) {
          this.path.shift();
          if (!this.path.length) this.arrived = true;
        }
        this.stuckT = 0;
        this.lastProgressPos.copy(this.pos);
      }
    } else {
      const push = avoid(this, new THREE.Vector3());
      if (push.lengthSq() > 0.01) {
        this.pos.x += push.x * dt * 0.5;
        this.pos.z += push.z * dt * 0.5;
      }
    }
    if (this.faceYaw !== null && (this.arrived || this.phase !== 'none')) this.yaw = this.turnTowards(this.faceYaw, dt, 6);
    this.pos.y = ground(this.pos.x, this.pos.z);
    return speed;
  }

  private turnTowards(target: number, dt: number, rate: number): number {
    const diff = wrapAngle(target - this.yaw);
    return this.yaw + Math.max(-rate * dt, Math.min(rate * dt, diff));
  }

  /** Comportamiento de combate cuerpo a cuerpo contra un objetivo. */
  fight(dt: number, tgt: CombatTarget, setPathTo: (x: number, z: number, speed: number) => void): void {
    const dx = tgt.pos.x - this.pos.x, dz = tgt.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    this.faceYaw = Math.atan2(dx, dz);
    const reach = this.weapon.reach + tgt.radius - 0.1;
    this.attackCooldown -= dt;
    this.strafeT -= dt;
    if (this.combatBusy) return;
    // Bloqueo reactivo.
    if (this.phase === 'block') {
      this.blockT -= dt;
      if (this.blockT <= 0 || !tgt.windingUp) { this.phase = 'none'; this.blocking = false; }
      return;
    }
    if (tgt.windingUp && d < reach + 1 && Math.random() < this.skill * 0.08 && this.stamina > 15 && this.weapon.blockEff > 0.3) {
      this.phase = 'block';
      this.blocking = true;
      this.blockT = 0.6 + Math.random() * 0.5;
      this.stop();
      return;
    }
    if (d > reach * 0.9) {
      setPathTo(tgt.pos.x - (dx / d) * reach * 0.7, tgt.pos.z - (dz / d) * reach * 0.7, d > 6 ? 3.9 : 2.2);
      return;
    }
    // En rango.
    if (this.attackCooldown <= 0 && this.stamina > 12) {
      this.startAttack(Math.random() < 0.25 + this.skill * 0.15);
      return;
    }
    // Rodear al objetivo mientras espera.
    if (this.strafeT <= 0) {
      this.strafeT = 1 + Math.random() * 1.5;
      if (Math.random() < 0.3) this.strafeDir *= -1;
    }
    const px = -dz / d, pz = dx / d;
    const back = d < reach * 0.55 ? -0.8 : 0;
    setPathTo(this.pos.x + px * this.strafeDir * 1.2 + (dx / d) * back, this.pos.z + pz * this.strafeDir * 1.2 + (dz / d) * back, 1.1);
  }

  startAttack(heavy: boolean): void {
    const t = heavy ? this.weapon.heavy : this.weapon.light;
    if (this.stamina < t.stamina * 0.5) return;
    this.stamina -= t.stamina * 0.6;
    this.heavy = heavy;
    this.phase = 'windup';
    // Los enemigos telegrafían algo más que el jugador (legibilidad).
    this.phaseT = t.windup * 1.35;
    this.struckThisSwing = false;
    this.blocking = false;
    this.stop();
  }

  /** Actualiza fases de combate y animación. */
  updateCombat(dt: number): void {
    this.lastHitT += dt;
    this.stamina = Math.min(100, this.stamina + dt * (this.phase === 'none' ? 14 : 5));
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      if (this.staggerT <= 0 && this.phase === 'stagger') this.phase = 'none';
    }
    if (this.phase === 'windup' || this.phase === 'strike' || this.phase === 'recover') {
      const t = this.heavy ? this.weapon.heavy : this.weapon.light;
      this.phaseT -= dt;
      if (this.phase === 'windup') {
        this.model.attackProgress = 1 - Math.max(0, this.phaseT) / (t.windup * 1.35);
        if (this.phaseT <= 0) { this.phase = 'strike'; this.phaseT = t.active; this.struckThisSwing = false; }
      } else if (this.phase === 'strike') {
        this.model.attackProgress = 1 - Math.max(0, this.phaseT) / t.active;
        if (!this.struckThisSwing && this.model.attackProgress > 0.4) {
          this.struckThisSwing = true;
          this.onStrike?.(this);
        }
        if (this.phaseT <= 0) { this.phase = 'recover'; this.phaseT = t.recovery; }
      } else if (this.phaseT <= 0) {
        this.phase = 'none';
        this.attackCooldown = 0.6 + Math.random() * (1.6 - this.skill);
      } else this.model.attackProgress = 1 - this.phaseT / t.recovery;
    }
    this.model.heavy = this.heavy;
  }

  takeHit(h: HitInfo): HitResult {
    if (!this.alive) return { applied: 0, blocked: false, killed: false };
    this.lastAttacker = h.attackerId;
    this.lastHitT = 0;
    let amount = h.amount;
    let blocked = false;
    const front = facingDot(this, h.from) > 0.35;
    if (this.blocking && front && !h.guardBreak) {
      const eff = this.shield ? 0.95 : this.weapon.blockEff;
      const cost = amount * eff * (this.shield ? 0.4 : this.weapon.blockCost);
      this.stamina -= cost;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.blocking = false;
        this.phase = 'stagger';
        this.staggerT = 0.9;
        amount *= 0.5;
      } else {
        amount *= 1 - eff;
        blocked = true;
      }
    } else if (h.guardBreak && this.blocking) {
      this.blocking = false;
      this.phase = 'stagger';
      this.staggerT = 1.0;
    }
    amount *= HIT_ZONES[h.zone];
    if (h.zone === 'head' && this.model.app.helmet) amount *= 0.6;
    amount = applyArmor(amount, h.type, this.armor);
    this.health -= amount;
    if (!blocked && h.stagger > 0 && amount > 8) {
      // Un golpe interrumpe la preparación del ataque.
      if (this.phase === 'windup' || h.heavy) { this.phase = 'stagger'; this.staggerT = h.stagger; }
      this.model.setState('hit');
    }
    if (h.zone === 'leg' && !blocked) this.moveSpeed *= 0.8;
    const killed = this.health <= 0;
    if (killed) this.die(h.attackerId);
    else this.onHurt?.(this, h.attackerId);
    return { applied: amount, blocked, killed };
  }

  die(killer: string | null): void {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.blocking = false;
    this.phase = 'none';
    this.stop();
    this.model.setState('dead');
    this.onDeath?.(this, killer);
  }

  /** Elige animación según estado. */
  chooseAnim(speed: number, idleAnim: AnimState): void {
    if (!this.alive) { this.model.setState('dead'); return; }
    let s: AnimState;
    if (this.phase === 'windup') s = 'windup';
    else if (this.phase === 'strike') s = 'strike';
    else if (this.phase === 'recover') s = 'recover';
    else if (this.phase === 'block') s = 'block';
    else if (this.phase === 'stagger') s = 'hit';
    else if (speed > 2.6) s = 'run';
    else if (speed > 0.25) s = 'walk';
    else s = idleAnim;
    if (this.model.state === 'hit' && this.lastHitT < 0.3 && s !== 'windup') s = 'hit';
    this.model.speed = speed;
    this.model.setState(s);
  }

  /** Sincroniza la malla (interpolada) y el collider. */
  syncVisual(alpha: number, dt: number): void {
    const r = this.model.root;
    r.position.lerpVectors(this.prevPos, this.pos, alpha);
    this.renderYaw = this.renderYaw + wrapAngle(this.yaw - this.renderYaw) * Math.min(1, dt * 12);
    r.rotation.y = this.renderYaw;
    r.visible = this.visible && !this.indoors;
    void damp;
  }

  syncCollider(): void {
    if (this.body) this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z });
  }
}
