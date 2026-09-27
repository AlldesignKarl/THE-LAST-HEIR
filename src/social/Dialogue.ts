/**
 * Diálogo por temas: cada NPC tiene temas con condiciones y efectos.
 * Los temas dependen de misiones, reputación, hora, objetos y flags.
 */
import type { Game } from '../game/Game';
import type { NPC } from '../ai/NPCManager';
import { DIALOGUES, type Topic } from '../data/dialogues';

export interface DialogueCtx {
  g: Game;
  npc: NPC;
}

export class DialogueSystem {
  active: NPC | null = null;
  private used = new Set<string>();

  constructor(private readonly g: Game) {}

  start(npc: NPC): void {
    const g = this.g;
    if (!npc.c.alive) return;
    if (g.reputation.hostile(npc.def.village)) {
      g.ui.say(npc.def.name, npc.c.faction === 'guard' ? '¡Alto ahí, criminal!' : 'Apártate de mí.', 3);
      return;
    }
    this.active = npc;
    npc.talking = true;
    g.bus.emit('npc:talked', { npcId: npc.def.id });
    const d = DIALOGUES[npc.def.id];
    this.show(d ? d.greet({ g, npc }) : GREETS[(npc.def.id.length + g.time.day) % GREETS.length]);
  }

  private topics(): Topic[] {
    const npc = this.active!;
    const ctx = { g: this.g, npc };
    const d = DIALOGUES[npc.def.id];
    const list: Topic[] = [];
    if (!d) return genericTopics(npc);
    for (const t of d.topics) {
      if (t.once && this.used.has(`${npc.def.id}:${t.id}`)) continue;
      if (!t.cond || t.cond(ctx)) list.push(t);
    }
    return list;
  }

  private show(text: string): void {
    const g = this.g;
    const npc = this.active!;
    const ctx = { g, npc };
    const opts = this.topics().map((t) => ({
      text: typeof t.text === 'function' ? t.text(ctx) : t.text,
      onSelect: () => {
        if (t.once) this.used.add(`${npc.def.id}:${t.id}`);
        const reply = typeof t.reply === 'function' ? t.reply(ctx) : t.reply;
        t.effect?.(ctx);
        if (t.opensTrade) {
          const ok = g.economy.canTrade(npc.def.id, npc.def.village);
          if (ok.ok) { this.endQuiet(); g.ui.openTrade(npc.def.id); return; }
          this.show(ok.reason ?? 'Hoy no.');
          return;
        }
        if (t.ends) { g.ui.closeDialogue(); if (reply) g.ui.say(npc.def.name, reply, 3); return; }
        if (this.active) this.show(reply);
      },
    }));
    opts.push({ text: 'Adiós.', onSelect: () => g.ui.closeDialogue() });
    g.ui.showDialogue({ name: npc.def.name, role: npc.def.role, text, options: opts });
  }

  private endQuiet(): void {
    if (this.active) this.active.talking = false;
    this.active = null;
  }

  /** Llamado por la UI al cerrar. */
  end(): void {
    this.endQuiet();
  }

  serialize(): object {
    return { used: [...this.used] };
  }

  deserialize(d: { used: string[] }): void {
    this.used = new Set(d.used ?? []);
  }
}

const GREETS = ['Dios os guarde.', 'Buenas.', '¿Qué se os ofrece?', 'Hola, Martín. ¿Alguna novedad de tu padre?', 'Tengo faena, pero decid.'];

/** Conversación básica para los vecinos sin diálogo propio: oficio, rumores y trato. */
function genericTopics(npc: NPC): Topic[] {
  const def = npc.def;
  const list: Topic[] = [
    { id: 'job', text: '¿A qué os dedicáis?', reply: `Soy ${def.role.toLowerCase()}. ${def.barks[0] ?? ''}` },
    { id: 'news', text: '¿Qué se cuenta por el pueblo?', reply: () => def.barks[Math.floor(Math.random() * def.barks.length)] ?? 'Poca cosa.' },
  ];
  if (def.trader) list.push({ id: 'trade', text: 'Quiero comerciar.', reply: 'Mirad lo que tengo.', opensTrade: true });
  return list;
}
