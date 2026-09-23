import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/600.css';
import './ui/styles.css';
import { Physics } from './engine/Physics';
import { Game } from './game/Game';
import { SaveSystem } from './save/SaveSystem';
import { installDebugAPI } from './debug/DebugAPI';
import { TouchControls } from './ui/TouchControls';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const ui = document.getElementById('ui-root')!;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = '<div>The Last Heir</div><div style="font-size:18px;margin-top:10px">Preparando el valle…</div>';
  ui.append(loading);
  await new Promise((r) => setTimeout(r, 30));
  try {
    await Physics.init();
  } catch (e) {
    loading.innerHTML = '<div>The Last Heir</div><div style="font-size:17px;margin-top:12px;max-width:80vw;text-align:center">No se pudo iniciar el motor de física (WebAssembly). Actualiza el navegador o prueba con Chrome, Firefox o Safari recientes.</div>';
    throw e;
  }
  const params = new URLSearchParams(location.search);
  // En móviles la calidad baja por defecto (se puede cambiar en Opciones).
  const defQuality = TouchControls.isTouchDevice() ? 'low' : 'medium';
  const game = new Game(canvas, (params.get('quality') as 'low' | 'medium' | 'high') ?? defQuality);
  if (params.has('debug')) installDebugAPI(game);
  loading.remove();

  const pending = SaveSystem.takePendingLoad();
  const startPlaying = () => game.enterGame();
  game.ui.onNewGame = () => {
    game.newGame();
    startPlaying();
  };
  game.ui.onContinue = () => {
    const slot = game.save.latestSlot();
    if (slot) game.save.requestLoad(slot);
  };

  if (pending && game.save.loadNow(pending)) {
    game.started = true;
    game.ui.showToast('Partida cargada', game.save.info(pending) ?? '');
    // Requiere un gesto del usuario para el ratón y el audio.
    game.ui.setHint(game.input.touchMode ? 'Toca la pantalla para continuar' : 'Haz clic para continuar');
    const go = () => { game.ui.setHint(''); startPlaying(); canvas.removeEventListener('click', go); };
    canvas.addEventListener('click', go);
    ui.addEventListener('click', go, { once: true });
  } else if (params.has('autostart')) {
    game.newGame();
    game.started = true;
    game.paused = false;
    game.input.gameplayEnabled = true;
  } else {
    game.ui.openMainMenu(game.save.hasAny());
  }
  canvas.addEventListener('click', () => {
    game.audio.unlock();
    if (game.started && !game.ui.blocking && !game.vitals.dead) game.input.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    // Si el jugador sale del pointer lock con Esc, abrir la pausa.
    if (!document.pointerLockElement && game.started && !game.ui.blocking && !game.vitals.dead && !params.has('autostart')) game.ui.openPause();
  });
  window.addEventListener('beforeunload', () => {
    if (game.started && !game.vitals.dead) game.save.save('auto');
  });
  // Autoguardado periódico (5 min reales).
  setInterval(() => { if (game.started && !game.paused && !game.vitals.dead && !game.raids.active) game.save.save('auto'); }, 5 * 60 * 1000);
  game.start();
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`);
});
