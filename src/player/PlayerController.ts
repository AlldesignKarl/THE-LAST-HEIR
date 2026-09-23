/**
 * Controlador de movimiento en primera persona.
 * Cápsula cinemática de Rapier con KinematicCharacterController:
 * escalones, pendientes, ajuste al suelo y empuje de objetos dinámicos.
 */
import * as THREE from 'three';
import { Physics, RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import type { Input } from '../core/Input';
import type { Vitals } from '../survival/Vitals';
import type { Heightfield, Surface } from '../world/Heightfield';
import type { EventBus } from '../core/EventBus';
import { clamp, damp } from '../core/math';

export const PLAYER_RADIUS = 0.34;
export const PLAYER_HALF = 0.56; // mitad del cilindro de la cápsula
export const EYE_HEIGHT = 1.64;
const CROUCH_EYE = 1.1;

export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  /** Posición de los pies (tick actual y anterior, para interpolar). */
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  crouching = false;
  sprinting = false;
  inWater = false;
  /** Multiplicador de velocidad externo (carga, heridas, transporte). */
  speedMul = 1;
  /** Bloquea el movimiento (menús, dormir, escalar). */
  frozen = false;
  /** Invulnerabilidad breve de la esquiva. */
  iFrames = 0;
  private dodgeTime = 0;
  private dodgeDir = new THREE.Vector3();
  private stepAcc = 0;
  private fallStartY = 0;
  private airTime = 0;
  eyeHeight = EYE_HEIGHT;
  bobPhase = 0;
  bobAmount = 0;
  surface: Surface = 'grass';
  /** Superficie forzada (interiores de madera, cueva). */
  surfaceOverride: Surface | null = null;
  /** Ruido que genera el jugador (para percepción de la IA), 0..1. */
  noise = 0;
  /** Esfuerzo físico actual 0..1 (para necesidades). */
  exertion = 0;
  /** Bloqueo de sprint por acciones de combate. */
  combatBusy = false;

  constructor(
    physics: Physics,
    private readonly input: Input,
    private readonly vitals: Vitals,
    private readonly hf: Heightfield,
    private readonly bus: EventBus,
  ) {
    const bd = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 50, 0);
    this.body = physics.world.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.capsule(PLAYER_HALF, PLAYER_RADIUS)
      .setCollisionGroups(groups(GROUP.PLAYER, GROUP.TERRAIN | GROUP.STATIC | GROUP.PROP | GROUP.ACTOR))
      .setFriction(0);
    this.collider = physics.world.createCollider(cd, this.body);
    physics.tag(this.collider, { kind: 'player', id: 'player' });
    this.cc = physics.world.createCharacterController(0.03);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.enableAutostep(0.42, 0.2, true);
    this.cc.enableSnapToGround(0.45);
    this.cc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((58 * Math.PI) / 180);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(75);
    this.cc.setSlideEnabled(true);
  }

  teleport(x: number, y: number, z: number, yaw?: number): void {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.body.setTranslation({ x, y: y + PLAYER_HALF + PLAYER_RADIUS, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + PLAYER_HALF + PLAYER_RADIUS, z });
    if (yaw !== undefined) this.yaw = yaw;
    this.fallStartY = y;
  }

  /** Mirar: se llama cada frame (no cada tick) para suavidad. */
  look(dx: number, dy: number, sensitivity: number): void {
    if (this.frozen) return;
    this.yaw -= dx * sensitivity;
    this.pitch = clamp(this.pitch - dy * sensitivity, -1.45, 1.45);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt: number): void {
    this.prevPos.copy(this.pos);
    const inp = this.input;
    const v = this.vitals;
    let mx = 0, mz = 0;
    if (!this.frozen) {
      if (inp.isDown('forward')) mz -= 1;
      if (inp.isDown('back')) mz += 1;
      if (inp.isDown('left')) mx -= 1;
      if (inp.isDown('right')) mx += 1;
    }
    let len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    else if (!this.frozen) {
      // Joystick táctil: conserva la magnitud (inclinación parcial = andar despacio).
      const a = inp.analogMove();
      mx = a.x;
      mz = -a.y;
      len = Math.hypot(mx, mz);
    }
    // A espacio mundo según yaw.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = mx * cos + mz * sin;
    const wz = -mx * sin + mz * cos;

    this.crouching = !this.frozen && inp.isDown('crouch');
    const wantsSprint = !this.frozen && inp.isDown('sprint') && mz < -0.5 && !this.crouching && !this.combatBusy;
    this.sprinting = false;
    let speed = 3.3;
    if (this.crouching) speed = 1.6;
    else if (wantsSprint && v.stamina > 1 && this.speedMul > 0.6) {
      if (v.drainStamina(11, dt)) {
        speed = 6.0;
        this.sprinting = true;
      }
    }
    if (this.inWater) speed *= 0.6;
    speed *= this.speedMul;

    // Esquiva.
    if (!this.frozen && inp.wasPressed('dodge') && this.grounded && this.dodgeTime <= 0 && v.useStamina(18)) {
      this.dodgeTime = 0.28;
      this.iFrames = 0.22;
      if (len > 0.05) this.dodgeDir.set(wx, 0, wz).normalize();
      else this.dodgeDir.set(sin, 0, cos); // hacia atrás
      this.bus.emit('sfx', { id: 'dodge' });
    }
    this.iFrames = Math.max(0, this.iFrames - dt);

    const targetVX = wx * speed, targetVZ = wz * speed;
    const accel = this.grounded ? 11 : 2;
    this.vel.x = damp(this.vel.x, targetVX, accel, dt);
    this.vel.z = damp(this.vel.z, targetVZ, accel, dt);
    if (this.dodgeTime > 0) {
      this.dodgeTime -= dt;
      this.vel.x = this.dodgeDir.x * 7.5;
      this.vel.z = this.dodgeDir.z * 7.5;
    }

    // Salto y gravedad.
    if (this.grounded) {
      this.vel.y = -1;
      if (!this.frozen && inp.wasPressed('jump') && !this.crouching && v.useStamina(12)) {
        this.vel.y = 4.8;
        this.grounded = false;
        this.bus.emit('sfx', { id: 'jump' });
      }
    } else {
      this.vel.y -= 18 * dt;
      if (this.vel.y < -40) this.vel.y = -40;
    }

    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.cc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(ALL, GROUP.TERRAIN | GROUP.STATIC | GROUP.PROP | GROUP.ACTOR));
    const mv = this.cc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.cc.computedGrounded();
    const t = this.body.translation();
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.pos.set(nx, ny - PLAYER_HALF - PLAYER_RADIUS, nz);

    // Seguridad: nunca por debajo del terreno (salvo en la cueva, que está bajo él).
    const ground = this.hf.heightAt(nx, nz);
    if (!this.hf.isHole(nx, nz) && this.pos.y < ground - 3 && !this.underground) {
      this.teleport(nx, ground + 0.2, nz);
    }

    // Aterrizaje / daño por caída.
    if (!this.grounded) {
      this.airTime += dt;
      if (wasGrounded) this.fallStartY = this.pos.y;
      this.fallStartY = Math.max(this.fallStartY, this.pos.y);
    } else if (!wasGrounded) {
      const fall = this.fallStartY - this.pos.y;
      if (fall > 4.5) {
        const dmg = (fall - 4.5) * 9;
        v.hurt(dmg);
        this.bus.emit('player:damaged', { amount: dmg, attackerId: null, blocked: false });
      }
      if (this.airTime > 0.25) this.bus.emit('sfx', { id: 'land', volume: clamp(fall / 4, 0.3, 1) });
      this.airTime = 0;
    }

    // Agua.
    const wl = this.hf.waterLevelAt(this.pos.x, this.pos.z);
    this.inWater = wl !== null && this.pos.y < wl - 0.15;

    // Superficie y pasos.
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.surface = this.surfaceOverride ?? (this.inWater ? 'water' : this.hf.surfaceAt(this.pos.x, this.pos.z));
    if (this.grounded && hSpeed > 0.5) {
      this.stepAcc += hSpeed * dt;
      const stride = this.sprinting ? 1.9 : this.crouching ? 0.9 : 1.45;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        const vol = this.crouching ? 0.25 : this.sprinting ? 1 : 0.6;
        this.bus.emit('sfx', { id: `step_${this.surface}`, volume: vol });
      }
      this.bobPhase += hSpeed * dt * (this.sprinting ? 1.25 : 1.6);
    }
    this.bobAmount = damp(this.bobAmount, this.grounded ? clamp(hSpeed / 6, 0, 1) : 0, 8, dt);
    this.eyeHeight = damp(this.eyeHeight, this.crouching ? CROUCH_EYE : EYE_HEIGHT, 10, dt);
    this.noise = this.sprinting ? 1 : this.crouching ? 0.1 : hSpeed > 0.5 ? 0.45 : 0.05;
    this.exertion = this.sprinting ? 1 : hSpeed > 0.5 ? 0.2 : 0;
  }

  /** Está dentro de la cueva (bajo el terreno). Lo fija el sistema de cueva. */
  underground = false;

  /** Posición de los ojos interpolada. */
  eyePosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(this.prevPos, this.pos, alpha);
    out.y += this.eyeHeight + Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    return out;
  }
}
