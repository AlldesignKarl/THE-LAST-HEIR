/**
 * Guía de objetivos: flecha en la parte superior de la pantalla que apunta
 * al objetivo actual (con distancia) y un marcador dorado sobre el sitio,
 * la persona o el objeto en el mundo. Sigue la misión elegida en el diario
 * o, si no hay ninguna, la primera activa con un destino conocido.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { GuideTarget } from '../quests/QuestSystem';

/** Orden de preferencia cuando no se ha elegido misión. */
const PRIORITY = ['defense_robledo', 'main_legacy', 'side_home', 'side_fishing', 'side_islands', 'side_palisade', 'hunt_gil'];

export class Guide {
  /** Misión seguida (elegida en el diario); null = automática. */
  tracked: string | null = null;
  enabled = true;
  private el: HTMLDivElement;
  private arrow: HTMLDivElement;
  private label: HTMLDivElement;
  private marker: THREE.Sprite;
  private lastText = '';
  private t = 0;
  current: { questId: string; text: string; pos: THREE.Vector3 } | null = null;

  constructor(private readonly g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'guide';
    this.arrow = document.createElement('div');
    this.arrow.className = 'guide-arrow';
    this.arrow.innerHTML = '<svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 3 L33 31 L20 24 L7 31 Z" fill="#e8c36a" stroke="#2a1d0c" stroke-width="2" stroke-linejoin="round"/></svg>';
    this.label = document.createElement('div');
    this.label.className = 'guide-label';
    this.el.append(this.arrow, this.label);
    document.getElementById('ui-root')!.append(this.el);

    const c = document.createElement('canvas');
    c.width = 64; c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e8c36a';
    ctx.strokeStyle = '#2a1d0c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(8, 18); ctx.lineTo(56, 18); ctx.lineTo(32, 60); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 80, 8, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, fog: false, sizeAttenuation: false }));
    this.marker.scale.set(0.032, 0.048, 1);
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    g.renderer.scene.add(this.marker);
  }

  /** Posición en el mundo de un destino, o null si no se puede resolver. */
  resolve(t: GuideTarget | undefined, npcHint?: string): THREE.Vector3 | null {
    const g = this.g;
    if (!t && npcHint) t = { npc: npcHint };
    if (!t) return null;
    if ('npc' in t) {
      const n = g.npcs.get(t.npc);
      if (!n || !n.c.alive) return null;
      return n.c.pos.clone().add(new THREE.Vector3(0, 2.3, 0));
    }
    if ('pos' in t) return new THREE.Vector3(t.pos[0], g.hf.heightAt(t.pos[0], t.pos[1]) + 1.6, t.pos[1]);
    if ('place' in t) {
      const p = g.settlement.places.get(t.place);
      return p ? new THREE.Vector3(p.x, p.y + 1.8, p.z) : null;
    }
    if ('item' in t) {
      if (g.inventory.has(t.item)) return null;
      return this.nearestItem(t.item);
    }
    if ('near' in t) {
      const pp = g.player.pos;
      if (t.near === 'log') {
        // Llevando un tronco para la empalizada: a la carpintería.
        const carried = g.interaction.carried?.item;
        if (carried?.itemId === 'log' && g.quests.isActive('side_palisade')) {
          const z = g.settlement.woodDropZone;
          return new THREE.Vector3(z.x, g.hf.heightAt(z.x, z.z) + 1.2, z.z);
        }
        const log = this.nearestItem('log', 90);
        if (log) return log;
      }
      if (t.near === 'rock') {
        let best: THREE.Vector3 | null = null, bd = Infinity;
        for (const r of g.resources.rocks.values()) {
          if (r.stones <= 0) continue;
          const d = Math.hypot(r.x - pp.x, r.z - pp.z);
          if (d < bd) { bd = d; best = new THREE.Vector3(r.x, r.y + r.size + 0.8, r.z); }
        }
        return best;
      }
      // Árbol en pie más cercano.
      const trees = g.vegetation.nearbyTrees(pp.x, pp.z, 90);
      let best: THREE.Vector3 | null = null, bd = Infinity;
      for (const tr of trees) {
        const d = Math.hypot(tr.x - pp.x, tr.z - pp.z);
        if (d < bd) { bd = d; best = new THREE.Vector3(tr.x, tr.y + 3, tr.z); }
      }
      return best;
    }
    return null;
  }

  private nearestItem(itemId: string, maxD = 400): THREE.Vector3 | null {
    const pp = this.g.player.pos;
    let best: THREE.Vector3 | null = null, bd = maxD;
    for (const wi of this.g.worldItems.items.values()) {
      if (wi.itemId !== itemId || wi.carried) continue;
      const t = wi.body.translation();
      const d = Math.hypot(t.x - pp.x, t.z - pp.z);
      if (d < bd) { bd = d; best = new THREE.Vector3(t.x, t.y + 0.9, t.z); }
    }
    return best;
  }

  /** Elige el objetivo a mostrar. */
  private pick(): { questId: string; text: string; pos: THREE.Vector3 } | null {
    const q = this.g.quests;
    const order = this.tracked && q.isActive(this.tracked) ? [this.tracked, ...PRIORITY] : [...PRIORITY, ...q.activeIds()];
    for (const id of order) {
      if (!q.isActive(id)) continue;
      for (const o of q.pending(id)) {
        const pos = this.resolve(o.target, o.kind === 'talk' || o.kind === 'deliver' ? o.npc : undefined);
        if (pos) return { questId: id, text: o.text, pos };
      }
    }
    return null;
  }

  update(dt: number): void {
    const g = this.g;
    this.t += dt;
    const inGame = g.started && !g.ui.blocking && !g.vitals.dead;
    // Recalcular el objetivo 4 veces por segundo; la flecha se orienta cada frame.
    if (this.t > 0.25) { this.t = 0; this.current = this.enabled ? this.pick() : null; }
    const cur = this.current;
    if (!cur || !inGame) {
      this.el.style.opacity = '0';
      this.marker.visible = false;
      return;
    }
    const pp = g.player.pos;
    const dx = cur.pos.x - pp.x, dz = cur.pos.z - pp.z;
    const dist = Math.hypot(dx, dz);
    const worldAng = Math.atan2(-dx, -dz);
    let rel = worldAng - g.player.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.arrow.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
    const text = `${cur.text} · ${dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'}`;
    if (text !== this.lastText) { this.lastText = text; this.label.textContent = text; }
    this.el.style.opacity = '1';
    this.el.classList.toggle('near', dist < 4);
    this.marker.visible = dist > 3;
    this.marker.position.copy(cur.pos);
    this.marker.position.y += Math.sin(performance.now() / 400) * 0.15;
  }
}
