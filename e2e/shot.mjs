// Captura rápida: node e2e/shot.mjs <url> <out.png> [esperaMs] [script JS a evaluar antes]
import { launch } from './browser.mjs';
const [url, out, wait = '6000', pre = ''] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); if (m.type()==='log') console.log('[log]', m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
if (pre) console.log('pre:', JSON.stringify(await page.evaluate(pre)));
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
const info = await page.evaluate(() => { const g = window.__game.game; return { fps: g.loop.fps, stats: g.renderer.stats, pos: g.player.pos.toArray().map(v=>+v.toFixed(2)), time: g.time.formatClock?.() }; });
console.log(JSON.stringify(info));
console.log(errors.slice(0, 20).join('\n'));
await browser.close();
