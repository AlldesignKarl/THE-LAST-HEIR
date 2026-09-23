/**
 * Clima dinámico (lógica pura). Cadena de Markov entre estados con
 * transiciones graduales. El render/audio leen los valores continuos.
 */
import type { EventBus } from '../core/EventBus';
import { Rng } from '../core/rng';
import { damp } from '../core/math';

export type WeatherState = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm';

export const WEATHER_NAMES: Record<WeatherState, string> = {
  clear: 'Despejado', cloudy: 'Nublado', fog: 'Niebla', rain: 'Lluvia', storm: 'Tormenta',
};

interface Targets { cloud: number; fog: number; rain: number; wind: number }

const TARGETS: Record<WeatherState, Targets> = {
  clear: { cloud: 0.1, fog: 0.0, rain: 0, wind: 0.25 },
  cloudy: { cloud: 0.7, fog: 0.15, rain: 0, wind: 0.45 },
  fog: { cloud: 0.5, fog: 1.0, rain: 0, wind: 0.08 },
  rain: { cloud: 0.9, fog: 0.35, rain: 0.65, wind: 0.6 },
  storm: { cloud: 1.0, fog: 0.45, rain: 1.0, wind: 1.0 },
};

const TRANSITIONS: Record<WeatherState, [WeatherState, number][]> = {
  clear: [['clear', 0.55], ['cloudy', 0.35], ['fog', 0.1]],
  cloudy: [['clear', 0.35], ['cloudy', 0.25], ['rain', 0.3], ['fog', 0.1]],
  fog: [['clear', 0.4], ['cloudy', 0.5], ['fog', 0.1]],
  rain: [['cloudy', 0.5], ['rain', 0.25], ['storm', 0.15], ['clear', 0.1]],
  storm: [['rain', 0.7], ['cloudy', 0.3]],
};

export class Weather {
  state: WeatherState = 'clear';
  cloud = 0.1;
  fog = 0;
  rain = 0;
  wind = 0.25;
  /** Humedad del suelo 0..1 (barro, charcos). */
  wetness = 0;
  /** Minutos de juego hasta el siguiente cambio. */
  private nextChangeIn = 240;
  private rng: Rng;
  /** Destello de relámpago (0..1), lo consume el render. */
  lightning = 0;
  private lightningTimer = 8;
  onThunder: ((delay: number) => void) | null = null;

  constructor(private readonly bus: EventBus | null, seed = 7) {
    this.rng = new Rng(seed);
  }

  /** dt real, gameMinutes transcurridos en este paso. */
  update(dt: number, gameMinutes: number): void {
    this.nextChangeIn -= gameMinutes;
    if (this.nextChangeIn <= 0) this.transition();
    const t = TARGETS[this.state];
    // Las transiciones duran ~1-2 min reales.
    this.cloud = damp(this.cloud, t.cloud, 0.05, dt);
    this.fog = damp(this.fog, t.fog, 0.04, dt);
    this.rain = damp(this.rain, t.rain, 0.08, dt);
    this.wind = damp(this.wind, t.wind, 0.1, dt);
    if (this.rain > 0.1) this.wetness = Math.min(1, this.wetness + dt * 0.01 * this.rain);
    else this.wetness = Math.max(0, this.wetness - dt * 0.002);
    // Relámpagos en tormenta.
    this.lightning = Math.max(0, this.lightning - dt * 4);
    if (this.state === 'storm' && this.rain > 0.7) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightning = 1;
        this.lightningTimer = this.rng.range(6, 22);
        this.onThunder?.(this.rng.range(0.4, 3));
      }
    }
  }

  private transition(): void {
    const options = TRANSITIONS[this.state];
    let r = this.rng.next();
    let next = this.state;
    for (const [s, p] of options) {
      r -= p;
      if (r <= 0) { next = s; break; }
    }
    this.nextChangeIn = this.rng.range(150, 420);
    if (next !== this.state) this.set(next);
  }

  set(state: WeatherState, immediate = false): void {
    this.state = state;
    if (immediate) {
      const t = TARGETS[state];
      this.cloud = t.cloud; this.fog = t.fog; this.rain = t.rain; this.wind = t.wind;
    }
    this.bus?.emit('weather:changed', { state });
  }

  /** Multiplicador de visibilidad para la percepción de la IA (0.35..1). */
  get visibility(): number {
    return Math.max(0.35, 1 - this.fog * 0.55 - this.rain * 0.25);
  }

  /** Aporte al frío (°C equivalentes). */
  get chill(): number {
    return this.rain * 6 + this.wind * 3 + this.fog * 1.5;
  }

  serialize(): object {
    return { state: this.state, cloud: this.cloud, fog: this.fog, rain: this.rain, wind: this.wind, wetness: this.wetness, next: this.nextChangeIn };
  }

  deserialize(d: { state: WeatherState; cloud: number; fog: number; rain: number; wind: number; wetness: number; next: number }): void {
    this.state = d.state; this.cloud = d.cloud; this.fog = d.fog; this.rain = d.rain;
    this.wind = d.wind; this.wetness = d.wetness; this.nextChangeIn = d.next;
  }
}
