/**
 * Estaciones del año. La partida empieza en una estación al azar y cada
 * SEASON_DAYS días de juego pasa a la siguiente. Cada estación cambia:
 *  - el color de la hierba y del follaje (en invierno los robles, de hoja
 *    caduca, quedan desnudos; los pinos siguen verdes),
 *  - la nieve sobre el terreno en invierno y que la lluvia caiga como nieve,
 *  - la temperatura,
 *  - el tiempo de cada día: al alba se sortea si el día será despejado,
 *    nublado, de niebla, de lluvia o de tormenta, con probabilidades de la
 *    estación.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { WeatherState } from './Weather';
import { GlobalUniforms } from '../engine/placeholder/Materials';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES: Record<Season, string> = { spring: 'Primavera', summer: 'Verano', autumn: 'Otoño', winter: 'Invierno' };
export const SEASON_DAYS = 3;

interface SeasonLook { grass: [number, number, number]; oak: [number, number, number]; pine: [number, number, number]; snow: number; chill: number; oakBare: boolean }
const LOOK: Record<Season, SeasonLook> = {
  spring: { grass: [0.95, 1.08, 0.82], oak: [0.92, 1.1, 0.8], pine: [1, 1.04, 0.96], snow: 0, chill: 2, oakBare: false },
  summer: { grass: [1.08, 1.0, 0.72], oak: [0.95, 0.98, 0.85], pine: [0.96, 0.98, 0.9], snow: 0, chill: -4, oakBare: false },
  autumn: { grass: [1.12, 0.92, 0.62], oak: [1.45, 0.78, 0.32], pine: [0.9, 0.92, 0.84], snow: 0, chill: 5, oakBare: false },
  winter: { grass: [0.88, 0.88, 0.78], oak: [0.7, 0.62, 0.5], pine: [0.78, 0.84, 0.8], snow: 0.75, chill: 11, oakBare: true },
};

/** Probabilidad de cada tipo de día según la estación. */
const DAY_WEATHER: Record<Season, [WeatherState, number][]> = {
  spring: [['clear', 0.38], ['cloudy', 0.24], ['rain', 0.24], ['fog', 0.09], ['storm', 0.05]],
  summer: [['clear', 0.62], ['cloudy', 0.18], ['storm', 0.12], ['rain', 0.05], ['fog', 0.03]],
  autumn: [['clear', 0.2], ['cloudy', 0.3], ['rain', 0.26], ['fog', 0.19], ['storm', 0.05]],
  winter: [['clear', 0.26], ['cloudy', 0.3], ['rain', 0.24], ['fog', 0.15], ['storm', 0.05]],
};

export const SeasonUniforms = {
  uGrassTint: { value: new THREE.Color(1, 1, 1) },
  uSnowCover: { value: 0 },
};

export class Seasons {
  season: Season;
  /** Día de juego en que empezó la estación actual. */
  startDay = 1;
  private lastRollDay = -1;
  private fixed = false;

  constructor(private readonly g: Game) {
    // En modo de pruebas (?debug) empieza en primavera (o en ?season=…) y sin
    // sorteo de tiempo, para que las pruebas sean reproducibles.
    const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    const forced = params.get('season') as Season | null;
    this.fixed = params.has('debug');
    this.season = forced && SEASONS.includes(forced) ? forced : this.fixed ? 'spring' : SEASONS[Math.floor(Math.random() * 4)];
    g.bus.on('time:hour', (e) => { if (e.hour === 6) this.onDawn(); });
  }

  get look(): SeasonLook { return LOOK[this.season]; }
  get name(): string { return SEASON_NAMES[this.season]; }

  /** Frío extra de la estación (°C equivalentes, negativo = más calor). */
  get chill(): number { return this.look.chill; }

  get snowing(): boolean { return this.season === 'winter'; }

  private onDawn(): void {
    const g = this.g;
    const day = g.time.day;
    if (day - this.startDay >= SEASON_DAYS && !this.fixed) {
      this.season = SEASONS[(SEASONS.indexOf(this.season) + 1) % 4];
      this.startDay = day;
      this.apply();
      g.bus.emit('notify', { text: `Llega ${this.season === 'summer' ? 'el verano' : this.season === 'autumn' ? 'el otoño' : this.season === 'winter' ? 'el invierno' : 'la primavera'}.`, kind: 'quest' });
    }
    this.rollDay(day);
  }

  /** Sortea el tiempo del día según la estación. */
  rollDay(day: number): void {
    if (day === this.lastRollDay || this.fixed) return;
    this.lastRollDay = day;
    let r = Math.random();
    let pick: WeatherState = 'clear';
    for (const [s, p] of DAY_WEATHER[this.season]) { r -= p; if (r <= 0) { pick = s; break; } }
    this.g.weather.setDay(pick);
  }

  /** Aplica colores, nieve y follaje de la estación. */
  apply(): void {
    const g = this.g;
    const L = this.look;
    SeasonUniforms.uGrassTint.value.setRGB(...L.grass);
    SeasonUniforms.uSnowCover.value = L.snow;
    g.vegetation.setSeasonLook(new THREE.Color(...L.oak), new THREE.Color(...L.pine), L.oakBare);
    g.grass.enabled = g.quality.grass && L.snow < 0.5;
    g.rain.snow = this.snowing;
    void GlobalUniforms;
  }

  serialize(): object {
    return { season: this.season, startDay: this.startDay, lastRollDay: this.lastRollDay };
  }

  deserialize(d: { season?: Season; startDay?: number; lastRollDay?: number }): void {
    if (d?.season && SEASONS.includes(d.season)) this.season = d.season;
    this.startDay = d?.startDay ?? 1;
    this.lastRollDay = d?.lastRollDay ?? -1;
    this.apply();
  }
}
