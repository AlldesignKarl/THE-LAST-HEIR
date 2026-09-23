/**
 * Interfaz (DOM). HUD mínimo que solo aparece cuando hace falta y
 * pantallas modales coherentes con la época. La UI escucha eventos del
 * bus; la lógica de juego nunca manipula el DOM directamente.
 */
import type { Game } from '../game/Game';
import { ITEMS, itemDef, type ItemCategory } from '../data/items';
import type { DocumentDef } from '../data/documents';
import { WEAPONS } from '../combat/WeaponDefs';
import { POIS, WORLD_HALF, ROADS, STREAM, BUILDINGS, VILLAGES } from '../world/WorldLayout';
import { WEATHER_NAMES } from '../env/Weather';

export interface DialogueOption { text: string; onSelect: () => void; disabled?: boolean }
export interface DialogueView { name: string; role: string; text: string; options: DialogueOption[] }

type ScreenId = 'menu' | 'pause' | 'inventory' | 'document' | 'journal' | 'map' | 'sleep' | 'death' | 'trade' | 'controls' | 'options' | 'load';

const CAT_NAMES: Record<ItemCategory, string> = {
  weapon: 'Armas', tool: 'Herramientas', ammo: 'Munición', food: 'Comida', drink: 'Bebida', resource: 'Materiales',
  quest: 'Objetos de misión', document: 'Documentos', light: 'Luz', armor: 'Protección', misc: 'Varios',
};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class UIManager {
  readonly root: HTMLElement;
  private crosshair = h('div', 'crosshair');
  private prompt = h('div', 'prompt');
  private vitals = h('div', 'vitals');
  private hpBar = h('div', 'bar');
  private stBar = h('div', 'bar st');
  private needs = h('div', 'needs');
  private weapon = h('div', 'weapon');
  private notes = h('div', 'notes');
  private banner = h('div', 'banner');
  private toast = h('div', 'toast');
  private vignette = h('div', 'vignette');
  private fadeEl = h('div', 'fade');
  private compass = h('div', 'compass');
  private subtitle = h('div', 'subtitle');
  readonly perf = h('div', 'perf');
  private hint = h('div', 'hint');
  private screens = new Map<ScreenId, HTMLElement>();
  private dialogueEl = h('div', 'dialogue');
  current: ScreenId | null = null;
  dialogueOpen = false;
  private openContainerId: string | null = null;
  private selectedItem: string | null = null;
  private vitalsShowT = 0;
  private lastHp = 100;
  private lastSt = 100;
  private bannerT = 0;
  private toastT = 0;
  private subtitleT = 0;
  private damageT = 0;
  private journalTab: 'quests' | 'clues' | 'rep' | 'notes' = 'quests';
  private mapImage: HTMLCanvasElement | null = null;
  private tradeNpc: string | null = null;
  onNewGame: (() => void) | null = null;
  onContinue: (() => void) | null = null;

  constructor(private readonly g: Game) {
    this.root = document.getElementById('ui-root')!;
    this.vitals.append(this.hpBar, this.stBar);
    this.hpBar.innerHTML = '<i></i>';
    this.stBar.innerHTML = '<i></i>';
    this.dialogueEl.style.display = 'none';
    this.dialogueEl.style.pointerEvents = 'auto';
    this.root.append(this.vignette, this.crosshair, this.prompt, this.vitals, this.needs, this.weapon, this.notes, this.banner,
      this.toast, this.compass, this.subtitle, this.hint, this.dialogueEl, this.fadeEl, this.perf);
    for (const id of ['menu', 'pause', 'inventory', 'document', 'journal', 'map', 'sleep', 'death', 'trade', 'controls', 'options', 'load'] as ScreenId[]) {
      const s = h('div', 'screen');
      this.screens.set(id, s);
      this.root.append(s);
    }
    g.bus.on('notify', (e) => this.notify(e.text, e.kind ?? 'info'));
    g.bus.on('player:damaged', (e) => { if (!e.blocked) this.damageT = Math.min(1, 0.35 + e.amount / 40); });
    g.bus.on('quest:updated', (e) => this.showToast('Diario actualizado', e.text));
    g.bus.on('quest:started', (e) => this.showToast('Nueva tarea', g.quests.title(e.questId)));
    g.bus.on('quest:completed', (e) => this.showToast('Tarea cumplida', g.quests.title(e.questId)));
    g.bus.on('raid:spotted', (e) => this.showBanner(`¡ENEMIGOS AL ${e.direction}!`, 'Suena la campana de San Millán', 7));
    g.bus.on('raid:ended', (e) => this.showBanner(e.result === 'repelled' ? 'El ataque ha sido rechazado' : 'Robledo ha sufrido el saqueo', e.summary, 7));
  }

  // ------------------------------------------------------------ HUD

  notify(text: string, kind: string): void {
    const n = h('div', `note ${kind}`);
    n.textContent = text;
    this.notes.append(n);
    while (this.notes.children.length > 6) this.notes.firstChild?.remove();
    setTimeout(() => { n.style.opacity = '0'; }, kind === 'quest' || kind === 'alert' ? 6500 : 4200);
    setTimeout(() => n.remove(), kind === 'quest' || kind === 'alert' ? 7200 : 4900);
  }

  showBanner(text: string, sub: string, seconds: number): void {
    this.banner.innerHTML = `${text}<small>${sub}</small>`;
    this.banner.classList.add('show');
    this.bannerT = performance.now() / 1000 + seconds;
  }

  showToast(head: string, text: string): void {
    this.toast.innerHTML = `<div class="h">${head}</div><div>${text}</div>`;
    this.toast.classList.add('show');
    this.toastT = performance.now() / 1000 + 5;
  }

  /** Subtítulos (voces placeholder: los NPCs "hablan" en texto). */
  say(name: string, text: string, seconds = 4): void {
    this.subtitle.innerHTML = `<b>${name}:</b> ${text}`;
    this.subtitle.classList.add('show');
    this.subtitleT = performance.now() / 1000 + seconds;
  }

  fade(seconds: number, mid: () => void): void {
    this.fadeEl.style.transition = `opacity ${seconds}s`;
    this.fadeEl.style.opacity = '1';
    setTimeout(() => {
      mid();
      this.fadeEl.style.opacity = '0';
    }, seconds * 1000);
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  updateHUD(dt: number): void {
    const g = this.g;
    const v = g.vitals;
    const inGame = this.current === null && !this.dialogueOpen;
    // Aviso de interacción.
    const f = g.interaction.focus;
    if (inGame && f.kind !== 'none') {
      this.prompt.innerHTML = `<div class="t">${f.text}</div><div class="s">${f.sub ?? ''}</div>`;
      this.prompt.classList.add('show');
    } else if (inGame && g.interaction.carried) {
      const canStore = g.interaction.carried.item && !ITEMS[g.interaction.carried.item.itemId]?.heavy;
      this.prompt.innerHTML = g.input.touchMode
        ? `<div class="s">Agarrar: soltar · Atacar: lanzar${canStore ? ' · Usar: guardar' : ''}</div>`
        : `<div class="s">[R] Soltar · [Clic] Lanzar${canStore ? ' · [E] Guardar' : ''}</div>`;
      this.prompt.classList.add('show');
    } else this.prompt.classList.remove('show');
    // Barras: solo visibles al cambiar o si no están llenas.
    if (Math.abs(v.health - this.lastHp) > 0.05 || Math.abs(v.stamina - this.lastSt) > 0.05) this.vitalsShowT = 3;
    this.lastHp = v.health;
    this.lastSt = v.stamina;
    const needShow = v.health < v.maxHealth * 0.99 || v.stamina < v.staminaMax - 1;
    this.vitalsShowT = Math.max(0, this.vitalsShowT - dt);
    this.vitals.style.opacity = inGame && (needShow || this.vitalsShowT > 0) ? '1' : '0';
    (this.hpBar.firstChild as HTMLElement).style.width = `${(v.health / v.maxHealth) * 100}%`;
    (this.stBar.firstChild as HTMLElement).style.width = `${v.stamina}%`;
    // Necesidades: solo cuando bajan.
    const parts: string[] = [];
    if (v.hunger < 40) parts.push(`<span class="${v.hunger < 15 ? 'bad' : 'warn'}">${v.hunger < 15 ? 'Hambriento' : 'Con hambre'}</span>`);
    if (v.thirst < 40) parts.push(`<span class="${v.thirst < 15 ? 'bad' : 'warn'}">${v.thirst < 15 ? 'Sediento' : 'Con sed'}</span>`);
    if (v.warmth < 45) parts.push(`<span class="${v.warmth < 15 ? 'bad' : 'warn'}">${v.warmth < 15 ? 'Helado' : 'Frío'}</span>`);
    if (v.bleeding > 0) parts.push('<span class="bad">Sangrando</span>');
    if (g.inventory.overEncumbered) parts.push('<span class="warn">Sobrecargado</span>');
    this.needs.innerHTML = inGame ? parts.join('') : '';
    // Arma equipada (se desvanece si no se usa).
    const main = g.equipment.slots.main;
    const wname = main ? itemDef(main).name : 'Manos desnudas';
    const off = g.equipment.slots.off;
    let extra = '';
    if (main && itemDef(main).weapon === 'bow') extra = `Flechas: ${g.inventory.count('arrow')}`;
    if (off === 'torch' && g.equipment.torchLit) extra += (extra ? ' · ' : '') + 'Antorcha';
    if (off === 'shield') extra += (extra ? ' · ' : '') + 'Escudo';
    this.weapon.innerHTML = `<div class="n">${wname}</div><div class="a">${extra}</div>`;
    this.weapon.style.opacity = inGame && (g.combat?.recentlyActive ?? false) ? '1' : inGame ? '0.35' : '0';
    this.crosshair.style.opacity = inGame ? '1' : '0';
    this.crosshair.classList.toggle('bow', !!g.combat?.aimingBow);
    // Temporizadores.
    // (Reloj real: independiente de la tasa de frames.)
    const now = performance.now() / 1000;
    if (this.bannerT > 0 && now > this.bannerT) { this.bannerT = 0; this.banner.classList.remove('show'); }
    if (this.toastT > 0 && now > this.toastT) { this.toastT = 0; this.toast.classList.remove('show'); }
    if (this.subtitleT > 0 && now > this.subtitleT) { this.subtitleT = 0; this.subtitle.classList.remove('show'); }
    this.damageT = Math.max(0, this.damageT - dt * 1.5);
    const lowHp = v.health < 25 ? 0.35 + Math.sin(performance.now() / 300) * 0.1 : 0;
    this.vignette.style.opacity = String(Math.max(this.damageT, lowHp));
    // Brújula durante alertas.
    if (g.raids?.active) {
      this.compass.style.opacity = '1';
      const yaw = ((-g.player.yaw * 180) / Math.PI + 360) % 360;
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
      this.compass.textContent = `· ${dirs[Math.round(yaw / 45) % 8]} ·`;
    } else this.compass.style.opacity = '0';
  }

  // ------------------------------------------------------------ gestión de pantallas

  get blocking(): boolean {
    return this.current !== null || this.dialogueOpen;
  }

  private show(id: ScreenId, build: (el: HTMLElement) => void): void {
    for (const [k, s] of this.screens) s.classList.toggle('show', k === id);
    const el = this.screens.get(id)!;
    el.innerHTML = '';
    build(el);
    // Botón de cierre visible (imprescindible en pantallas táctiles, sin teclado).
    if (id === 'inventory' || id === 'journal' || id === 'map') {
      const x = h('button', 'close-x', '✕');
      x.title = 'Cerrar';
      x.onclick = () => this.close();
      el.append(x);
    }
    this.current = id;
    this.g.onUIChanged();
  }

  close(): void {
    for (const s of this.screens.values()) s.classList.remove('show');
    this.current = null;
    this.openContainerId = null;
    this.tradeNpc = null;
    this.g.onUIChanged();
  }

  /** Esc / Tab / J / M (se llama cada frame). */
  handleKeys(): void {
    const inp = this.g.input;
    if (inp.consume('pause')) {
      // Esc también suelta el pointer lock (que abre la pausa): no cerrarla en el mismo gesto.
      if (this.current === 'pause' && performance.now() - this.pauseOpenedAt < 400) return;
      if (this.dialogueOpen) this.closeDialogue();
      else if (this.current === 'menu' || this.current === 'death') { /* nada */ }
      else if (this.current) this.close();
      else this.openPause();
    }
    if (this.current === 'menu' || this.current === 'death') {
      inp.consume('inventory'); inp.consume('journal'); inp.consume('map');
      return;
    }
    if (inp.consume('inventory')) this.current === 'inventory' ? this.close() : !this.dialogueOpen && this.openInventory();
    if (inp.consume('journal')) this.current === 'journal' ? this.close() : !this.dialogueOpen && this.openJournal();
    if (inp.consume('map')) this.current === 'map' ? this.close() : !this.dialogueOpen && this.openMap();
    if (inp.consume('perf')) this.perf.classList.toggle('show');
  }

  // ------------------------------------------------------------ menú principal

  openMainMenu(hasSave: boolean): void {
    this.show('menu', (el) => {
      el.classList.add('menu-bg');
      const p = h('div', '', `<h1 class="menu-title">The Last Heir</h1><div class="menu-sub">El Arca de Olmedo · Valle de Arnós, año de 1497</div>`);
      p.style.textAlign = 'center';
      const box = h('div', 'panel');
      box.style.minWidth = '320px';
      box.style.margin = '0 auto';
      const b1 = h('button', 'btn', 'Continuar');
      b1.disabled = !hasSave;
      b1.onclick = () => this.onContinue?.();
      const b2 = h('button', 'btn', 'Nueva partida');
      b2.onclick = () => this.onNewGame?.();
      const b3 = h('button', 'btn', 'Cargar partida');
      b3.onclick = () => this.openLoad(true);
      const b4 = h('button', 'btn', 'Controles');
      b4.onclick = () => this.openControls(true);
      box.append(b1, b2, b3, b4);
      const note = h('div', 'muted', 'Prototipo jugable (vertical slice). Modelos, texturas y sonidos son placeholders procedurales.');
      note.style.marginTop = '14px';
      note.style.maxWidth = '420px';
      box.append(note);
      p.append(box);
      el.append(p);
    });
  }

  // ------------------------------------------------------------ pausa, guardar, cargar

  private pauseOpenedAt = 0;

  openPause(): void {
    this.pauseOpenedAt = performance.now();
    this.show('pause', (el) => {
      const p = h('div', 'panel', '<h2>Pausa</h2>');
      const mk = (t: string, fn: () => void) => { const b = h('button', 'btn', t); b.onclick = fn; p.append(b); };
      mk('Continuar', () => this.close());
      for (const slot of ['1', '2', '3']) {
        const info = this.g.save.info(slot);
        mk(`Guardar en ranura ${slot}${info ? ` <span class="muted">(${info})</span>` : ''}`, () => {
          this.g.save.save(slot);
          this.close();
        });
      }
      mk('Cargar partida', () => this.openLoad(false));
      mk('Controles', () => this.openControls(false));
      mk('Opciones', () => this.openOptions());
      mk('Salir al menú principal', () => { this.g.save.save('auto'); location.href = location.pathname + location.search; });
      el.append(p);
    });
  }

  openLoad(fromMenu: boolean): void {
    this.show('load', (el) => {
      const p = h('div', 'panel', '<h2>Cargar partida</h2>');
      for (const slot of ['auto', '1', '2', '3']) {
        const info = this.g.save.info(slot);
        const b = h('button', 'btn', `${slot === 'auto' ? 'Autoguardado' : `Ranura ${slot}`} <span class="muted">${info ?? '— vacía —'}</span>`);
        b.disabled = !info;
        b.onclick = () => this.g.save.requestLoad(slot);
        p.append(b);
      }
      const back = h('button', 'btn', 'Volver');
      back.onclick = () => (fromMenu ? this.openMainMenu(this.g.save.hasAny()) : this.openPause());
      p.append(back);
      el.append(p);
    });
  }

  openControls(fromMenu: boolean): void {
    this.show('controls', (el) => {
      const p = h('div', 'panel', `<h2>Controles</h2><div class="keys">
        <div><b>WASD</b> Moverse · <b>Shift</b> Correr · <b>Ctrl</b> Agacharse · <b>Espacio</b> Saltar</div>
        <div><b>E</b> Usar / coger · <b>R</b> Agarrar, transportar y soltar objetos</div>
        <div><b>Clic izq.</b> Ataque ligero · <b>Mantener</b> ataque fuerte / tensar arco</div>
        <div><b>Clic der.</b> Bloquear · <b>C</b> Esquivar · <b>F</b> Patada</div>
        <div><b>T</b> Antorcha en la mano izquierda · <b>1–4</b> Armas rápidas</div>
        <div><b>Tab / I</b> Inventario · <b>J</b> Diario · <b>M</b> Mapa · <b>Esc</b> Pausa · <b>F3</b> Rendimiento</div>
        <h3>Pantalla táctil</h3>
        <div><b>Pulgar izq.</b> Joystick (aparece donde tocas) · <b>Arrastrar a la derecha</b> Mirar</div>
        <div><b>Atacar</b> tocar: ligero · mantener: fuerte / tensar arco (arrastra para apuntar)</div>
        <div><b>Correr / Agachar</b> se quedan activos hasta volver a tocarlos · <b>Arma</b> cambia de arma</div>
      </div>`);
      const back = h('button', 'btn', 'Volver');
      back.onclick = () => (fromMenu ? this.openMainMenu(this.g.save.hasAny()) : this.openPause());
      p.append(back);
      el.append(p);
    });
  }

  openOptions(): void {
    this.show('options', (el) => {
      const g = this.g;
      const p = h('div', 'panel', '<h2>Opciones</h2>');
      const q = h('div', '', `<h3>Calidad gráfica</h3>`);
      for (const name of ['low', 'medium', 'high'] as const) {
        const b = h('button', 'btn inline', { low: 'Baja', medium: 'Media', high: 'Alta' }[name]);
        if (g.qualityName === name) b.classList.add('sel');
        b.onclick = () => { g.setQuality(name); this.openOptions(); };
        q.append(b);
      }
      const s = h('div', '', `<h3>Sensibilidad del ratón</h3>`);
      const range = h('input') as HTMLInputElement;
      range.type = 'range'; range.min = '0.0008'; range.max = '0.005'; range.step = '0.0002';
      range.value = String(g.input.sensitivity);
      range.oninput = () => { g.input.sensitivity = Number(range.value); g.saveSettings(); };
      s.append(range);
      const a = h('div', '', `<h3>Volumen</h3>`);
      const vol = h('input') as HTMLInputElement;
      vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.05';
      vol.value = String(g.audio.volume);
      vol.oninput = () => { g.audio.setVolume(Number(vol.value)); g.saveSettings(); };
      a.append(vol);
      const back = h('button', 'btn', 'Volver');
      back.onclick = () => this.openPause();
      p.append(q, s, a, back);
      el.append(p);
    });
  }

  // ------------------------------------------------------------ inventario / contenedor

  openInventory(): void {
    this.openContainerId = null;
    this.renderInventory();
  }

  openContainer(id: string): void {
    this.openContainerId = id;
    this.g.bus.emit('sfx', { id: 'chest_open' });
    this.renderInventory();
  }

  private renderInventory(): void {
    const g = this.g;
    this.show('inventory', (el) => {
      const panel = h('div', 'panel');
      panel.style.minWidth = 'min(760px, 94vw)';
      const inv = g.inventory;
      const cont = this.openContainerId ? g.containers.get(this.openContainerId) : null;
      panel.append(h('h2', '', cont ? cont.name : 'Inventario'));
      const row = h('div', 'row');
      const left = h('div', 'col item-list');
      left.append(h('div', 'muted', `Peso ${inv.weight.toFixed(1)} / ${inv.maxWeight} kg · <span class="gold">${inv.coins} mrv</span>`));
      const listFor = (target: HTMLElement, items: { id: string; count: number }[], onClick: (id: string) => void, equippedMark: boolean) => {
        const byCat = new Map<ItemCategory, { id: string; count: number }[]>();
        for (const it of items) {
          const d = ITEMS[it.id];
          if (!d) continue;
          if (!byCat.has(d.category)) byCat.set(d.category, []);
          byCat.get(d.category)!.push(it);
        }
        if (items.length === 0) target.append(h('div', 'muted', 'Vacío.'));
        for (const [cat, list] of byCat) {
          target.append(h('div', 'cat', CAT_NAMES[cat]));
          for (const it of list) {
            const d = ITEMS[it.id];
            const eq = equippedMark && Object.values(g.equipment.slots).includes(it.id);
            const b = h('button', `btn${this.selectedItem === it.id ? ' sel' : ''}`, `<span class="${eq ? 'equipped' : ''}">${d.name}${eq ? ' ·' : ''}</span><span>${it.count > 1 ? `×${it.count}` : ''} ${(d.weight * it.count).toFixed(1)} kg</span>`);
            b.onclick = () => onClick(it.id);
            target.append(b);
          }
        }
      };
      if (cont) {
        listFor(left, inv.grouped(), (id) => {
          const n = inv.remove(id, 1);
          if (n) { cont.inv.add(id, n); g.equipment.validate(); g.bus.emit('item:removed', { itemId: id, count: n, reason: 'store' }); }
          this.renderInventory();
        }, true);
        const right = h('div', 'col item-list');
        right.append(h('div', 'muted', `${cont.owner ? '<span style="color:#e0a060">Ajeno: coger a la vista es robar</span>' : 'Tuyo'}${cont.inv.coins ? ` · <span class="gold">${cont.inv.coins} mrv</span>` : ''}`));
        listFor(right, cont.inv.grouped(), (id) => this.takeFromContainer(id, 1), false);
        const all = h('button', 'btn inline', 'Tomarlo todo');
        all.onclick = () => {
          for (const it of cont.inv.grouped()) this.takeFromContainer(it.id, it.count, true);
          if (cont.inv.coins) this.takeCoins();
          this.renderInventory();
        };
        right.append(all);
        if (cont.inv.coins) {
          const c = h('button', 'btn inline', `Coger ${cont.inv.coins} mrv`);
          c.onclick = () => { this.takeCoins(); this.renderInventory(); };
          right.append(c);
        }
        row.append(left, right);
        panel.append(row, h('div', 'muted', 'Clic en un objeto para moverlo de un lado a otro. Esc para cerrar.'));
      } else {
        listFor(left, inv.grouped(), (id) => { this.selectedItem = id; this.renderInventory(); }, true);
        const right = h('div', 'col');
        const sel = this.selectedItem && inv.has(this.selectedItem) ? itemDef(this.selectedItem) : null;
        if (sel) {
          right.append(h('h3', '', sel.name), h('div', '', sel.desc), h('div', 'muted', `Peso ${sel.weight} kg · Valor ${sel.value} mrv`));
          if (sel.weapon) {
            const w = WEAPONS[sel.weapon];
            right.append(h('div', 'muted', `Daño ${w.light.damage}/${w.heavy.damage} · Alcance ${w.reach} m${w.twoHanded ? ' · A dos manos' : ''}`));
          }
          const acts = h('div');
          const act = (t: string, fn: () => void) => { const b = h('button', 'btn inline', t); b.onclick = () => { fn(); this.renderInventory(); }; acts.append(b); };
          if (sel.doc) act('Leer', () => g.actions.useItem(sel.id));
          else if (sel.food && sel.id !== 'waterskin_empty') act(sel.category === 'drink' ? 'Beber' : 'Comer', () => g.actions.useItem(sel.id));
          if (sel.weapon || sel.offhand || sel.armor) {
            const eq = Object.values(g.equipment.slots).includes(sel.id);
            if (eq) act('Quitar', () => { for (const k of ['main', 'off', 'head', 'body'] as const) if (g.equipment.slots[k] === sel.id) g.equipment.unequip(k); });
            else act('Equipar', () => g.actions.useItem(sel.id));
            for (let i = 0; i < 4; i++) act(`Tecla ${i + 1}`, () => { g.equipment.quick[i] = sel.id; });
          }
          if (sel.id === 'satchel_rodrigo') act('Abrir', () => g.actions.useItem(sel.id));
          if (!sel.questItem) act('Soltar', () => { g.actions.dropItem(sel.id, 1); });
          right.append(acts);
        } else right.append(h('div', 'muted', 'Selecciona un objeto.'));
        const eq = g.equipment;
        const name = (id: string | null) => (id ? itemDef(id).name : '—');
        right.append(h('h3', '', 'Equipo'), h('div', 'kv', `<span class="muted">Mano derecha</span><span>${name(eq.slots.main)}</span><span class="muted">Mano izquierda</span><span>${name(eq.slots.off)}</span><span class="muted">Torso</span><span>${name(eq.slots.body)}</span><span class="muted">Teclas 1–4</span><span>${eq.quick.map((q) => (q ? itemDef(q).name : '—')).join(' · ')}</span>`));
        row.append(left, right);
        panel.append(row);
      }
      el.append(panel);
    });
  }

  private takeFromContainer(id: string, n: number, silent = false): void {
    const g = this.g;
    const cont = g.containers.get(this.openContainerId!);
    if (!cont) return;
    const canN = Math.min(n, cont.inv.count(id));
    let moved = 0;
    for (let i = 0; i < canN; i++) {
      if (!g.inventory.canAdd(id, 1)) break;
      cont.inv.remove(id, 1);
      g.inventory.add(id, 1);
      moved++;
    }
    if (moved === 0) { g.bus.emit('notify', { text: 'No puedes llevar más peso.', kind: 'warning' }); return; }
    if (cont.owner) {
      const witnessed = g.npcs ? g.npcs.witnessesCrime(g.player.pos) : false;
      g.bus.emit('item:stolen', { itemId: id, ownerVillage: cont.owner, witnessed });
      if (witnessed) g.bus.emit('crime', { type: 'theft', village: cont.owner, witnessed: true });
    }
    g.bus.emit('item:acquired', { itemId: id, count: moved, source: 'container' });
    if (!silent) this.renderInventory();
  }

  private takeCoins(): void {
    const g = this.g;
    const cont = g.containers.get(this.openContainerId!);
    if (!cont || !cont.inv.coins) return;
    g.inventory.coins += cont.inv.coins;
    if (cont.owner) {
      const witnessed = g.npcs ? g.npcs.witnessesCrime(g.player.pos) : false;
      if (witnessed) g.bus.emit('crime', { type: 'theft', village: cont.owner, witnessed: true });
    }
    g.bus.emit('notify', { text: `+${cont.inv.coins} mrv`, kind: 'item' });
    cont.inv.coins = 0;
    g.bus.emit('sfx', { id: 'coins' });
  }

  // ------------------------------------------------------------ documentos

  openDocument(doc: DocumentDef): void {
    this.show('document', (el) => {
      const p = h('div', `panel parchment ${doc.style === 'official' ? 'official' : ''}`);
      p.append(h('h2', '', doc.title));
      for (const para of doc.body) p.append(h('p', '', para));
      if (doc.signature) p.append(h('div', 'sig', doc.signature));
      const b = h('button', 'btn', 'Cerrar');
      b.style.color = '#3b2a14';
      b.onclick = () => this.close();
      p.append(b);
      el.append(p);
    });
  }

  // ------------------------------------------------------------ descanso

  openSleep(): void {
    const g = this.g;
    this.show('sleep', (el) => {
      const p = h('div', 'panel', `<h2>Descansar</h2><div class="muted">${g.time.periodName()} · ${g.time.formatClock()} · Día ${g.time.day}</div>`);
      const opt = (t: string, hours: number, sleeping: boolean) => {
        const b = h('button', 'btn', t);
        b.onclick = () => {
          this.close();
          this.fade(0.8, () => g.actions.rest(hours, sleeping));
        };
        p.append(b);
      };
      const dawn = g.actions.hoursUntilDawn();
      opt(`Dormir hasta el alba (${dawn.toFixed(1)} h)`, dawn, true);
      opt('Descansar 1 hora', 1, false);
      opt('Descansar 4 horas', 4, false);
      const c = h('button', 'btn', 'Cancelar');
      c.onclick = () => this.close();
      p.append(c);
      el.append(p);
    });
  }

  // ------------------------------------------------------------ muerte

  openDeath(cause: string): void {
    this.show('death', (el) => {
      el.classList.add('menu-bg');
      const p = h('div', 'panel', `<h1>Has muerto</h1><div class="muted">${cause}</div>`);
      const b = h('button', 'btn', 'Cargar el último guardado');
      b.onclick = () => this.g.save.requestLoad(this.g.save.latestSlot() ?? 'auto');
      b.disabled = !this.g.save.hasAny();
      const n = h('button', 'btn', 'Menú principal');
      n.onclick = () => { location.href = location.pathname + location.search; };
      p.append(b, n);
      el.append(p);
    });
  }

  // ------------------------------------------------------------ diálogo

  showDialogue(view: DialogueView): void {
    this.dialogueOpen = true;
    const el = this.dialogueEl;
    el.innerHTML = '';
    el.style.display = 'block';
    el.append(h('div', '', `<span class="who">${view.name}</span><span class="role">${view.role}</span>`), h('div', 'txt', view.text));
    view.options.forEach((o, i) => {
      const b = h('button', 'btn', `${i + 1}. ${o.text}`);
      b.disabled = !!o.disabled;
      b.onclick = () => o.onSelect();
      el.append(b);
    });
    this.dialogueKeys = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= view.options.length && !view.options[n - 1].disabled) {
        e.preventDefault();
        view.options[n - 1].onSelect();
      }
    };
    window.addEventListener('keydown', this.dialogueKeys);
    this.g.onUIChanged();
  }

  private dialogueKeys: ((e: KeyboardEvent) => void) | null = null;

  closeDialogue(): void {
    if (this.dialogueKeys) window.removeEventListener('keydown', this.dialogueKeys);
    this.dialogueKeys = null;
    this.dialogueOpen = false;
    this.dialogueEl.style.display = 'none';
    this.g.dialogue?.end();
    this.g.onUIChanged();
  }

  // ------------------------------------------------------------ comercio

  openTrade(npcId: string): void {
    this.tradeNpc = npcId;
    if (this.dialogueOpen) {
      if (this.dialogueKeys) window.removeEventListener('keydown', this.dialogueKeys);
      this.dialogueKeys = null;
      this.dialogueOpen = false;
      this.dialogueEl.style.display = 'none';
    }
    this.renderTrade();
  }

  private renderTrade(): void {
    const g = this.g;
    const npcId = this.tradeNpc!;
    const trader = g.economy.trader(npcId);
    const npc = g.npcs?.get(npcId);
    if (!trader || !npc) return;
    this.show('trade', (el) => {
      const panel = h('div', 'panel');
      panel.style.minWidth = '760px';
      panel.append(h('h2', '', `Comerciar con ${npc.def.name}`), h('div', 'muted', `Tú: <span class="gold">${g.inventory.coins} mrv</span> · ${npc.def.name}: <span class="gold">${trader.inv.coins} mrv</span> · ${g.economy.priceNote(npc.def.village)}`));
      const row = h('div', 'row');
      const buy = h('div', 'col item-list', '<h3>Comprar</h3>');
      for (const it of trader.inv.grouped()) {
        const d = itemDef(it.id);
        const price = g.economy.buyPrice(it.id, npc.def.village);
        const b = h('button', 'btn', `<span>${d.name} ×${it.count}</span><span>${price} mrv</span>`);
        b.disabled = g.inventory.coins < price;
        b.onclick = () => { g.economy.buy(npcId, it.id); this.renderTrade(); };
        buy.append(b);
      }
      const sell = h('div', 'col item-list', '<h3>Vender</h3>');
      for (const it of g.inventory.grouped()) {
        const d = itemDef(it.id);
        if (d.questItem || d.value <= 0) continue;
        const eq = Object.values(g.equipment.slots).includes(it.id) && it.count <= 1;
        const price = g.economy.sellPrice(it.id, npc.def.village);
        const b = h('button', 'btn', `<span>${d.name} ×${it.count}${eq ? ' (equipado)' : ''}</span><span>${price} mrv</span>`);
        b.disabled = trader.inv.coins < price || eq;
        b.onclick = () => { g.economy.sell(npcId, it.id); this.renderTrade(); };
        sell.append(b);
      }
      row.append(buy, sell);
      const close = h('button', 'btn', 'Terminar');
      close.onclick = () => this.close();
      panel.append(row, close);
      el.append(panel);
    });
  }

  // ------------------------------------------------------------ diario

  openJournal(): void {
    const g = this.g;
    this.show('journal', (el) => {
      const p = h('div', 'panel');
      p.style.minWidth = 'min(680px, 94vw)';
      p.append(h('h2', '', 'Diario'));
      const tabs = h('div', 'tabs');
      const tab = (id: typeof this.journalTab, t: string) => {
        const b = h('button', `btn${this.journalTab === id ? ' sel' : ''}`, t);
        b.onclick = () => { this.journalTab = id; this.openJournal(); };
        tabs.append(b);
      };
      tab('quests', 'Tareas'); tab('clues', 'El Arca de Olmedo'); tab('rep', 'Reputación'); tab('notes', 'Estado');
      p.append(tabs);
      if (this.journalTab === 'quests') {
        const qs = g.quests.list();
        const active = qs.filter((q) => q.status === 'active');
        const done = qs.filter((q) => q.status !== 'active');
        if (!active.length) p.append(h('div', 'muted', 'No tienes tareas pendientes.'));
        for (const q of active) {
          const d = h('div', 'quest', `<div class="qt">${q.title}</div><div class="muted">${q.desc}</div>`);
          for (const o of q.objectives) d.append(h('div', `obj${o.done ? ' done' : ''}`, `· ${o.text}`));
          p.append(d);
        }
        if (done.length) {
          p.append(h('h3', '', 'Concluidas'));
          for (const q of done) p.append(h('div', 'muted', `${q.status === 'completed' ? '✓' : '✗'} ${q.title}`));
        }
      } else if (this.journalTab === 'clues') {
        const clues = g.story.clues();
        p.append(h('div', 'muted', `Etapa ${g.story.stage} de 10`));
        for (const c of clues) p.append(h('div', 'quest', `<div class="qt">${c.title}</div><div>${c.text}</div>`));
      } else if (this.journalTab === 'rep') {
        for (const r of g.reputation.all()) {
          p.append(h('div', 'quest', `<div class="qt">${r.name}</div><div>${r.tier} <span class="muted">(${Math.round(r.value)})</span></div><div class="muted">${r.note}</div>`));
        }
      } else {
        const v = g.vitals;
        p.append(h('div', 'kv', `
          <span class="muted">Día</span><span>${g.time.day} · ${g.time.periodName()} (${g.time.formatClock()})</span>
          <span class="muted">Tiempo</span><span>${WEATHER_NAMES[g.weather.state]}</span>
          <span class="muted">Salud</span><span>${Math.round(v.health)} / ${v.maxHealth}</span>
          <span class="muted">Hambre</span><span>${Math.round(v.hunger)} %</span>
          <span class="muted">Sed</span><span>${Math.round(v.thirst)} %</span>
          <span class="muted">Calor corporal</span><span>${Math.round(v.warmth)} %</span>
          <span class="muted">Dinero</span><span>${g.inventory.coins} mrv</span>
          <span class="muted">Habilidades</span><span>${g.skills.summary()}</span>`));
      }
      el.append(p);
    });
  }

  // ------------------------------------------------------------ mapa

  openMap(): void {
    const g = this.g;
    this.show('map', (el) => {
      const p = h('div', 'panel', '<h2>Mapa del valle</h2>');
      const size = Math.max(180, Math.min(620, window.innerHeight - (window.innerHeight < 520 ? 90 : 180), window.innerWidth - 60));
      const c = h('canvas', 'map') as HTMLCanvasElement;
      c.width = c.height = size;
      const ctx = c.getContext('2d')!;
      if (!this.mapImage) this.mapImage = this.buildMapImage();
      ctx.drawImage(this.mapImage, 0, 0, size, size);
      const R = 480;
      const toPx = (x: number, z: number) => [((x + R) / (2 * R)) * size, ((z + R) / (2 * R)) * size];
      ctx.font = '15px "IM Fell English", serif';
      ctx.textAlign = 'center';
      for (const poi of POIS) {
        if (!g.discovered.has(poi.id)) continue;
        const [px, pz] = toPx(poi.x, poi.z);
        ctx.fillStyle = '#3b2412';
        ctx.beginPath(); ctx.arc(px, pz, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillText(poi.name, px, pz - 9);
      }
      const [ppx, ppz] = toPx(g.player.pos.x, g.player.pos.z);
      ctx.save();
      ctx.translate(ppx, ppz);
      ctx.rotate(-g.player.yaw);
      ctx.fillStyle = '#8e1a10';
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
      p.append(c, h('div', 'muted', 'Solo aparecen los lugares que has descubierto. Norte arriba.'));
      el.append(p);
    });
  }

  private buildMapImage(): HTMLCanvasElement {
    const g = this.g;
    const S = 320, R = 480;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = (i / S) * 2 * R - R, z = (j / S) * 2 * R - R;
        const hgt = g.hf.heightAt(x, z);
        const hx = g.hf.heightAt(x + 3, z) - hgt;
        const shade = Math.max(-0.4, Math.min(0.4, -hx * 0.25));
        const forest = g.hf.forestDensity(x, z);
        let r = 222, gg = 205, b = 168;
        r -= forest * 50; gg -= forest * 25; b -= forest * 60;
        r -= Math.max(0, hgt - 40) * 0.5; gg -= Math.max(0, hgt - 40) * 0.5; b -= Math.max(0, hgt - 40) * 0.4;
        const k = (j * S + i) * 4;
        img.data[k] = r * (1 + shade); img.data[k + 1] = gg * (1 + shade); img.data[k + 2] = b * (1 + shade); img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const toPx = (x: number, z: number): [number, number] => [((x + R) / (2 * R)) * S, ((z + R) / (2 * R)) * S];
    ctx.strokeStyle = 'rgba(60,90,120,.8)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    STREAM.points.forEach(([x, z], i) => { const [px, pz] = toPx(x, z); i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz); });
    ctx.stroke();
    ctx.strokeStyle = 'rgba(110,70,40,.75)';
    for (const r of ROADS) {
      ctx.lineWidth = r.kind === 'road' ? 1.6 : 1;
      ctx.setLineDash(r.kind === 'trail' ? [3, 3] : []);
      ctx.beginPath();
      r.points.forEach(([x, z], i) => { const [px, pz] = toPx(x, z); i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(70,45,25,.8)';
    for (const b of BUILDINGS) { const [px, pz] = toPx(b.x, b.z); ctx.fillRect(px - 1.5, pz - 1.5, 3, 3); }
    for (const v of VILLAGES) { const [px, pz] = toPx(v.x, v.z); ctx.strokeStyle = 'rgba(70,45,25,.5)'; ctx.beginPath(); ctx.arc(px, pz, (v.radius / (2 * R)) * S, 0, Math.PI * 2); ctx.stroke(); }
    // Borde de pergamino.
    const grd = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.72);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(90,60,20,.55)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, S, S);
    void WORLD_HALF;
    return c;
  }
}
