/**
 * Interfaz del multijugador: menú "Jugar con amigos" (crear servidor,
 * unirse con enlace o código, tus servidores), invitación con enlace,
 * lista de jugadores en la pausa, contador en pantalla y chat (Enter).
 */
import type { Game } from '../game/Game';
import { MAX_PLAYERS, parseServerId } from '../net/Multiplayer';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export class MultiplayerUI {
  private hud = h('div', 'mp-hud');
  private count = h('div', 'mp-count');
  private log = h('div', 'mp-log');
  private input = h('input', 'mp-input');
  private chatBtn = h('button', 'mp-chatbtn', 'Chat');
  private typing = false;

  constructor(private readonly g: Game) {
    this.input.maxLength = 140;
    this.input.placeholder = 'Escribe y pulsa Enter';
    this.input.style.display = 'none';
    this.hud.append(this.count, this.log, this.input);
    this.hud.style.display = 'none';
    this.chatBtn.style.display = 'none';
    g.ui.root.append(this.hud, this.chatBtn);
    this.chatBtn.onclick = (e) => { e.stopPropagation(); this.openChat(); };
    g.mp.onChange = () => this.render();
    window.addEventListener('keydown', (e) => {
      if (!g.mp.active) return;
      if (this.typing) {
        if (e.key === 'Enter') { g.mp.sendChat(this.input.value); this.closeChat(); e.preventDefault(); }
        else if (e.key === 'Escape') { this.closeChat(); e.preventDefault(); }
        return;
      }
      if (e.key === 'Enter' && g.started && !g.ui.blocking && !e.repeat) {
        e.preventDefault();
        this.openChat();
      }
    });
    this.input.addEventListener('blur', () => { if (this.typing) this.closeChat(); });
    setInterval(() => this.render(), 1000);
  }

  private openChat(): void {
    this.typing = true;
    this.input.style.display = 'block';
    this.input.value = '';
    this.g.input.clearAll();
    this.g.input.exitPointerLock();
    this.hud.classList.add('typing');
    setTimeout(() => this.input.focus(), 0);
  }

  private closeChat(): void {
    this.typing = false;
    this.input.style.display = 'none';
    this.input.blur();
    this.hud.classList.remove('typing');
    if (!this.g.ui.blocking && !this.g.input.touchMode) this.g.input.requestPointerLock();
  }

  /** HUD: jugadores y últimas líneas de chat (se desvanecen). */
  render(): void {
    const mp = this.g.mp;
    const on = mp.active && this.g.started;
    this.hud.style.display = on ? 'block' : 'none';
    this.chatBtn.style.display = on && this.g.input.touchMode ? 'block' : 'none';
    if (!on) return;
    const players = mp.players();
    this.count.textContent = `${mp.world?.name ?? 'Servidor'} · ${players.length}/${MAX_PLAYERS}`;
    const now = performance.now();
    const lines = mp.chat.filter((l) => this.typing || now - l.t < 12000).slice(-6);
    this.log.innerHTML = lines.map((l) => l.who ? `<div${l.me ? ' class="me"' : ''}><b>${esc(l.who)}:</b> ${esc(l.text)}</div>` : `<div class="sys">${esc(l.text)}</div>`).join('');
  }

  // ------------------------------------------------------------ menú

  /** Pantalla principal del multijugador. */
  openMenu(): void {
    const g = this.g;
    g.ui.openCustom((el) => {
      el.classList.add('menu-bg');
      const p = h('div', 'panel mp-panel', '<h2>Jugar con amigos</h2>');
      const info = h('div', 'muted', 'Conectando…');
      p.append(info);
      const back = h('button', 'btn', 'Volver');
      back.onclick = () => g.ui.openMainMenu(g.save.hasAny());
      el.append(p);
      g.mp.ready.then(async (ok) => {
        info.remove();
        if (!ok) {
          p.append(h('p', '', 'El multijugador funciona en la versión publicada del juego en <b>claude.ai</b> (necesita la sala en tiempo real y la base de datos de la página). Aquí solo está disponible la partida individual.'));
          p.append(back);
          return;
        }
        p.append(h('p', 'muted', `Un servidor es un mundo compartido para hasta ${MAX_PLAYERS} personas a la vez. Los árboles talados, la piedra de la cantera, las barcas, la hora y el tiempo son comunes; tu inventario y tu historia son tuyos. Todo se guarda solo.`));
        // Crear
        p.append(h('h3', '', 'Crear un servidor'));
        const row = h('div', 'mp-row');
        const name = h('input', 'mp-text');
        name.placeholder = 'Nombre (p. ej. «Los de Robledo»)';
        name.maxLength = 40;
        const create = h('button', 'btn inline', 'Crear y entrar');
        row.append(name, create);
        p.append(row);
        const msg = h('div', 'mp-msg');
        create.onclick = async () => {
          create.disabled = true;
          msg.textContent = 'Creando…';
          const r = await g.mp.createServer(name.value);
          if ('error' in r) { msg.textContent = r.error; create.disabled = false; return; }
          await this.enter(r.sid, msg);
          create.disabled = false;
        };
        // Unirse
        p.append(h('h3', '', 'Unirse con un enlace o código'));
        const row2 = h('div', 'mp-row');
        const code = h('input', 'mp-text');
        code.placeholder = 'Pega el enlace de invitación';
        const join = h('button', 'btn inline', 'Unirse');
        join.onclick = async () => {
          const sid = parseServerId(code.value);
          if (!sid) { msg.textContent = 'Ese enlace o código no es válido.'; return; }
          join.disabled = true;
          await this.enter(sid, msg);
          join.disabled = false;
        };
        row2.append(code, join);
        p.append(row2, msg);
        // Tus servidores
        const mine = await g.mp.myServers();
        if (mine.length) {
          p.append(h('h3', '', 'Tus servidores'));
          for (const s of mine.slice(0, 8)) {
            const when = s.savedAt ? new Date(s.savedAt).toLocaleDateString() : '';
            const b = h('button', 'btn', `${esc(s.name)} <span class="muted">${s.owner ? 'tuyo · ' : ''}${when}</span>`);
            b.onclick = async () => { b.disabled = true; await this.enter(s.sid, msg); b.disabled = false; };
            p.append(b);
          }
        }
        p.append(back);
      });
    });
  }

  /** Invitación recibida (el enlace trae `#s-<id>`). */
  openJoin(sid: string): void {
    const g = this.g;
    g.ui.openCustom((el) => {
      el.classList.add('menu-bg');
      const p = h('div', 'panel mp-panel', '<h2>Invitación</h2>');
      const t = h('p', '', 'Buscando el servidor…');
      const msg = h('div', 'mp-msg');
      const go = h('button', 'btn', 'Entrar al servidor');
      go.disabled = true;
      const solo = h('button', 'btn', 'Jugar solo');
      solo.onclick = () => g.ui.openMainMenu(g.save.hasAny());
      p.append(t, go, msg, solo);
      el.append(p);
      g.mp.ready.then(async (ok) => {
        if (!ok) { t.innerHTML = 'Este enlace es de una partida multijugador, que solo funciona dentro de claude.ai.'; return; }
        const info = await g.mp.peek(sid);
        t.innerHTML = info ? `Te han invitado a <b>${esc(info.name)}</b>.` : 'Te han invitado a un servidor nuevo (aún sin guardar).';
        go.disabled = false;
        go.onclick = async () => { go.disabled = true; await this.enter(sid, msg); go.disabled = false; };
      });
    });
  }

  private async enter(sid: string, msg: HTMLElement): Promise<void> {
    const g = this.g;
    msg.textContent = 'Entrando…';
    const r = await g.mp.join(sid);
    if (!r.ok) { msg.textContent = r.reason; return; }
    g.ui.close();
    g.enterGame();
    this.render();
    g.ui.showToast('Multijugador', `Estás en «${esc(g.mp.world?.name ?? '')}». Invita desde la pausa (Esc).`);
  }

  // ------------------------------------------------------------ pausa

  /** Bloque de la pausa: invitar, jugadores, chat. */
  pauseSection(p: HTMLElement): void {
    const g = this.g;
    const mp = g.mp;
    const players = mp.players();
    p.append(h('h3', '', `${esc(mp.world?.name ?? 'Servidor')} · ${players.length}/${MAX_PLAYERS} jugadores`));
    const ul = h('div', 'mp-players');
    ul.innerHTML = players.map((x) => `<div>${x.me ? '● ' : '○ '}${esc(x.name)}${x.guest ? ' <span class="muted">(invitado)</span>' : ''}</div>`).join('');
    p.append(ul);
    p.append(h('div', 'muted', 'Invita con este enlace (tus amigos necesitan acceso a la página del juego):'));
    const row = h('div', 'mp-row');
    const link = h('input', 'mp-text');
    link.readOnly = true;
    link.value = mp.inviteLink();
    link.onclick = () => link.select();
    const copy = h('button', 'btn inline', 'Copiar enlace');
    copy.onclick = () => {
      link.select();
      const done = () => { copy.textContent = 'Copiado'; setTimeout(() => { copy.textContent = 'Copiar enlace'; }, 1500); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link.value).then(done, () => { document.execCommand?.('copy'); done(); });
      else { document.execCommand?.('copy'); done(); }
    };
    row.append(link, copy);
    p.append(row);
    if (!mp.canPersist) p.append(h('div', 'mp-msg', 'Tu acceso a la página es de solo lectura: juegas y te ven, pero el mundo lo guarda otro jugador con permiso de escritura. Tu partida se guarda en este navegador.'));
    if (mp.status) p.append(h('div', 'mp-msg', esc(mp.status)));
    const chat = h('button', 'btn', 'Chat <span class="muted">(Enter)</span>');
    chat.onclick = () => { g.ui.close(); setTimeout(() => this.openChat(), 50); };
    p.append(chat);
  }
}
