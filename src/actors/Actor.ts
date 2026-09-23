/**
 * Contrato común de todo lo que puede recibir golpes (NPCs, bandidos,
 * animales) y registro de actores vivos para combate y percepción.
 */
import * as THREE from 'three';
import type { DamageType, HitZone } from '../combat/WeaponDefs';
import type { Hitbox } from './HumanoidModel';

export type Faction = 'player' | 'villager' | 'guard' | 'bandit' | 'predator' | 'prey' | 'livestock';

export interface HitInfo {
  amount: number;
  type: DamageType;
  zone: HitZone;
  attackerId: string | null;
  attackerFaction: Faction;
  from: THREE.Vector3;
  heavy: boolean;
  /** Rompe la guardia (patada, golpe muy fuerte). */
  guardBreak?: boolean;
  stagger: number;
}

export interface HitResult {
  applied: number;
  blocked: boolean;
  killed: boolean;
}

export interface Actor {
  id: string;
  kind: string;
  /** Tipo para misiones/estadísticas (p.ej. 'bandit', 'wolf', 'deer'). */
  victimKind: string;
  faction: Faction;
  village: string | null;
  name: string;
  pos: THREE.Vector3;
  yaw: number;
  alive: boolean;
  health: number;
  maxHealth: number;
  radius: number;
  height: number;
  /** Actualizado por su gestor cuando está cerca (LOD completo). */
  hitboxes: Hitbox[];
  hitboxesValid: boolean;
  blocking: boolean;
  takeHit(h: HitInfo): HitResult;
}

export function facingDot(a: { pos: THREE.Vector3; yaw: number }, from: THREE.Vector3): number {
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const dx = from.x - a.pos.x, dz = from.z - a.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  return (fx * dx + fz * dz) / l;
}

/** ¿Debe `a` atacar a `b`? `wantedBy` = pueblos cuyos guardias persiguen al jugador. */
export function hostile(a: Faction, b: Faction, playerWanted: boolean): boolean {
  if (a === b) return false;
  switch (a) {
    case 'bandit': return b === 'player' || b === 'villager' || b === 'guard';
    case 'predator': return b === 'player' || b === 'villager' || b === 'guard' || b === 'prey' || b === 'livestock' || b === 'bandit';
    case 'guard': return b === 'bandit' || b === 'predator' || (b === 'player' && playerWanted);
    case 'villager': return false;
    case 'player': return false;
    default: return false;
  }
}

export class ActorRegistry {
  readonly actors = new Map<string, Actor>();

  add(a: Actor): void {
    this.actors.set(a.id, a);
  }

  remove(id: string): void {
    this.actors.delete(id);
  }

  get(id: string): Actor | undefined {
    return this.actors.get(id);
  }

  /** Actores vivos en un radio. */
  near(p: THREE.Vector3, r: number, out: Actor[] = []): Actor[] {
    out.length = 0;
    const r2 = r * r;
    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      const dx = a.pos.x - p.x, dz = a.pos.z - p.z;
      if (dx * dx + dz * dz <= r2) out.push(a);
    }
    return out;
  }
}
