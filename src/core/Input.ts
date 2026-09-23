/**
 * Entrada abstracta por acciones. Los sistemas preguntan por acciones
 * ("attack", "interact"), nunca por teclas: así se puede remapear o
 * añadir mando sin tocar la lógica.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'sprint' | 'crouch' | 'jump'
  | 'interact' | 'grab' | 'attack' | 'block' | 'dodge' | 'kick' | 'torch'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4'
  | 'inventory' | 'journal' | 'map' | 'pause' | 'perf';

const DEFAULT_BINDINGS: Record<string, Action> = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  ControlLeft: 'crouch', ControlRight: 'crouch',
  Space: 'jump',
  KeyE: 'interact', KeyR: 'grab', KeyC: 'dodge', KeyF: 'kick', KeyT: 'torch',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4',
  Tab: 'inventory', KeyI: 'inventory', KeyJ: 'journal', KeyM: 'map',
  Escape: 'pause', F3: 'perf',
};

/** Acciones de interfaz: se consumen explícitamente y no se borran en cada tick. */
const UI_ACTIONS: ReadonlySet<Action> = new Set<Action>(['inventory', 'journal', 'map', 'pause', 'perf']);

export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private virtualDown = new Set<Action>();
  mouseDX = 0;
  mouseDY = 0;
  sensitivity = 0.0022;
  pointerLocked = false;
  /** Movimiento analógico (joystick táctil): x derecha, y adelante, magnitud ≤ 1. */
  private analogX = 0;
  private analogY = 0;
  /** Hay controles táctiles activos (sin pointer lock). */
  touchMode = false;
  /** Si la UI tiene el foco, la entrada de juego se ignora. */
  gameplayEnabled = false;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.down.clear(); });
    element.addEventListener('mousedown', (e) => this.onMouse(e, true));
    window.addEventListener('mouseup', (e) => this.onMouse(e, false));
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.element;
      if (!this.pointerLocked) this.down.clear();
    });
  }

  requestPointerLock(): void {
    if (this.touchMode) return;
    if (document.pointerLockElement !== this.element) {
      // En navegadores headless puede no estar disponible.
      try {
        const r = this.element.requestPointerLock() as unknown;
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
      } catch { /* sin pointer lock */ }
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const action = DEFAULT_BINDINGS[e.code];
    if (!action) return;
    if (e.code === 'Tab' || e.code === 'F3' || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    this.setAction(action, isDown);
  }

  private onMouse(e: MouseEvent, isDown: boolean): void {
    const action: Action | null = e.button === 0 ? 'attack' : e.button === 2 ? 'block' : null;
    if (!action) return;
    this.setAction(action, isDown);
  }

  private setAction(action: Action, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(action)) this.pressed.add(action);
      this.down.add(action);
    } else {
      if (this.down.has(action)) this.released.add(action);
      this.down.delete(action);
    }
  }

  /** Entrada virtual para DebugAPI / tests E2E. */
  setVirtual(action: Action, isDown: boolean): void {
    if (isDown) {
      if (!this.virtualDown.has(action)) this.pressed.add(action);
      this.virtualDown.add(action);
    } else {
      if (this.virtualDown.has(action)) this.released.add(action);
      this.virtualDown.delete(action);
    }
  }

  isDown(a: Action): boolean {
    if (!this.gameplayEnabled && !UI_ACTIONS.has(a)) return false;
    return this.down.has(a) || this.virtualDown.has(a);
  }

  wasPressed(a: Action): boolean {
    if (!this.gameplayEnabled && !UI_ACTIONS.has(a)) return false;
    return this.pressed.has(a);
  }

  wasReleased(a: Action): boolean {
    if (!this.gameplayEnabled && !UI_ACTIONS.has(a)) return false;
    return this.released.has(a);
  }

  /** Consume una pulsación de interfaz (la borra). */
  consume(a: Action): boolean {
    if (this.pressed.has(a)) {
      this.pressed.delete(a);
      return true;
    }
    return false;
  }

  /** Llamar al final de cada tick de lógica. */
  endTick(): void {
    for (const a of [...this.pressed]) if (!UI_ACTIONS.has(a)) this.pressed.delete(a);
    this.released.clear();
  }

  setAnalogMove(x: number, y: number): void {
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    this.analogX = x * k;
    this.analogY = y * k;
  }

  /** Movimiento analógico actual (cero si la UI tiene el foco). */
  analogMove(): { x: number; y: number } {
    if (!this.gameplayEnabled) return { x: 0, y: 0 };
    return { x: this.analogX, y: this.analogY };
  }

  takeMouseDelta(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  clearAll(): void {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.virtualDown.clear();
    this.analogX = this.analogY = 0;
    this.mouseDX = this.mouseDY = 0;
  }
}
