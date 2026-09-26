/**
 * Controles táctiles (móvil / tableta).
 *
 * - Mitad izquierda: joystick dinámico (aparece donde se apoya el pulgar).
 * - Resto de la pantalla: arrastrar para mirar.
 * - Botones: generan las mismas acciones abstractas que el teclado
 *   (Input.setVirtual), así la lógica del juego no distingue el origen.
 *   Atacar y bloquear también permiten apuntar arrastrando el dedo.
 */
import type { Game } from '../game/Game';
import type { Action } from '../core/Input';

interface ButtonDef {
  a: Action | 'weapon' | 'sprintToggle' | 'crouchToggle' | 'fullscreen';
  label: string;
  cls: string;
  /** Arrastrar sobre el botón también mueve la cámara. */
  look?: boolean;
}

const BUTTONS: ButtonDef[] = [
  { a: 'attack', label: 'Atacar', cls: 'b-attack', look: true },
  { a: 'block', label: 'Bloquear', cls: 'b-block', look: true },
  { a: 'interact', label: 'Usar', cls: 'b-use' },
  { a: 'jump', label: 'Saltar', cls: 'b-jump' },
  { a: 'dodge', label: 'Esquivar', cls: 'b-dodge' },
  { a: 'kick', label: 'Patada', cls: 'b-kick' },
  { a: 'grab', label: 'Agarrar', cls: 'b-grab' },
  { a: 'torch', label: 'Antorcha', cls: 'b-torch' },
  { a: 'weapon', label: 'Arma', cls: 'b-weapon' },
  { a: 'sprintToggle', label: 'Correr', cls: 'b-sprint' },
  { a: 'crouchToggle', label: 'Agachar', cls: 'b-crouch' },
  { a: 'build', label: 'Construir', cls: 'b-build' },
  { a: 'rotate', label: 'Girar', cls: 'b-rot' },
  { a: 'buildPrev', label: '◀', cls: 'b-bprev' },
  { a: 'buildNext', label: '▶', cls: 'b-bnext' },
  { a: 'inventory', label: 'Inventario', cls: 'b-top b-inv' },
  { a: 'journal', label: 'Diario', cls: 'b-top b-jour' },
  { a: 'map', label: 'Mapa', cls: 'b-top b-map' },
  { a: 'pause', label: 'Pausa', cls: 'b-top b-pause' },
  { a: 'fullscreen', label: '⛶', cls: 'b-top b-fs' },
];

type Track =
  | { kind: 'move'; ox: number; oy: number }
  | { kind: 'look'; lx: number; ly: number }
  | { kind: 'button'; def: ButtonDef; el: HTMLElement; lx: number; ly: number };

const STICK_RADIUS = 56;
/** Radianes por píxel relativos a la sensibilidad del ratón. */
const LOOK_SCALE = 1.8;

export class TouchControls {
  readonly el: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private buttons = new Map<string, HTMLElement>();
  private tracks = new Map<number, Track>();
  private sprintOn = false;
  private crouchOn = false;
  private visible = false;
  private orient: HTMLDivElement;

  static isTouchDevice(): boolean {
    try {
      return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    } catch {
      return false;
    }
  }

  constructor(private readonly g: Game) {
    const el = document.createElement('div');
    el.className = 'touch';
    this.el = el;
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'stick';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'knob';
    this.stickBase.append(this.stickKnob);
    el.append(this.stickBase);
    for (const def of BUTTONS) {
      const b = document.createElement('div');
      b.className = `tbtn ${def.cls}`;
      b.textContent = def.label;
      b.dataset.a = def.a;
      el.append(b);
      this.buttons.set(def.a, b);
    }
    this.orient = document.createElement('div');
    this.orient.className = 'touch-orient';
    this.orient.textContent = 'Gira el móvil en horizontal para jugar mejor';
    el.append(this.orient);

    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    const root = document.getElementById('ui-root')!;
    root.prepend(el);
    this.setVisible(false);
  }

  private onDown(e: PointerEvent): void {
    this.g.audio.unlock();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    const target = (e.target as HTMLElement).closest('.tbtn') as HTMLElement | null;
    if (target) {
      const def = BUTTONS.find((b) => b.a === target.dataset.a)!;
      this.tracks.set(e.pointerId, { kind: 'button', def, el: target, lx: e.clientX, ly: e.clientY });
      target.classList.add('on');
      this.press(def, true);
      return;
    }
    if (e.clientX < window.innerWidth * 0.42 && !this.hasMove()) {
      this.tracks.set(e.pointerId, { kind: 'move', ox: e.clientX, oy: e.clientY });
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
      this.stickBase.classList.add('on');
    } else {
      this.tracks.set(e.pointerId, { kind: 'look', lx: e.clientX, ly: e.clientY });
    }
  }

  private onMove(e: PointerEvent): void {
    const t = this.tracks.get(e.pointerId);
    if (!t) return;
    const inp = this.g.input;
    if (t.kind === 'move') {
      let dx = e.clientX - t.ox, dy = e.clientY - t.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) { dx *= STICK_RADIUS / d; dy *= STICK_RADIUS / d; }
      this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // Zona muerta del 12 %.
      const m = Math.min(1, d / STICK_RADIUS);
      const k = m < 0.12 ? 0 : (m - 0.12) / 0.88 / (m || 1);
      inp.setAnalogMove(dx / STICK_RADIUS * k, -dy / STICK_RADIUS * k);
    } else if (t.kind === 'look' || (t.kind === 'button' && t.def.look)) {
      inp.mouseDX += (e.clientX - t.lx) * LOOK_SCALE;
      inp.mouseDY += (e.clientY - t.ly) * LOOK_SCALE;
      t.lx = e.clientX;
      t.ly = e.clientY;
    }
  }

  private onUp(e: PointerEvent): void {
    const t = this.tracks.get(e.pointerId);
    if (!t) return;
    this.tracks.delete(e.pointerId);
    if (t.kind === 'move') {
      this.g.input.setAnalogMove(0, 0);
      this.stickBase.classList.remove('on');
      // Soltar el joystick deja de correr.
      if (this.sprintOn) this.toggleSprint();
    } else if (t.kind === 'button') {
      t.el.classList.remove('on');
      this.press(t.def, false);
    }
  }

  private hasMove(): boolean {
    for (const t of this.tracks.values()) if (t.kind === 'move') return true;
    return false;
  }

  private press(def: ButtonDef, down: boolean): void {
    const inp = this.g.input;
    switch (def.a) {
      case 'weapon': if (down) this.cycleWeapon(); return;
      case 'sprintToggle': if (down) this.toggleSprint(); return;
      case 'crouchToggle':
        if (down) {
          this.crouchOn = !this.crouchOn;
          inp.setVirtual('crouch', this.crouchOn);
          this.buttons.get('crouchToggle')!.classList.toggle('latched', this.crouchOn);
        }
        return;
      case 'fullscreen':
        if (down) this.toggleFullscreen();
        return;
      default:
        inp.setVirtual(def.a, down);
    }
  }

  private toggleSprint(): void {
    this.sprintOn = !this.sprintOn;
    this.g.input.setVirtual('sprint', this.sprintOn);
    this.buttons.get('sprintToggle')!.classList.toggle('latched', this.sprintOn);
  }

  /** Pasa al siguiente arma de la barra rápida (tras la última, manos vacías). */
  private cycleWeapon(): void {
    const eq = this.g.equipment;
    const slots: number[] = [];
    for (let i = 0; i < eq.quick.length && i < 4; i++) {
      const id = eq.quick[i];
      if (id && this.g.inventory.has(id)) slots.push(i);
    }
    if (slots.length === 0) {
      this.g.bus.emit('notify', { text: 'No tienes armas en la barra rápida (asígnalas en el inventario).', kind: 'warning' });
      return;
    }
    const cur = slots.findIndex((i) => eq.quick[i] === eq.slots.main);
    // Pulsar el hueco equipado lo guarda; pulsar otro lo equipa.
    const slot = cur < 0 ? slots[0] : cur === slots.length - 1 ? slots[cur] : slots[cur + 1];
    const a = `slot${slot + 1}` as Action;
    this.g.input.setVirtual(a, true);
    this.g.input.setVirtual(a, false);
  }

  private toggleFullscreen(): void {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else {
        const r = document.documentElement.requestFullscreen?.() as Promise<void> | undefined;
        r?.catch(() => this.g.bus.emit('notify', { text: 'Este navegador no permite pantalla completa aquí.', kind: 'info' }));
      }
    } catch { /* no disponible */ }
  }

  private setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
    if (!v) this.releaseAll();
  }

  /** Suelta todo (al abrir un menú el dedo puede levantarse fuera de la capa). */
  private releaseAll(): void {
    for (const [id, t] of this.tracks) {
      if (t.kind === 'button') { t.el.classList.remove('on'); this.press(t.def, false); }
      try { this.el.releasePointerCapture(id); } catch { /* ya liberado */ }
    }
    this.tracks.clear();
    this.stickBase.classList.remove('on');
    this.g.input.setAnalogMove(0, 0);
    if (this.sprintOn) this.toggleSprint();
  }

  /** Cada frame: visibilidad y estado contextual de los botones. */
  update(): void {
    const g = this.g;
    const show = g.input.touchMode && g.started && !g.ui.blocking && !g.vitals.dead;
    this.setVisible(show);
    if (!show) return;
    // El agachado puede haberse perdido si un menú limpió la entrada.
    if (this.crouchOn && !g.input.isDown('crouch')) g.input.setVirtual('crouch', true);
    const focus = g.interaction.focus.kind !== 'none';
    this.buttons.get('interact')!.classList.toggle('hot', focus);
    this.buttons.get('grab')!.classList.toggle('hot', !!g.interaction.carried);
    this.buttons.get('torch')!.classList.toggle('latched', g.equipment.slots.off === 'torch');
    this.orient.style.display = window.innerHeight > window.innerWidth ? 'block' : 'none';
    // Construcción: botones propios y etiquetas contextuales.
    const b = g.build;
    const building = b.active;
    const canBuild = building || b.nearPlot(g.player.pos.x, g.player.pos.z, 2);
    this.buttons.get('build')!.style.display = canBuild ? 'flex' : 'none';
    this.buttons.get('build')!.textContent = building ? 'Salir' : 'Construir';
    for (const k of ['rotate', 'buildPrev', 'buildNext']) this.buttons.get(k)!.style.display = building ? 'flex' : 'none';
    this.buttons.get('attack')!.textContent = building ? 'Colocar' : 'Atacar';
    this.buttons.get('interact')!.textContent = building ? 'Quitar' : 'Usar';
  }
}
