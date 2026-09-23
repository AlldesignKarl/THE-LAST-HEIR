/**
 * Sistema de misiones dirigido por datos. Cada misión tiene etapas; cada
 * etapa, objetivos que se cumplen escuchando eventos del mundo. Al
 * completar una etapa se aplican efectos y se pasa a la siguiente.
 */
import type { EventBus } from '../core/EventBus';

export type ObjectiveDef =
  | { kind: 'talk'; npc: string; text: string }
  | { kind: 'collect'; item: string; count: number; text: string }
  | { kind: 'deliver'; item: string; count: number; npc: string; text: string }
  | { kind: 'goto'; area: string; text: string }
  | { kind: 'read'; doc: string; text: string }
  | { kind: 'kill'; victimKind: string; count: number; text: string }
  | { kind: 'flag'; flag: string; text: string; count?: number };

export interface QuestContext {
  bus: EventBus;
  hasFlag(f: string): boolean;
  setFlag(f: string): void;
  itemCount(id: string): number;
  giveItem(id: string, n: number): void;
  takeItem(id: string, n: number): number;
  giveCoins(n: number): void;
  changeRep(village: string, delta: number, reason: string): void;
}

export interface StageDef {
  id: string;
  desc: string;
  objectives: ObjectiveDef[];
  onComplete?: (ctx: QuestContext) => void;
}

export interface QuestDef {
  id: string;
  title: string;
  type: 'main' | 'side' | 'village' | 'defense' | 'hunt' | 'explore';
  giver?: string;
  stages: StageDef[];
  onComplete?: (ctx: QuestContext) => void;
}

export type QuestStatus = 'inactive' | 'active' | 'completed' | 'failed';

interface QuestState {
  status: QuestStatus;
  stage: number;
  progress: number[];
}

export class QuestSystem {
  private defs = new Map<string, QuestDef>();
  private state = new Map<string, QuestState>();

  constructor(defs: QuestDef[], private readonly ctx: QuestContext) {
    for (const d of defs) this.defs.set(d.id, d);
    const bus = ctx.bus;
    bus.on('npc:talked', (e) => this.onEvent((o) => o.kind === 'talk' && o.npc === e.npcId));
    bus.on('doc:read', (e) => this.onEvent((o) => o.kind === 'read' && o.doc === e.docId));
    bus.on('area:entered', (e) => this.onEvent((o) => o.kind === 'goto' && o.area === e.areaId));
    bus.on('flag:set', (e) => this.onEvent((o) => o.kind === 'flag' && o.flag === e.flag));
    bus.on('item:acquired', () => this.recheckCollect());
    bus.on('item:removed', () => this.recheckCollect());
    bus.on('actor:killed', (e) => this.onEvent((o) => o.kind === 'kill' && o.victimKind === e.victimKind, true));
  }

  def(id: string): QuestDef | undefined {
    return this.defs.get(id);
  }

  title(id: string): string {
    return this.defs.get(id)?.title ?? id;
  }

  status(id: string): QuestStatus {
    return this.state.get(id)?.status ?? 'inactive';
  }

  isActive(id: string): boolean {
    return this.status(id) === 'active';
  }

  stageId(id: string): string | null {
    const s = this.state.get(id);
    const d = this.defs.get(id);
    if (!s || !d || s.status !== 'active') return null;
    return d.stages[s.stage]?.id ?? null;
  }

  start(id: string): void {
    const d = this.defs.get(id);
    if (!d || this.status(id) !== 'inactive') return;
    this.state.set(id, { status: 'active', stage: 0, progress: d.stages[0].objectives.map(() => 0) });
    this.ctx.bus.emit('quest:started', { questId: id });
    this.checkStage(id);
  }

  /** Progreso externo (p.ej. troncos entregados). */
  setProgress(id: string, objIndex: number, value: number): void {
    const s = this.state.get(id);
    if (!s || s.status !== 'active') return;
    if (s.progress[objIndex] === value) return;
    s.progress[objIndex] = value;
    this.checkStage(id);
  }

  /** Completa objetivos de entrega (llamado desde el diálogo). */
  deliver(id: string, npc: string): boolean {
    const s = this.state.get(id);
    const d = this.defs.get(id);
    if (!s || !d || s.status !== 'active') return false;
    const st = d.stages[s.stage];
    let did = false;
    st.objectives.forEach((o, i) => {
      if (o.kind === 'deliver' && o.npc === npc && s.progress[i] < o.count && this.ctx.itemCount(o.item) >= o.count) {
        s.progress[i] = o.count;
        // Reunir ese objeto queda cumplido de forma definitiva.
        st.objectives.forEach((c, j) => { if (c.kind === 'collect' && c.item === o.item) s.progress[j] = c.count; });
        this.ctx.takeItem(o.item, o.count);
        this.ctx.bus.emit('item:removed', { itemId: o.item, count: o.count, reason: 'deliver' });
        did = true;
      }
    });
    if (did) this.checkStage(id);
    return did;
  }

  canDeliver(id: string, npc: string): boolean {
    const s = this.state.get(id);
    const d = this.defs.get(id);
    if (!s || !d || s.status !== 'active') return false;
    return d.stages[s.stage].objectives.some((o, i) => o.kind === 'deliver' && o.npc === npc && s.progress[i] < o.count && this.ctx.itemCount(o.item) >= o.count);
  }

  complete(id: string): void {
    const s = this.state.get(id);
    const d = this.defs.get(id);
    if (!s || !d || s.status !== 'active') return;
    s.status = 'completed';
    d.onComplete?.(this.ctx);
    this.ctx.bus.emit('quest:completed', { questId: id });
  }

  fail(id: string): void {
    const s = this.state.get(id);
    if (!s || s.status !== 'active') return;
    s.status = 'failed';
    this.ctx.bus.emit('quest:failed', { questId: id });
  }

  private onEvent(match: (o: ObjectiveDef) => boolean, increment = false): void {
    for (const [id, s] of this.state) {
      if (s.status !== 'active') continue;
      const st = this.defs.get(id)!.stages[s.stage];
      let changed = false;
      st.objectives.forEach((o, i) => {
        if (!match(o)) return;
        const target = this.target(o);
        if (s.progress[i] >= target) return;
        s.progress[i] = increment ? s.progress[i] + 1 : target;
        changed = true;
      });
      if (changed) this.checkStage(id);
    }
  }

  private recheckCollect(): void {
    for (const [id, s] of this.state) {
      if (s.status !== 'active') continue;
      const st = this.defs.get(id)!.stages[s.stage];
      let changed = false;
      st.objectives.forEach((o, i) => {
        if (o.kind !== 'collect') return;
        // Si ya se entregó ese objeto en esta etapa, el objetivo de reunirlo queda fijado.
        if (this.deliveredInStage(st, s, o.item)) return;
        const n = Math.min(o.count, this.ctx.itemCount(o.item));
        if (n !== s.progress[i]) { s.progress[i] = n; changed = true; }
      });
      if (changed) this.checkStage(id);
    }
  }

  private deliveredInStage(st: StageDef, s: QuestState, item: string): boolean {
    return st.objectives.some((d, j) => d.kind === 'deliver' && d.item === item && s.progress[j] >= d.count);
  }

  private target(o: ObjectiveDef): number {
    return o.kind === 'collect' || o.kind === 'deliver' || o.kind === 'kill' ? o.count : o.kind === 'flag' ? o.count ?? 1 : 1;
  }

  /** Estado inicial de objetivos que ya se cumplían al entrar en la etapa. */
  private prefill(id: string): void {
    const s = this.state.get(id)!;
    const st = this.defs.get(id)!.stages[s.stage];
    st.objectives.forEach((o, i) => {
      if (o.kind === 'flag' && this.ctx.hasFlag(o.flag)) s.progress[i] = this.target(o);
      if (o.kind === 'collect' && !this.deliveredInStage(st, s, o.item)) s.progress[i] = Math.min(o.count, this.ctx.itemCount(o.item));
    });
  }

  private checkStage(id: string): void {
    const s = this.state.get(id)!;
    const d = this.defs.get(id)!;
    // Bucle: una etapa puede cumplirse al instante al entrar.
    for (let guard = 0; guard < 20 && s.status === 'active'; guard++) {
      this.prefill(id);
      const st = d.stages[s.stage];
      const done = st.objectives.every((o, i) => s.progress[i] >= this.target(o));
      if (!done) return;
      st.onComplete?.(this.ctx);
      if (s.stage + 1 >= d.stages.length) {
        this.complete(id);
        return;
      }
      s.stage++;
      s.progress = d.stages[s.stage].objectives.map(() => 0);
      this.ctx.bus.emit('quest:updated', { questId: id, text: d.stages[s.stage].desc });
    }
  }

  /** Vista para el diario. */
  list(): { id: string; title: string; desc: string; status: QuestStatus; objectives: { text: string; done: boolean }[] }[] {
    const out = [];
    for (const [id, s] of this.state) {
      const d = this.defs.get(id)!;
      const st = d.stages[Math.min(s.stage, d.stages.length - 1)];
      out.push({
        id, title: d.title, desc: st.desc, status: s.status,
        objectives: st.objectives.map((o, i) => {
          const t = this.target(o);
          const prog = t > 1 ? ` (${Math.min(s.progress[i], t)}/${t})` : '';
          return { text: o.text + prog, done: s.progress[i] >= t };
        }),
      });
    }
    return out.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));
  }

  serialize(): object {
    return { state: [...this.state.entries()].map(([id, s]) => ({ id, ...s })) };
  }

  deserialize(d: { state: ({ id: string } & QuestState)[] }): void {
    this.state.clear();
    for (const s of d.state) {
      if (!this.defs.has(s.id)) continue;
      this.state.set(s.id, { status: s.status, stage: s.stage, progress: [...s.progress] });
    }
  }
}
