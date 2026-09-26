// Capturas de varios escenarios en una sola sesión: node e2e/scenes.mjs <outdir> [nombres...]
import { launch } from './browser.mjs';
const [outDir, ...only] = process.argv.slice(2);
const url = process.env.GAME_URL ?? 'http://localhost:5173/?debug&autostart';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 120000 });
const scenes = {
  hut: `__game.lookAt(-56.5, 14.2, 18.6)`,
  village: `__game.teleport(-18, 22, 0); __game.lookAt(0, 16, -10); __game.setHour(10)`,
  plaza: `__game.teleport(6, 16, 0); __game.lookAt(-10, 15, -20); __game.setHour(11)`,
  gate: `__game.teleport(4, -50, 0); __game.lookAt(0, 16, -64); __game.setHour(16)`,
  forest: `__game.teleport(-120, 6, 0); __game.lookAt(-170, 12, -30); __game.setHour(9)`,
  meadow: `__game.teleport(-140, -30, 0); __game.lookAt(-165, 12, -45); __game.setHour(8)`,
  dusk: `__game.teleport(-25, 30, 0); __game.lookAt(10, 16, -20); __game.setHour(20.2)`,
  night: `__game.teleport(-10, 20, 0); __game.lookAt(10, 17, -15); __game.setHour(23)`,
  cave_mouth: `__game.teleport(-172, -128, 0); __game.lookAt(-190, 12, -130); __game.setHour(12)`,
  cave_torch: `__game.give('torch', 2); __game.game.equipment.equip('torch'); __game.teleport(-238, -122, 0, __game.game.settlement.cave.pointAt(0.55).y + 0.1); __game.lookAt(-250, __game.game.settlement.cave.pointAt(0.6).y + 1, -124); __game.setHour(12)`,
  camp: `__game.teleport(150, -270, 0); __game.lookAt(170, 14, -280); __game.setHour(22)`,
  rain: `__game.weather('rain'); __game.teleport(-18, 22, 0); __game.lookAt(0, 16, -10); __game.setHour(14)`,
  pines: `__game.teleport(120, -235, 0); __game.lookAt(150, 16, -290); __game.setHour(15)`,
  sierra: `__game.teleport(-40, -300, 0); __game.lookAt(-40, 60, -700); __game.setHour(13)`,
  tavern: `__game.teleport(9, -5, 0); __game.lookAt(21, 16, -17); __game.setHour(10)`,
  people: `__game.setHour(11); __game.lineup(-150, -40); __game.teleport(-150, -36.6, 0); __game.lookAt(-150, __game.game.hf.heightAt(-150, -40) + 1.1, -40)`,
  hutext: `__game.teleport(-47, 26, 0); __game.lookAt(-58, 15, 18); __game.setHour(16)`,
  coast: `__game.teleport(60, 5, 0); __game.lookAt(200, 6, -10); __game.setHour(10)`,
  beach: `__game.teleport(112, 20, 0); __game.lookAt(150, 5, 0); __game.setHour(17)`,
  harbor: `__game.setHour(9); __game.teleport(48, 18, 0); __game.lookAt(110, 7, 6)`,
  pier: `__game.setHour(8); __game.teleport(__game.game.settlement.pier.x0 - 4, 11, 0); __game.lookAt(__game.game.settlement.pier.x1, 6.5, 14)`,
  south: `__game.setHour(15); __game.teleport(-4, 40, 0); __game.lookAt(-20, 14, 75)`,
  fog: `__game.weather('fog'); __game.teleport(-100, 12, 0); __game.lookAt(-150, 12, -20); __game.setHour(7)`,
};
for (const [name, script] of Object.entries(scenes)) {
  if (only.length && !only.includes(name)) continue;
  await page.evaluate(`(() => { ${script}; __game.step(0.5); })()`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  const info = await page.evaluate(() => { const g = __game.game; const s = g.renderer.stats; return `${g.time.formatClock()} fps=${g.loop.fps.toFixed(1)} calls=${s.calls} tris=${s.triangles}`; });
  console.log(name, info);
  await page.evaluate(`__game.weather('clear')`);
}
console.log(errors.length ? errors.slice(0, 15).join('\n') : 'sin errores');
await browser.close();
