/**
 * API de depuración (solo con ?debug). La usan los tests E2E para
 * dirigir escenarios reales sobre el juego en ejecución.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Action } from '../core/Input';

export function installDebugAPI(g: Game): void {
  const api = {
    game: g,
    /** Avanza la simulación N segundos de forma síncrona. */
    step(seconds: number): void {
      const n = Math.round(seconds * 30);
      for (let i = 0; i < n; i++) (g as unknown as { fixedUpdate(dt: number): void }).fixedUpdate(1 / 30);
    },
    teleport(x: number, z: number, yaw?: number, y?: number): void {
      g.terrain.preload(x, z);
      g.vegetation.update(x, z, true);
      g.physics.world.step();
      g.player.teleport(x, y ?? g.hf.heightAt(x, z) + 0.1, z, yaw);
    },
    lookAt(x: number, y: number, z: number): void {
      const e = g.player.eyePosition(1, new THREE.Vector3());
      const dx = x - e.x, dy = y - e.y, dz = z - e.z;
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    setHour(h: number): void {
      const cur = g.time.hourFloat;
      let d = h - cur;
      if (d < 0) d += 24;
      g.time.advanceHours(d);
      g.npcs.snapAll();
    },
    give(id: string, n = 1): void {
      g.inventory.add(id, n);
      g.bus.emit('item:acquired', { itemId: id, count: n, source: 'reward' });
    },
    press(a: Action, down: boolean): void {
      g.input.setVirtual(a, down);
    },
    interact(): string {
      const f = g.interaction.focus;
      const t = f.text;
      g.input.setVirtual('interact', true);
      api.step(1 / 30);
      g.input.setVirtual('interact', false);
      return t;
    },
    focus(): string { return `${g.interaction.focus.kind}:${g.interaction.focus.text}`; },
    weather(s: 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm'): void { g.weather.set(s, true); },
    startRaid(): void { g.director.force('raid'); },
    quest(id: string): string | null { return g.quests.stageId(id) ?? g.quests.status(id); },
    flags(): string[] { return (g.flags.serialize() as { flags: string[] }).flags; },
    npc(id: string): { x: number; z: number; alive: boolean; indoors: boolean; state: string; place: string } | null {
      const n = g.npcs.get(id);
      if (!n) return null;
      return { x: n.c.pos.x, z: n.c.pos.z, alive: n.c.alive, indoors: n.c.indoors, state: n.state, place: n.placeId };
    },
    raid(): { phase: string; alive: number; spotted: boolean; history: unknown } {
      return { phase: g.raids.phase, alive: g.raids.raiders.filter((r) => r.c.alive).length, spotted: g.raids.spotted, history: g.raids.history };
    },
    killRaiders(n: number): void {
      for (const r of g.raids.raiders.filter((x) => x.c.alive).slice(0, n)) {
        r.c.takeHit({ amount: 9999, type: 'slash', zone: 'torso', attackerId: 'player', attackerFaction: 'player', from: r.c.pos.clone(), heavy: true, stagger: 1 });
      }
    },
    errors: [] as string[],
    /** Registro de daños al jugador (diagnóstico). */
    damageLog: [] as { amount: number; attackerId: string | null; t: number; pos: number[] }[],
  };
  g.bus.on('player:damaged', (e) => api.damageLog.push({ amount: e.amount, attackerId: e.attackerId, t: performance.now(), pos: g.player.pos.toArray() }));
  (window as unknown as { __game: typeof api }).__game = api;
  window.addEventListener('error', (e) => api.errors.push(String(e.message)));
}
