/**
 * Selección de objetivos de combate y percepción compartida por la IA.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Character, CombatTarget } from './Character';
import { hostile, type Actor } from '../actors/Actor';

const tmp: Actor[] = [];
const losCache = new Map<string, { t: number; ok: boolean }>();

/** Línea de visión con caché (evita raycasts cada tick). */
export function canSee(g: Game, from: THREE.Vector3, to: THREE.Vector3, key: string, now: number): boolean {
  const c = losCache.get(key);
  if (c && now - c.t < 0.5) return c.ok;
  const ok = g.physics.lineOfSight(from.x, from.y + 1.6, from.z, to.x, to.y + 1.2, to.z);
  losCache.set(key, { t: now, ok });
  return ok;
}

/** Distancia de visión según luz, clima y si el objetivo lleva antorcha. */
export function sightRange(g: Game, targetIsPlayer: boolean): number {
  const night = g.time.nightFactor;
  let r = 40 * (1 - night * 0.7) * g.weather.visibility;
  if (targetIsPlayer && g.equipment.torchLit) r = Math.max(r, 45);
  if (targetIsPlayer && g.player.crouching) r *= 0.6;
  return r;
}

export function playerTarget(g: Game): CombatTarget {
  return { id: 'player', pos: g.player.pos, alive: !g.vitals.dead, radius: 0.35, windingUp: g.combat.playerWindingUp };
}

export function actorTarget(a: Actor): CombatTarget {
  const c = a as Character;
  return { id: a.id, pos: a.pos, alive: a.alive, radius: a.radius, windingUp: !!c.isWindingUp };
}

/** Objetivo hostil más cercano visible en `range`. */
export function findTarget(g: Game, c: Character, range: number, now: number): CombatTarget | null {
  let best: CombatTarget | null = null;
  let bestD = range;
  const wanted = c.village ? g.reputation.hostile(c.village) : false;
  if (hostile(c.faction, 'player', wanted) && !g.vitals.dead) {
    const d = c.pos.distanceTo(g.player.pos);
    const r = Math.min(range, sightRange(g, true) + (c.lastAttacker === 'player' ? 20 : 0));
    if (d < r && (d < 4 || canSee(g, c.pos, g.player.pos, `${c.id}>player`, now))) {
      best = playerTarget(g);
      bestD = d;
    }
  }
  for (const a of g.registry.near(c.pos, range, tmp)) {
    if (a === c || !a.alive || !hostile(c.faction, a.faction, false)) continue;
    const d = c.pos.distanceTo(a.pos);
    if (d >= bestD) continue;
    if (d > 4 && !canSee(g, c.pos, a.pos, `${c.id}>${a.id}`, now)) continue;
    best = actorTarget(a);
    bestD = d;
  }
  return best;
}
