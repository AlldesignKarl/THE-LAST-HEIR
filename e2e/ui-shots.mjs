// Capturas de las pantallas de interfaz.
import { launch } from './browser.mjs';
const out = process.argv[2] ?? 'e2e/screenshots';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/?debug');
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 120000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/ui_menu.png` });
await page.evaluate(() => { const g = __game.game; g.ui.onNewGame(); });
await page.evaluate(() => {
  const g = __game.game;
  for (const [id, n] of [['sword', 1], ['bow', 1], ['arrow', 14], ['torch', 2], ['bread', 3], ['apple', 2], ['letter_rodrigo', 1], ['hide', 1], ['waterskin', 1]]) g.inventory.add(id, n);
  g.equipment.equip('sword');
  g.ui.openInventory();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/ui_inventario.png` });
await page.evaluate(() => { const g = __game.game; g.flags.set('story_stage_1'); g.flags.set('gil_told_cave'); g.quests.start('side_palisade'); g.ui.openJournal(); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/ui_diario.png` });
await page.evaluate(() => { const g = __game.game; g.discovered.add('cave_crow'); g.discovered.add('bandit_camp'); g.discovered.add('deer_meadow'); g.ui.openMap(); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/ui_mapa.png` });
await page.evaluate(() => { const g = __game.game; g.ui.close(); g.inventory.coins = 60; g.ui.openTrade('bartolome'); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/ui_comercio.png` });
await browser.close();
