// Prueba de controles táctiles con emulación de móvil (pantalla en horizontal).
// Uso: node e2e/touch.mjs <url>  (url con ?debug)
import { launch } from './browser.mjs';
const [url, outDir = 'e2e/screenshots'] = process.argv.slice(2);
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 90000 });
const cdp = await ctx.newCDPSession(page);
const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const waitBlocking = (v) => page.waitForFunction((v) => window.__game.game.ui.blocking === v, v, { timeout: 20000 }).catch(() => {});
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };

const st = () => page.evaluate(() => { const g = window.__game.game; return { touch: g.input.touchMode, q: g.qualityName, pos: g.player.pos.toArray(), yaw: g.player.yaw, blocking: g.ui.blocking, eq: g.equipment.slots.main, vis: document.querySelector('.touch')?.style.display }; });
let s = await st();
console.log('inicio', JSON.stringify(s));
if (!s.touch) fail('touchMode no detectado');
if (s.q !== 'low') fail('calidad por defecto no es baja');
// Nueva partida desde el menú (toque).
await page.getByText('Nueva partida').tap();
await page.waitForFunction(() => document.querySelector('.touch')?.style.display === 'block', null, { timeout: 30000 }).catch(() => {});
s = await st();
if (s.blocking) fail('UI sigue bloqueando'); if (s.vis !== 'block') fail('capa táctil oculta');
// Joystick: mantener hacia adelante 2 s.
const p0 = s.pos;
await touch('touchStart', [{ x: 120, y: 280, id: 1 }]);
for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: 120, y: 280 - i * 10, id: 1 }]); await page.waitForTimeout(30); }
await page.waitForTimeout(2000);
await touch('touchEnd', []);
s = await st();
const moved = Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]);
console.log('movido', moved.toFixed(2));
if (moved < 1) fail('el joystick no mueve al jugador');
// Mirar: arrastrar en la derecha.
const y0 = s.yaw;
await touch('touchStart', [{ x: 500, y: 200, id: 2 }]);
for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: 500 - i * 15, y: 200, id: 2 }]); await page.waitForTimeout(20); }
await touch('touchEnd', []);
await page.waitForTimeout(200);
s = await st();
console.log('giro', (s.yaw - y0).toFixed(3));
if (Math.abs(s.yaw - y0) < 0.1) fail('arrastrar no gira la cámara');
await page.screenshot({ path: `${outDir}/touch_hud.png` });
// Arma: cambiar.
await page.locator('.b-weapon').tap();
await page.waitForTimeout(300);
s = await st();
console.log('arma', s.eq);
// Inventario y cerrar con ✕.
await page.locator('.b-inv').tap();
await waitBlocking(true);
s = await st();
if (!s.blocking) fail('inventario no abre');
await page.screenshot({ path: `${outDir}/touch_inventory.png` });
await page.locator('.screen.show .close-x').tap();
await waitBlocking(false);
s = await st();
if (s.blocking) fail('✕ no cierra');
// Mapa y diario.
await page.locator('.b-map').tap(); await waitBlocking(true);
await page.screenshot({ path: `${outDir}/touch_map.png` });
await page.locator('.screen.show .close-x').tap(); await waitBlocking(false);
await page.locator('.b-jour').tap(); await waitBlocking(true);
await page.screenshot({ path: `${outDir}/touch_journal.png` });
await page.locator('.screen.show .close-x').tap(); await waitBlocking(false);
// Pausa.
await page.locator('.b-pause').tap(); await waitBlocking(true);
s = await st();
if (!s.blocking) fail('pausa no abre');
await page.screenshot({ path: `${outDir}/touch_pause.png` });
await page.locator('.screen.show').getByText('Continuar').tap(); await waitBlocking(false);
s = await st();
if (s.blocking) fail('continuar no cierra la pausa');
// Ataque (toque).
await page.locator('.b-attack').tap(); await page.waitForTimeout(600);
console.log('errores', errors.length ? errors.slice(0, 8).join('\n') : 'ninguno');
if (errors.length) process.exitCode = 1;
console.log(process.exitCode ? 'TOUCH: FALLOS' : 'TOUCH: OK');
await browser.close();
