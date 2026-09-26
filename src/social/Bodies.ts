/**
 * Cuerpos y crímenes sin testigos.
 *
 * Si matas (o dejas desangrándose) a alguien del pueblo y nadie te ve, no
 * pasa nada… de momento: el cuerpo queda "pendiente". Si un vecino o un
 * guardia llega a verlo (distancia de visión según la luz y línea de vista
 * real), el pueblo se entera del asesinato y la reputación cae. Si lo
 * escondes (arrastrándolo al agua, al bosque, lejos de los caminos) y nadie
 * lo encuentra, no hay castigo. Los cuerpos hundidos en agua honda no se
 * encuentran nunca.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Character } from '../ai/Character';
import { canSee } from '../ai/Targeting';

interface Pending { c: Character; village: string }

export class Bodies {
  private pending = new Map<string, Pending>();
  private t = 0;
  private now = 0;

  constructor(private readonly g: Game) {}

  /** Crimen sin testigos: se castigará solo si encuentran el cuerpo. */
  registerMurder(c: Character, village: string): void {
    if (!this.pending.has(c.id)) this.pending.set(c.id, { c, village });
  }

  isPending(id: string): boolean {
    return this.pending.has(id);
  }

  update(dt: number): void {
    this.now += dt;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    const g = this.g;
    for (const [id, p] of this.pending) {
      const c = p.c;
      this.checkWater(c);
      if (c.hiddenBody) continue;
      const finder = this.finder(c);
      if (finder) {
        this.pending.delete(id);
        g.bus.emit('crime', { type: 'murder', village: p.village, witnessed: true });
        g.bus.emit('notify', { text: `${finder.name} ha encontrado el cuerpo de ${c.name}. El pueblo busca al culpable.`, kind: 'alert' });
        g.bus.emit('sfx', { id: 'shout', x: finder.pos.x, y: finder.pos.y + 1.6, z: finder.pos.z });
      }
    }
  }

  /** ¿Algún vecino o guardia vivo lo ve ahora? */
  private finder(c: Character): Character | null {
    const g = this.g;
    const night = g.time.nightFactor;
    const range = (18 - night * 11) * g.weather.visibility;
    for (const n of g.npcs.npcs.values()) {
      const o = n.c;
      if (o === c || !o.alive || o.downed || o.indoors) continue;
      const torch = o.hasTorch ? 5 : 0;
      const d = o.pos.distanceTo(c.pos);
      if (d > range + torch) continue;
      if (canSee(g, o.pos, c.pos.clone().setY(c.pos.y - 0.9), `${o.id}>body>${c.id}`, this.now)) return o;
    }
    return null;
  }

  /** En agua honda el cuerpo se hunde y ya no se encontrará. */
  checkWater(c: Character): void {
    if (c.hiddenBody) return;
    const g = this.g;
    const lvl = g.hf.waterLevelAt(c.pos.x, c.pos.z);
    if (lvl === null) return;
    const bottom = g.hf.heightAt(c.pos.x, c.pos.z);
    if (lvl - bottom < 0.6) return;
    c.hiddenBody = true;
    c.pos.y = bottom + 0.1;
    c.prevPos.copy(c.pos);
    if (c.alive) c.die('player');
    g.bus.emit('sfx', { id: 'step_water', x: c.pos.x, y: lvl, z: c.pos.z });
    g.particles.burst('dust', c.pos.x, lvl, c.pos.z, 14, 1.5, undefined, 0.8);
    if (this.pending.has(c.id)) g.bus.emit('notify', { text: `El cuerpo de ${c.name} se hunde en el agua.`, kind: 'info' });
  }

  /**
   * Al dormir o pasar horas: lo que quede cerca de donde vive y trabaja la
   * gente se encuentra; lo que está lejos o escondido, no.
   */
  onTimeSkip(): void {
    const g = this.g;
    for (const [id, p] of this.pending) {
      const c = p.c;
      if (c.hiddenBody) continue;
      let near = false;
      for (const pl of g.settlement.places.values()) {
        if (Math.hypot(pl.x - c.pos.x, pl.z - c.pos.z) < 30) { near = true; break; }
      }
      if (near) {
        this.pending.delete(id);
        g.bus.emit('crime', { type: 'murder', village: p.village, witnessed: true });
        g.bus.emit('notify', { text: `Mientras dormías han encontrado el cuerpo de ${c.name}.`, kind: 'alert' });
      }
    }
  }

  serialize(): object {
    return { pending: [...this.pending.values()].map((p) => ({ id: p.c.id, village: p.village })) };
  }

  deserialize(d: { pending?: { id: string; village: string }[] }): void {
    this.pending.clear();
    for (const p of d?.pending ?? []) {
      const n = this.g.npcs.get(p.id);
      if (n) this.pending.set(p.id, { c: n.c, village: p.village });
    }
  }
}

/** Posición del suelo para un cuerpo arrastrado (terreno o suelo de un edificio). */
export function dragGround(g: Game, x: number, z: number, playerY: number): number {
  const t = g.hf.heightAt(x, z);
  return Math.abs(playerY - t) > 0.35 ? playerY : t;
}

export const tmpV = new THREE.Vector3();
