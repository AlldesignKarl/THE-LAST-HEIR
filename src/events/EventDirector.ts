/**
 * Director de eventos dinámicos. Evalúa cada hora qué puede ocurrir según
 * el estado del mundo (hora, clima, historia, historial de ataques).
 * Extensible: cada evento es una regla con probabilidad y condiciones.
 */
import type { Game } from '../game/Game';
import { Rng } from '../core/rng';

interface EventRule {
  id: string;
  /** Probabilidad por hora (0..1) dada la situación actual. */
  chance: (g: Game) => number;
  run: (g: Game) => void;
}

export class EventDirector {
  private rng = new Rng(2024);
  lastRaidDay = -10;
  private rules: EventRule[];

  constructor(private readonly g: Game) {
    this.rules = [
      {
        id: 'raid',
        chance: (game) => {
          if (game.raids.active) return 0;
          const day = game.time.day;
          const h = game.time.hour;
          const night = h >= 21 || h < 4;
          if (day - this.lastRaidDay < 2) return 0;
          // Primer ataque garantizado: la noche tras encontrar el zurrón o el día 3.
          if (!game.flags.has('first_raid_done')) {
            if ((game.flags.has('story_stage_2') || day >= 3) && h === 22) return 1;
            return 0;
          }
          let p = night ? 0.06 : 0.005;
          if (game.weather.state === 'fog') p *= 2;
          if (game.flags.has('read_payment_order')) p *= 0.7;
          return p;
        },
        run: (game) => {
          game.flags.set('first_raid_done');
          this.lastRaidDay = game.time.day;
          game.raids.start();
        },
      },
      {
        id: 'wolf_howl',
        chance: (game) => (game.time.isNight ? 0.25 : 0),
        run: (game) => {
          const p = game.player.pos;
          game.bus.emit('sfx', { id: 'wolf_howl', x: p.x - 120 + Math.random() * 60, y: p.y + 10, z: p.z - 80 + Math.random() * 60, volume: 0.8 });
        },
      },
    ];
    g.bus.on('time:hour', () => this.evaluate());
  }

  private evaluate(): void {
    for (const r of this.rules) {
      const p = r.chance(this.g);
      if (p > 0 && this.rng.next() < p) r.run(this.g);
    }
  }

  /** Forzar un evento (depuración / pruebas). */
  force(id: string): void {
    this.rules.find((r) => r.id === id)?.run(this.g);
  }

  serialize(): object {
    return { lastRaidDay: this.lastRaidDay };
  }

  deserialize(d: { lastRaidDay: number }): void {
    this.lastRaidDay = d.lastRaidDay ?? -10;
  }
}
