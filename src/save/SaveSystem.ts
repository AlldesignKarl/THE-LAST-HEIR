/**
 * Guardado persistente versionado (ADR-008). Cada sistema se registra
 * como Saveable. Cargar = arrancar un mundo limpio y aplicar el documento
 * (evita estados residuales de la partida anterior).
 */
import type { EventBus } from '../core/EventBus';

export interface Saveable {
  id: string;
  serialize(): unknown;
  deserialize(d: unknown): void;
}

export interface StorageBackend {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface SaveDoc {
  version: number;
  savedAt: string;
  playTime: number;
  summary: string;
  systems: Record<string, unknown>;
}

export const SAVE_VERSION = 1;
const PREFIX = 'tlh_save_';
const PENDING = 'tlh_pending_load';

/** Migraciones: versión origen → función que devuelve la versión +1. */
const MIGRATIONS: Record<number, (d: SaveDoc) => SaveDoc> = {};

export function migrate(doc: SaveDoc): SaveDoc {
  let d = doc;
  while (d.version < SAVE_VERSION) {
    const m = MIGRATIONS[d.version];
    if (!m) throw new Error(`No hay migración desde la versión ${d.version}`);
    d = m(d);
  }
  return d;
}

export class SaveSystem {
  private saveables: Saveable[] = [];
  playTime = 0;
  summary: () => string = () => '';

  constructor(private readonly bus: EventBus | null, private readonly storage: StorageBackend = localStorage) {}

  register(s: Saveable): void {
    this.saveables.push(s);
  }

  build(): SaveDoc {
    const systems: Record<string, unknown> = {};
    for (const s of this.saveables) {
      try {
        systems[s.id] = s.serialize();
      } catch (err) {
        console.error(`[Save] error serializando ${s.id}`, err);
      }
    }
    return { version: SAVE_VERSION, savedAt: new Date().toISOString(), playTime: this.playTime, summary: this.summary(), systems };
  }

  save(slot: string): boolean {
    try {
      const doc = this.build();
      this.storage.setItem(PREFIX + slot, JSON.stringify(doc));
      this.bus?.emit('game:saved', { slot });
      if (slot !== 'auto') this.bus?.emit('notify', { text: `Partida guardada (ranura ${slot}).`, kind: 'info' });
      return true;
    } catch (err) {
      console.error('[Save] no se pudo guardar', err);
      this.bus?.emit('notify', { text: 'No se pudo guardar la partida.', kind: 'warning' });
      return false;
    }
  }

  read(slot: string): SaveDoc | null {
    const raw = this.storage.getItem(PREFIX + slot);
    if (!raw) return null;
    try {
      return migrate(JSON.parse(raw) as SaveDoc);
    } catch (err) {
      console.error('[Save] guardado corrupto', err);
      return null;
    }
  }

  /** Aplica un documento a los sistemas registrados (en orden de registro). */
  apply(doc: SaveDoc): void {
    this.playTime = doc.playTime;
    for (const s of this.saveables) {
      if (!(s.id in doc.systems)) continue;
      try {
        s.deserialize(doc.systems[s.id]);
      } catch (err) {
        console.error(`[Save] error cargando ${s.id}`, err);
      }
    }
  }

  loadNow(slot: string): boolean {
    const doc = this.read(slot);
    if (!doc) return false;
    this.apply(doc);
    this.bus?.emit('game:loaded', { slot });
    return true;
  }

  /** Carga diferida: recarga la página y aplica el guardado sobre un mundo limpio. */
  requestLoad(slot: string): void {
    try { sessionStorage.setItem(PENDING, slot); } catch { /* sin sessionStorage */ }
    location.reload();
  }

  static takePendingLoad(): string | null {
    try {
      const s = sessionStorage.getItem(PENDING);
      if (s) sessionStorage.removeItem(PENDING);
      return s;
    } catch {
      return null;
    }
  }

  info(slot: string): string | null {
    const raw = this.storage.getItem(PREFIX + slot);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw) as SaveDoc;
      const date = new Date(d.savedAt);
      return `${d.summary} · ${date.toLocaleDateString()} ${date.toLocaleTimeString().slice(0, 5)}`;
    } catch {
      return 'corrupto';
    }
  }

  hasAny(): boolean {
    return ['auto', '1', '2', '3'].some((s) => this.storage.getItem(PREFIX + s));
  }

  latestSlot(): string | null {
    let best: string | null = null, bestT = 0;
    for (const s of ['auto', '1', '2', '3']) {
      const raw = this.storage.getItem(PREFIX + s);
      if (!raw) continue;
      try {
        const t = Date.parse((JSON.parse(raw) as SaveDoc).savedAt);
        if (t > bestT) { bestT = t; best = s; }
      } catch { /* ignorar */ }
    }
    return best;
  }
}
