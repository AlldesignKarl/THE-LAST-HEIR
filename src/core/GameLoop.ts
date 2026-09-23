/**
 * Bucle de paso fijo (ADR-003). La lógica y la física se ejecutan a
 * `fixedHz`; el render se llama cada frame con el factor de interpolación.
 */
export class GameLoop {
  readonly fixedDt: number;
  private acc = 0;
  private last = 0;
  private running = false;
  private rafId = 0;
  /** Escala temporal (hit-stop, pausa). 0 = pausa lógica. */
  timeScale = 1;
  frameTimeMs = 0;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(
    private readonly fixedUpdate: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
    fixedHz = 30,
  ) {
    this.fixedDt = 1 / fixedHz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Avanza manualmente (tests E2E / herramientas). */
  stepManual(seconds: number): void {
    const steps = Math.max(1, Math.round(seconds / this.fixedDt));
    for (let i = 0; i < steps; i++) this.fixedUpdate(this.fixedDt);
    this.render(1, this.fixedDt);
  }

  private frame(now: number): void {
    const t0 = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    // Evita la "espiral de la muerte" tras pestaña inactiva o carga.
    if (dt > 0.25) dt = 0.25;
    this.acc += dt * this.timeScale;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < 5) {
      this.fixedUpdate(this.fixedDt);
      this.acc -= this.fixedDt;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    this.render(this.acc / this.fixedDt, dt);
    this.frameTimeMs = performance.now() - t0;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }
}
