/**
 * Registro de interactuables: puertas, camas, cofres, hogares, pozo,
 * escaleras, NPCs... Se resuelven por collider (raycast desde la cámara).
 */
import type * as THREE from 'three';
import type { Game } from '../game/Game';

export interface Interactable {
  id: string;
  kind: string;
  pos: THREE.Vector3;
  /** Texto del aviso ("Abrir puerta"); null = no disponible ahora. */
  label(game: Game): string | null;
  interact(game: Game): void;
  /** Distancia máxima de interacción. */
  range?: number;
}

export class Interactables {
  private byCollider = new Map<number, Interactable>();
  private byId = new Map<string, Interactable>();

  register(colliderHandle: number, it: Interactable): void {
    this.byCollider.set(colliderHandle, it);
    this.byId.set(it.id, it);
  }

  /** Interactuable sin collider propio (resuelto por proximidad). */
  registerProximity(it: Interactable): void {
    this.byId.set(it.id, it);
  }

  unregisterCollider(handle: number): void {
    const it = this.byCollider.get(handle);
    this.byCollider.delete(handle);
    if (it) this.byId.delete(it.id);
  }

  forCollider(handle: number): Interactable | undefined {
    return this.byCollider.get(handle);
  }

  get(id: string): Interactable | undefined {
    return this.byId.get(id);
  }

  all(): IterableIterator<Interactable> {
    return this.byId.values();
  }
}
