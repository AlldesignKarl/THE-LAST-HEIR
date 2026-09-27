/**
 * Remate sigiloso por la espalda.
 *
 * Si te acercas por detrás a alguien que no te ha visto (sin combatir ni
 * huir), con [G]:
 *  - con cuchillo, espada, hacha o lanza en la mano: le sujetas la frente y
 *    le degüellas; se lleva las manos al cuello, cae de rodillas y muere
 *    desangrándose en segundos;
 *  - con las manos desnudas: le rompes el cuello de un giro seco.
 * La víctima queda inmóvil durante la animación. Las consecuencias son las
 * de cualquier asesinato: si alguien lo ve, corre a contarlo; si no, solo
 * se sabrá si encuentran el cuerpo.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { Character } from '../ai/Character';
import { itemDef } from '../data/items';
import { wrapAngle } from '../core/math';

export type TakedownKind = 'throat' | 'neck';

const BLADES = new Set(['knife', 'sword', 'axe', 'spear']);
const DUR: Record<TakedownKind, number> = { throat: 1.7, neck: 1.35 };
/** Momento del tajo o del giro. */
const HIT: Record<TakedownKind, number> = { throat: 0.6, neck: 0.66 };

interface Active { c: Character; kind: TakedownKind; t: number; done: boolean; from: THREE.Vector3; yaw: number }

export class Takedown {
  active: Active | null = null;
  /** Víctima posible ahora mismo (para el aviso en pantalla). */
  candidate: { c: Character; kind: TakedownKind } | null = null;
  private tmp: import('../actors/Actor').Actor[] = [];

  constructor(private readonly g: Game) {}

  /** Tipo de remate según lo que llevas en la mano (null si no se puede). */
  kindForHands(): TakedownKind | null {
    const main = this.g.equipment.slots.main;
    if (!main) return 'neck';
    const w = itemDef(main).weapon;
    return w && BLADES.has(w) ? 'throat' : null;
  }

  /** Busca a alguien de espaldas, al alcance y desprevenido. */
  private findCandidate(): { c: Character; kind: TakedownKind } | null {
    const g = this.g;
    if (g.vitals.dead || g.interaction.dragging || g.interaction.carried || g.boats.riding || g.player.swimming) return null;
    if (g.combat.state !== 'idle' && g.combat.state !== 'ready') return null;
    const kind = this.kindForHands();
    if (!kind) return null;
    const p = g.player.pos;
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
    let best: Character | null = null, bestD = 1e9;
    for (const a of g.registry.near(p, 1.9, this.tmp)) {
      if (!(a instanceof Character)) continue;
      const c = a;
      if (!c.alive || c.downed || c.seized || c.carryPose || c.indoors && !c.homeShown) continue;
      if (c.phase !== 'none' || c.blocking) continue;
      const npc = g.npcs.get(c.id);
      if (npc && (npc.state === 'fight' || npc.state === 'flee' || npc.state === 'report' || npc.talking)) continue;
      if (Math.abs(c.pos.y - p.y) > 0.7) continue;
      const dx = c.pos.x - p.x, dz = c.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.6 || d < 0.2) continue;
      // Que le mires a él…
      if ((dx * fx + dz * fz) / d < 0.7) continue;
      // …y que estés a su espalda (él mira hacia el otro lado).
      const cf = { x: Math.sin(c.yaw), z: Math.cos(c.yaw) };
      if ((-dx * cf.x - dz * cf.z) / d > -0.35) continue;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best ? { c: best, kind } : null;
  }

  /** Cada tick: aviso y tecla. Devuelve true si el remate bloquea el resto. */
  update(dt: number): boolean {
    const g = this.g;
    if (this.active) {
      this.step(dt);
      return true;
    }
    this.candidate = this.findCandidate();
    if (this.candidate && g.input.wasPressed('takedown')) {
      this.start(this.candidate.c, this.candidate.kind);
      return true;
    }
    return false;
  }

  start(c: Character, kind: TakedownKind): void {
    const g = this.g;
    this.candidate = null;
    c.seized = 'seized';
    c.stop();
    c.phase = 'none';
    c.faceYaw = null;
    const npc = g.npcs.get(c.id);
    if (npc) npc.talking = false;
    // La víctima mira hacia donde miras tú, pegada delante de ti.
    const yaw = wrapAngle(g.player.yaw + Math.PI);
    this.active = { c, kind, t: 0, done: false, from: c.pos.clone(), yaw };
    g.viewmodel.play(kind === 'throat' ? 'throat' : 'necksnap');
    g.bus.emit('sfx', { id: 'grab_heavy', volume: 0.7 });
    g.bus.emit('sfx', { id: 'pain', x: c.pos.x, y: c.pos.y + 1.5, z: c.pos.z, volume: 0.35 });
  }

  private step(dt: number): void {
    const g = this.g;
    const A = this.active!;
    const c = A.c;
    A.t += dt;
    // Primeros 0,25 s: la víctima queda sujeta delante del jugador.
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
    const hold = new THREE.Vector3(g.player.pos.x + fx * 0.62, c.pos.y, g.player.pos.z + fz * 0.62);
    // La mirada va al cuello de la víctima (ahí están las manos).
    if (!A.done || A.t < HIT[A.kind] + 0.3) {
      const eye = g.player.eyePosition(1, new THREE.Vector3());
      const n = c.model.neckWorld(new THREE.Vector3());
      const want = Math.atan2(n.y - 0.05 - eye.y, Math.max(0.3, Math.hypot(n.x - eye.x, n.z - eye.z)));
      g.player.pitch += (want - g.player.pitch) * Math.min(1, dt * 10);
    }
    if (!A.done) {
      const k = Math.min(1, A.t / 0.25);
      c.pos.lerpVectors(A.from, hold, k * k * (3 - 2 * k));
      c.pos.y = g.worldItems.groundAt?.(c.pos.x, c.pos.y + 0.4, c.pos.z) ?? c.pos.y;
      c.yaw = A.yaw;
      c.prevPos.copy(c.pos);
    }
    if (!A.done && A.t >= HIT[A.kind]) {
      A.done = true;
      this.kill(A);
    }
    if (A.t >= DUR[A.kind]) {
      this.active = null;
      c.seized = null;
      g.player.forceCrouch = false;
    } else if (A.done && A.kind === 'throat') {
      // Se desploma de rodillas agarrándose el cuello.
      g.player.forceCrouch = A.t > 1.0;
    }
  }

  private kill(A: Active): void {
    const g = this.g;
    const c = A.c;
    const neck = c.model.neckWorld(new THREE.Vector3());
    const dir = { x: -Math.sin(g.player.yaw), y: 0.1, z: -Math.cos(g.player.yaw) };
    if (A.kind === 'throat') {
      g.wounds.throatCut(c, dir);
      c.seized = 'throat';
      g.bus.emit('sfx', { id: 'hit_flesh', x: neck.x, y: neck.y, z: neck.z, volume: 1 });
      c.lastAttacker = 'player';
      c.health = 0;
      // Muere al terminar de caer (unos instantes después del tajo).
      setTimeoutTicks(g, 0.75, () => { c.seized = null; if (c.alive) c.die('player'); g.combat.onPlayerAggression(c); });
    } else {
      c.model.neckBroken = true;
      g.bus.emit('sfx', { id: 'neck_snap', x: neck.x, y: neck.y, z: neck.z, volume: 1 });
      c.lastAttacker = 'player';
      c.seized = null;
      c.die('player');
      g.combat.onPlayerAggression(c);
    }
    g.combat.shake = Math.max(g.combat.shake, 0.12);
    g.skills.add('combat', 2);
  }
}

/** Llama a `fn` pasados `sec` segundos de juego (en ticks de lógica). */
function setTimeoutTicks(g: Game, sec: number, fn: () => void): void {
  g.later(sec, fn);
}
