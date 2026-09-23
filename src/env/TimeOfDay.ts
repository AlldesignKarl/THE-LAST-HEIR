/**
 * Reloj del mundo. 1 día de juego = `dayLengthSeconds` reales.
 * Lógica pura (testeable). Emite 'time:hour' en cada cambio de hora.
 */
import type { EventBus } from '../core/EventBus';

export const SUNRISE = 6;
export const SUNSET = 20.5;

export class TimeOfDay {
  /** Minutos de juego desde el día 1, 00:00. */
  totalMinutes: number;
  dayLengthSeconds = 2400;
  private lastHour = -1;

  constructor(private readonly bus: EventBus | null, startDay = 1, startHour = 7) {
    this.totalMinutes = (startDay - 1) * 1440 + startHour * 60;
    this.lastHour = Math.floor(this.hourFloat);
  }

  get minutesPerRealSecond(): number {
    return 1440 / this.dayLengthSeconds;
  }

  update(realDt: number): void {
    this.totalMinutes += realDt * this.minutesPerRealSecond;
    this.checkHour();
  }

  /** Salto de tiempo (dormir, esperar). */
  advanceHours(hours: number): void {
    // Emitir cada hora intermedia para que los sistemas reaccionen.
    const steps = Math.ceil(hours);
    for (let i = 0; i < steps; i++) {
      this.totalMinutes += Math.min(60, (hours - i) * 60);
      this.checkHour();
    }
  }

  private checkHour(): void {
    const h = Math.floor(this.totalMinutes / 60);
    if (h !== this.lastHour) {
      this.lastHour = h;
      this.bus?.emit('time:hour', { day: this.day, hour: this.hour });
    }
  }

  get day(): number {
    return Math.floor(this.totalMinutes / 1440) + 1;
  }

  /** Hora entera 0..23. */
  get hour(): number {
    return Math.floor(this.hourFloat);
  }

  /** Hora con decimales 0..24. */
  get hourFloat(): number {
    return (this.totalMinutes % 1440) / 60;
  }

  get isNight(): boolean {
    const h = this.hourFloat;
    return h < SUNRISE || h >= SUNSET + 0.5;
  }

  /** 0 = pleno día, 1 = noche cerrada (transición suave en ocaso/alba). */
  get nightFactor(): number {
    const e = this.sunElevation;
    return Math.min(1, Math.max(0, (0.05 - e) / 0.25));
  }

  /** Elevación del sol en radianes (negativa de noche). */
  get sunElevation(): number {
    const h = this.hourFloat;
    const dayLen = SUNSET - SUNRISE;
    const t = (h - SUNRISE) / dayLen; // 0 amanecer, 1 ocaso
    if (t >= 0 && t <= 1) return Math.sin(t * Math.PI) * 1.1;
    // Noche: curva negativa
    const nt = t > 1 ? (h - SUNSET) / (24 - dayLen) : (h + 24 - SUNSET) / (24 - dayLen);
    return -Math.sin(nt * Math.PI) * 0.9;
  }

  /** Azimut del sol: este al amanecer, sur a mediodía, oeste al ocaso. */
  get sunAzimuth(): number {
    const h = this.hourFloat;
    return ((h - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI; // 0 = este
  }

  /** Dirección unitaria hacia el sol (norte = -Z). */
  sunDirection(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const el = this.sunElevation, az = this.sunAzimuth;
    const c = Math.cos(el);
    out.x = Math.cos(az) * c;
    out.y = Math.sin(el);
    out.z = Math.sin(az) * c * 0.8 + 0.2 * c; // inclinado hacia el sur
    const l = Math.hypot(out.x, out.y, out.z);
    out.x /= l; out.y /= l; out.z /= l;
    return out;
  }

  formatClock(): string {
    const h = Math.floor(this.hourFloat);
    const m = Math.floor((this.totalMinutes % 60));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Nombre de la franja horaria en castellano de la época. */
  periodName(): string {
    const h = this.hourFloat;
    if (h < 5) return 'Noche cerrada';
    if (h < 7) return 'Alba';
    if (h < 12) return 'Mañana';
    if (h < 15) return 'Mediodía';
    if (h < 19) return 'Tarde';
    if (h < 21.5) return 'Anochecer';
    return 'Noche';
  }

  serialize(): { totalMinutes: number } {
    return { totalMinutes: this.totalMinutes };
  }

  deserialize(d: { totalMinutes: number }): void {
    this.totalMinutes = d.totalMinutes;
    this.lastHour = Math.floor(this.totalMinutes / 60);
  }
}
