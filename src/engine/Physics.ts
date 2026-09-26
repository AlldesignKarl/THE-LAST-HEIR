/**
 * Mundo físico (Rapier). Centraliza grupos de colisión, etiquetas de
 * colliders (qué objeto de juego es cada collider) y consultas.
 */
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

export const GROUP = {
  TERRAIN: 1 << 0,
  STATIC: 1 << 1,
  PROP: 1 << 2,
  PLAYER: 1 << 3,
  ACTOR: 1 << 4,
  TRIGGER: 1 << 5,
  CARRIED: 1 << 6,
} as const;

export const ALL = 0xffff;

/** Grupos de interacción de Rapier: 16 bits de pertenencia + 16 de filtro. */
export const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

export type ColliderTagKind =
  | 'terrain' | 'building' | 'static' | 'prop' | 'item' | 'door' | 'interactable'
  | 'tree' | 'actor' | 'player' | 'cave' | 'rock' | 'build' | 'boat';

export interface ColliderTag {
  kind: ColliderTagKind;
  id: string;
}

export interface RayHit {
  collider: RAPIER.Collider;
  toi: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  tag: ColliderTag | undefined;
}

export class Physics {
  readonly world: RAPIER.World;
  private tags = new Map<number, ColliderTag>();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  static async init(): Promise<void> {
    await RAPIER.init();
  }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 30;
    this.world.integrationParameters.numSolverIterations = 4;
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  tag(c: RAPIER.Collider, tag: ColliderTag): void {
    this.tags.set(c.handle, tag);
  }

  tagOf(c: RAPIER.Collider): ColliderTag | undefined {
    return this.tags.get(c.handle);
  }

  removeCollider(c: RAPIER.Collider): void {
    this.tags.delete(c.handle);
    this.world.removeCollider(c, false);
  }

  removeBody(b: RAPIER.RigidBody): void {
    for (let i = 0; i < b.numColliders(); i++) this.tags.delete(b.collider(i).handle);
    this.world.removeRigidBody(b);
  }

  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
    filter: number = ALL,
    exclude?: RAPIER.Collider,
    excludeBody?: RAPIER.RigidBody,
  ): RayHit | null {
    this.ray.origin = { x: ox, y: oy, z: oz };
    this.ray.dir = { x: dx, y: dy, z: dz };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, groups(ALL, filter), exclude, excludeBody);
    if (!hit) return null;
    const toi = hit.timeOfImpact;
    return {
      collider: hit.collider,
      toi,
      point: { x: ox + dx * toi, y: oy + dy * toi, z: oz + dz * toi },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      tag: this.tags.get(hit.collider.handle),
    };
  }

  /** Línea de visión libre entre dos puntos (solo terreno y estáticos). */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return true;
    const hit = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.2, GROUP.TERRAIN | GROUP.STATIC);
    return hit === null;
  }
}
