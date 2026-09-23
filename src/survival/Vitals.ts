/**
 * Constantes vitales del jugador (lógica pura).
 * Diseño "moderado": afectan al juego sin castigar en exceso (GDD 4.2).
 */
import { clamp } from '../core/math';

export interface VitalsContext {
  /** Temperatura ambiente efectiva en °C (ya incluye clima, refugio, fuego). */
  ambientTemp: number;
  /** Aislamiento de la ropa en °C equivalentes. */
  insulation: number;
  /** 0 reposo, 1 esfuerzo máximo (correr, luchar). */
  exertion: number;
  /** El jugador está regenerando stamina (no la gasta este tick). */
  resting: boolean;
}

/** Consumo por minuto de juego. */
export const RATES = {
  hungerPerMin: 100 / 2160, // ~1,5 días
  thirstPerMin: 100 / 1440, // ~1 día
  staminaRegenPerSec: 16,
  healthRegenPerMin: 0.35,
  starvePerSec: 0.25,
  freezePerSec: 0.3,
};

export class Vitals {
  health = 100;
  maxHealth = 100;
  stamina = 100;
  hunger = 85;
  thirst = 80;
  /** Calor corporal 0..100 (≥ 60 confortable). */
  warmth = 80;
  /** Segundos desde el último gasto de stamina (retraso de regeneración). */
  private staminaDelay = 0;
  /** Efectos temporales: comida caliente, ebrio, sangrado. */
  wellFed = 0;
  bleeding = 0;
  dead = false;

  get staminaMax(): number {
    let m = 100;
    if (this.hunger < 25) m -= 25;
    if (this.warmth < 30) m -= 15;
    if (this.health < 30) m -= 15;
    return m;
  }

  get isCold(): boolean { return this.warmth < 35; }
  get isFreezing(): boolean { return this.warmth < 12; }
  get isHungry(): boolean { return this.hunger < 25; }
  get isThirsty(): boolean { return this.thirst < 25; }

  /**
   * @param dt segundos reales
   * @param gameMinutes minutos de juego transcurridos
   */
  update(dt: number, gameMinutes: number, ctx: VitalsContext): void {
    if (this.dead) return;
    const exertMul = 1 + ctx.exertion * 1.5;
    this.hunger = clamp(this.hunger - RATES.hungerPerMin * gameMinutes * (1 + ctx.exertion * 0.5), 0, 100);
    this.thirst = clamp(this.thirst - RATES.thirstPerMin * gameMinutes * exertMul, 0, 100);
    this.wellFed = Math.max(0, this.wellFed - gameMinutes);

    // Temperatura corporal: tiende hacia un objetivo según ambiente + ropa.
    const felt = ctx.ambientTemp + ctx.insulation + ctx.exertion * 4 + (this.wellFed > 0 ? 3 : 0);
    const target = clamp(40 + (felt - 8) * 5, 0, 100);
    const rate = target < this.warmth ? 0.12 : 1.2; // se enfría despacio, se calienta rápido
    this.warmth = clamp(this.warmth + (target - this.warmth) * Math.min(1, rate * dt * 0.05), 0, 100);

    // Stamina.
    if (ctx.resting) {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) {
        let regen = RATES.staminaRegenPerSec;
        if (this.thirst < 25) regen *= 0.6;
        if (this.isCold) regen *= 0.6;
        this.stamina = Math.min(this.staminaMax, this.stamina + regen * dt);
      }
    }
    if (this.stamina > this.staminaMax) this.stamina = this.staminaMax;

    // Salud.
    if (this.hunger > 50 && this.thirst > 50 && !this.isCold && this.bleeding <= 0) {
      this.heal(RATES.healthRegenPerMin * gameMinutes * (this.wellFed > 0 ? 2 : 1));
    }
    if (this.hunger <= 0) this.hurt(RATES.starvePerSec * dt);
    if (this.thirst <= 0) this.hurt(RATES.starvePerSec * 1.3 * dt);
    if (this.isFreezing) this.hurt(RATES.freezePerSec * dt);
    if (this.bleeding > 0) {
      this.hurt(0.8 * dt);
      this.bleeding = Math.max(0, this.bleeding - dt);
    }
  }

  /** Intenta gastar stamina. Devuelve false si no hay suficiente. */
  useStamina(amount: number, allowPartial = false): boolean {
    if (this.stamina < amount && !allowPartial) return false;
    this.stamina = Math.max(0, this.stamina - amount);
    this.staminaDelay = 0.9;
    return true;
  }

  drainStamina(amountPerSec: number, dt: number): boolean {
    if (this.stamina <= 0) return false;
    this.stamina = Math.max(0, this.stamina - amountPerSec * dt);
    this.staminaDelay = 0.6;
    return this.stamina > 0;
  }

  hurt(amount: number): void {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.dead = true;
  }

  heal(amount: number): void {
    if (this.dead) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  eat(food: number, water: number, warmthBonus = 0): void {
    this.hunger = clamp(this.hunger + food, 0, 100);
    this.thirst = clamp(this.thirst + water, 0, 100);
    if (warmthBonus > 0) {
      this.wellFed = Math.max(this.wellFed, warmthBonus);
      this.warmth = Math.min(100, this.warmth + 10);
    }
  }

  /** Dormir/esperar: el tiempo pasa con consumo reducido. */
  timeSkip(hours: number, sleeping: boolean): void {
    const min = hours * 60;
    const mul = sleeping ? 0.5 : 1;
    this.hunger = clamp(this.hunger - RATES.hungerPerMin * min * mul, 0, 100);
    this.thirst = clamp(this.thirst - RATES.thirstPerMin * min * mul, 0, 100);
    if (this.hunger > 0 && this.thirst > 0) this.heal((sleeping ? 6 : 2) * hours);
    this.stamina = this.staminaMax;
    if (sleeping) this.warmth = Math.max(this.warmth, 65);
  }

  serialize(): object {
    return { health: this.health, stamina: this.stamina, hunger: this.hunger, thirst: this.thirst, warmth: this.warmth, wellFed: this.wellFed };
  }

  deserialize(d: Partial<Record<'health' | 'stamina' | 'hunger' | 'thirst' | 'warmth' | 'wellFed', number>>): void {
    this.health = d.health ?? 100;
    this.stamina = d.stamina ?? 100;
    this.hunger = d.hunger ?? 80;
    this.thirst = d.thirst ?? 80;
    this.warmth = d.warmth ?? 80;
    this.wellFed = d.wellFed ?? 0;
    this.dead = this.health <= 0;
  }
}

/** Temperatura ambiente (°C) según hora, altitud, clima y entorno. */
export function ambientTemperature(opts: {
  hour: number; altitude: number; chill: number; sheltered: boolean; inCave: boolean; fireHeat: number;
}): number {
  // Curva diaria: mínima ~5 °C a las 5h, máxima ~20 °C a las 15h.
  const daily = 12.5 + 7.5 * Math.sin(((opts.hour - 9) / 24) * Math.PI * 2);
  let t = daily - Math.max(0, opts.altitude - 20) * 0.02 - opts.chill;
  if (opts.inCave) t = 10; // cuevas: temperatura estable, fresca
  if (opts.sheltered) t = Math.max(t, t + 5);
  return t + opts.fireHeat;
}
