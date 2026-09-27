/**
 * Pruebas E2E: arranca el juego real en Chromium (WebGL por software) y
 * ejecuta escenarios que recorren el vertical slice usando la interfaz y
 * los sistemas reales. Uso: npm run e2e  (con `npm run dev` o preview activo)
 *   GAME_URL=http://localhost:5173/  node e2e/run-e2e.mjs [filtro]
 */
import { launch } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

// Si no se indica GAME_URL, levantar un servidor de desarrollo propio.
let server = null;
let BASE = process.env.GAME_URL;
if (!BASE) {
  const port = 5199;
  server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true });
  BASE = `http://localhost:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) break; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}
const stopServer = () => { if (server) { try { process.kill(-server.pid); } catch { /* ya parado */ } } };
const filter = process.argv[2] ?? '';
const shots = 'e2e/screenshots';
mkdirSync(shots, { recursive: true });

const results = [];
let page;
const errors = [];

function assert(cond, msg) {
  if (!cond) throw new Error(`Aserción fallida: ${msg}`);
}
const ev = (fn, ...args) => page.evaluate(fn, ...args);

async function openGame(extra = '') {
  await page.goto(`${BASE}?debug&autostart${extra}`);
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 120000 });
  await ev(() => localStorage.clear());
}

/** Pulsa una opción del diálogo real (manejador DOM del botón). */
async function clickOption(text) {
  await page.waitForSelector('.dialogue button', { timeout: 10000 });
  const ok = await ev((t) => {
    const b = [...document.querySelectorAll('.dialogue button')].find((x) => x.textContent.includes(t));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, text);
  if (!ok) {
    const opts = await ev(() => [...document.querySelectorAll('.dialogue button')].map((b) => b.textContent));
    throw new Error(`Opción de diálogo no encontrada: "${text}" en ${JSON.stringify(opts)}`);
  }
}

async function test(name, fn) {
  if (filter && !name.includes(filter)) return;
  const t0 = Date.now();
  try {
    // Cada prueba empieza sin pantallas abiertas (una UI abierta pausa la simulación).
    await ev(() => { const g = __game.game; if (g.ui.dialogueOpen) g.ui.closeDialogue(); if (g.ui.current) g.ui.close(); g.vitals.dead = false; g.vitals.health = Math.max(g.vitals.health, 60); });
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`✘ ${name}\n   ${e.message}`);
    try { await page.screenshot({ path: `${shots}/FAIL_${name.replace(/\W+/g, '_')}.png` }); } catch { /* */ }
  }
}

const browser = await launch();
page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000); // el renderizado por software puede tardar en dar un fotograma
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
await openGame();

// ---------------------------------------------------------------------------
await test('arranque: mundo, jugador en la choza y misión inicial', async () => {
  const s = await ev(() => {
    const g = __game.game;
    return {
      stage: __game.quest('main_legacy'), npcs: g.npcs.npcs.size, buildings: g.settlement.buildings.size,
      inHut: g.settlement.buildings.get('player_hut').contains(g.player.pos.x, g.player.pos.z), trees: g.vegetation.stats.near + g.vegetation.stats.far,
    };
  });
  assert(s.stage === 'search_hut', `etapa inicial ${s.stage}`);
  assert(s.npcs === 29, `29 habitantes (${s.npcs})`);
  assert(s.buildings >= 15, 'edificios');
  assert(s.inHut, 'el jugador empieza dentro de su choza');
  assert(s.trees > 500, `árboles ${s.trees}`);
});

await test('interacción física: coger el hacha de la mesa (animación + inventario)', async () => {
  const r = await ev(() => {
    const g = __game.game;
    const axe = g.worldItems.items.get('hut_axe');
    const p = axe.body.translation();
    __game.lookAt(p.x, p.y, p.z);
    __game.step(0.1);
    const focus = __game.focus();
    __game.interact();
    __game.step(0.5);
    return { focus, has: g.inventory.has('axe'), stillInWorld: g.worldItems.items.has('hut_axe'), equipped: g.equipment.slots.main };
  });
  assert(r.focus.includes('Hacha'), `foco: ${r.focus}`);
  assert(r.has && !r.stillInWorld, 'el hacha pasa al inventario y sale del mundo');
  assert(r.equipped === 'axe', 'se equipa al tener las manos vacías');
});

await test('agarrar, transportar y lanzar un objeto con física', async () => {
  const r = await ev(() => {
    const g = __game.game;
    const bread = g.worldItems.items.get('hut_bread');
    const p0 = bread.body.translation();
    __game.lookAt(p0.x, p0.y, p0.z);
    __game.step(0.1);
    __game.press('grab', true); __game.step(1 / 30); __game.press('grab', false);
    const carrying = !!g.interaction.carried;
    g.player.yaw += 1.2;
    __game.step(0.6);
    const p1 = bread.body.translation();
    __game.press('attack', true); __game.step(1 / 30); __game.press('attack', false);
    __game.step(1.2);
    const p2 = bread.body.translation();
    return { carrying, moved: Math.hypot(p1.x - p0.x, p1.z - p0.z), released: !g.interaction.carried, p2y: p2.y, floor: g.settlement.buildings.get('player_hut').floorY };
  });
  assert(r.carrying, 'se agarra el pan');
  assert(r.moved > 0.4, `el objeto sigue a la vista (movido ${r.moved.toFixed(2)} m)`);
  assert(r.released, 'se lanza al hacer clic');
  assert(r.p2y > r.floor - 0.5, 'el objeto no atraviesa el suelo');
});

await test('historia 1: tabla suelta → carta → leerla', async () => {
  const r = await ev(() => {
    const g = __game.game;
    const b = g.interactables.get('loose_board');
    __game.lookAt(b.pos.x, b.pos.y, b.pos.z);
    __game.step(0.1);
    const f1 = __game.focus();
    __game.interact();
    __game.step(0.8);
    const letter = g.worldItems.items.get('letter_rodrigo');
    const lp = letter.body.translation();
    __game.lookAt(lp.x, lp.y, lp.z);
    __game.step(0.1);
    const f2 = __game.focus();
    __game.interact();
    __game.step(0.3);
    g.actions.useItem('letter_rodrigo');
    return { f1, f2, flag: g.flags.has('board_opened'), has: g.inventory.has('letter_rodrigo'), stage: __game.quest('main_legacy'), ui: g.ui.current };
  });
  assert(r.f1.includes('Tabla suelta'), `foco tabla: ${r.f1}`);
  assert(r.flag, 'flag board_opened');
  assert(r.f2.includes('Carta'), `foco carta: ${r.f2}`);
  assert(r.has, 'carta en el inventario');
  assert(r.ui === 'document', 'se abre el lector de documentos');
  assert(r.stage === 'ask_gil', `etapa ${r.stage}`);
  await page.screenshot({ path: `${shots}/carta.png` });
  await page.keyboard.press('Escape');
});

await test('diálogo con Gil (UI real): la peña del cuervo', async () => {
  await ev(() => {
    const g = __game.game;
    __game.setHour(19.5); // Gil en la taberna
    g.dialogue.start(g.npcs.get('gil'));
  });
  await page.waitForSelector('.dialogue button');
  await page.screenshot({ path: `${shots}/dialogo_gil.png` });
  await clickOption('peña del cuervo');
  const r = await ev(() => ({ flag: __game.game.flags.has('gil_told_cave'), stage: __game.quest('main_legacy'), torch: __game.game.inventory.has('torch') }));
  await clickOption('Adiós');
  assert(r.flag && r.stage === 'find_cave', `etapa ${r.stage}`);
  assert(r.torch, 'Gil da una antorcha si no tienes');
});

await test('cueva: oscuridad real, antorcha y el zurrón de Rodrigo', async () => {
  const r = await ev(() => {
    const g = __game.game;
    __game.setHour(12);
    const c = g.settlement.cave;
    const mid = c.pointAt(0.35);
    __game.teleport(mid.x, mid.z, Math.PI / 2, mid.y + 0.1);
    __game.step(1.5);
    const dark = g.env.interiorTarget;
    const stage1 = __game.quest('main_legacy');
    g.equipment.equip('torch');
    const end = c.axis[c.axis.length - 3];
    __game.teleport(end.x + 1.2, end.z + 0.8, 0, end.y + 0.1);
    __game.step(1);
    const sat = g.worldItems.items.get('satchel_rodrigo');
    const sp = sat.body.translation();
    __game.lookAt(sp.x, sp.y, sp.z);
    __game.step(0.1);
    const focus = __game.focus();
    __game.interact();
    __game.step(0.5);
    const stage2 = __game.quest('main_legacy');
    const underground = g.player.underground;
    return { dark, stage1, focus, stage2, underground, torchLit: g.equipment.torchLit, y: g.player.pos.y, floor: end.y };
  });
  await page.screenshot({ path: `${shots}/cueva_antorcha.png` });
  assert(r.underground && Math.abs(r.y - r.floor) < 1.5, `el jugador sigue dentro de la cueva (y=${r.y.toFixed(1)} suelo=${r.floor.toFixed(1)})`);
  assert(r.dark > 0.5, `oscuridad interior ${r.dark}`);
  assert(r.stage1 === 'search_cave', `etapa al entrar ${r.stage1}`);
  assert(r.focus.includes('Zurrón'), `foco ${r.focus}`);
  assert(r.stage2 === 'open_satchel', `etapa tras coger ${r.stage2}`);
});

await test('historia 2: abrir el zurrón, leer el diario, el cura miente', async () => {
  const r = await ev(() => {
    const g = __game.game;
    g.actions.useItem('satchel_rodrigo');
    g.actions.useItem('journal_page_1');
    g.ui.close();
    return { token: g.inventory.has('olmedo_token'), map: g.inventory.has('map_fragment_1'), stage: __game.quest('main_legacy') };
  });
  assert(r.token && r.map, 'contenido del zurrón');
  assert(r.stage === 'ask_crest', `etapa ${r.stage}`);
  await ev(() => { const g = __game.game; __game.setHour(10); __game.teleport(-20, -8, 0); g.dialogue.start(g.npcs.get('anselmo')); });
  await clickOption('emblema');
  const lie = await ev(() => document.querySelector('.dialogue .txt').textContent);
  await clickOption('Adiós');
  await ev(() => { const g = __game.game; g.dialogue.start(g.npcs.get('gil')); });
  await clickOption('emblema');
  await clickOption('Adiós');
  const s = await ev(() => ({ stage: __game.quest('main_legacy'), lied: __game.game.flags.has('priest_lied'), clues: __game.game.story.clues().length, storyStage: __game.game.story.stage }));
  assert(lie.includes('no lo había visto nunca'), 'el cura miente');
  assert(s.lied, 'flag priest_lied');
  assert(s.stage === 'to_valdeolmo', `etapa ${s.stage}`);
  assert(s.storyStage >= 4 && s.clues >= 5, `pistas ${s.clues}, etapa del Arca ${s.storyStage}`);
});

await test('misión de la empalizada: talar, transportar troncos, cobrar', async () => {
  await ev(() => { const g = __game.game; __game.setHour(9); g.dialogue.start(g.npcs.get('sancho')); });
  await clickOption('trabajo');
  await clickOption('Adiós');
  const r = await ev(() => {
    const g = __game.game;
    const coins0 = g.inventory.coins;
    // Talar un árbol real de la arboleda con el hacha.
    g.equipment.equip('axe');
    // Un árbol en pie del bosque al oeste del pueblo (al este ahora está la costa).
    const bx = -40, bz = 70;
    __game.teleport(bx, bz, 0);
    __game.step(0.5);
    const trees = g.vegetation.nearbyTrees(bx, bz, 40).filter((x) => g.vegetation.isStanding(x) && !g.hf.isSeaWater(x.x, x.z))
      .sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz));
    const t = trees[0];
    const dx = t.x - bx, dz = t.z - bz, d = Math.hypot(dx, dz) || 1;
    __game.teleport(t.x - (dx / d) * 1.3, t.z - (dz / d) * 1.3, 0);
    let swings = 0;
    for (; swings < 20 && g.vegetation.isStanding(t); swings++) {
      g.vitals.stamina = 100;
      __game.lookAt(t.x, t.y + 1.2, t.z);
      __game.press('attack', true); __game.step(1 / 30); __game.press('attack', false);
      __game.step(1.3);
    }
    const felled = !g.vegetation.isStanding(t);
    __game.step(9);
    const logs = [...g.worldItems.items.values()].filter((w) => w.itemId === 'log');
    // Llevar troncos a la zona (colocándolos directamente: la física de arrastre ya se prueba aparte).
    const z = g.settlement.woodDropZone;
    const needed = 6;
    for (let i = 0; i < needed; i++) {
      const w = logs[i] ?? g.worldItems.spawn('log', t.x, t.y + 1, t.z, {});
      w.body.setTranslation({ x: z.x + ((i % 3) - 1) * 0.9, y: z.y + 0.35 + Math.floor(i / 3) * 0.45, z: z.z + (Math.floor(i / 3) - 0.5) * 0.5 }, true); w.body.setRotation({ x: 0, y: 0, z: 0.7071, w: 0.7071 }, true); w.body.setLinvel({ x: 0, y: 0, z: 0 }, true); w.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    __game.step(4);
    const stage = __game.quest('side_palisade');
    return { swings, felled, logs: logs.length, stage, coins0, delivered: g.woodDelivered() };
  });
  assert(r.felled, `el árbol cae (golpes: ${r.swings})`);
  assert(r.logs >= 3, `troncos generados: ${r.logs}`);
  assert(r.delivered >= 6, `troncos en la zona: ${r.delivered}`);
  assert(r.stage === 'report', `etapa ${r.stage}`);
  await ev(() => { const g = __game.game; __game.teleport(-30, 12, 0); g.dialogue.start(g.npcs.get('sancho')); });
  await clickOption('Adiós');
  const done = await ev(() => ({ status: __game.game.quests.status('side_palisade'), coins: __game.game.inventory.coins, pending: __game.game.flags.has('palisade_repair_pending') }));
  assert(done.status === 'completed', `estado ${done.status}`);
  assert(done.pending, 'reparación pendiente para el alba');
  const rep = await ev(() => { const g = __game.game; __game.setHour(7.5); return { repaired: g.settlement.palisadeRepaired, breachClosed: !g.npcs.nav.clear(40, -40, 50, -50) }; });
  assert(rep.repaired, 'al alba la brecha está reparada (cambio persistente del mundo)');
});

await test('supervivencia: hambre, sed, comer, beber en el pozo, frío nocturno', async () => {
  const r = await ev(() => {
    const g = __game.game;
    const v = g.vitals;
    v.hunger = 20; v.thirst = 20;
    g.inventory.add('bread', 1);
    g.actions.useItem('bread');
    g.actions.useWater('pozo');
    const after = { hunger: v.hunger, thirst: v.thirst };
    // Noche de lluvia a la intemperie: el calor corporal baja.
    __game.teleport(-150, -20, 0);
    __game.setHour(2);
    __game.weather('rain');
    g.equipment.unequip('off');
    const w0 = v.warmth;
    __game.step(20);
    const w1 = v.warmth;
    __game.weather('clear');
    return { after, w0, w1 };
  });
  assert(r.after.hunger > 35 && r.after.thirst > 45, `comer/beber ${JSON.stringify(r.after)}`);
  assert(r.w1 < r.w0, `el frío baja el calor corporal (${r.w0.toFixed(1)} → ${r.w1.toFixed(1)})`);
});

await test('combate: golpe al bandido con daño localizado y bloqueo del jugador', async () => {
  const r = await ev(() => {
    const g = __game.game;
    __game.setHour(13);
    g.inventory.add('sword'); g.equipment.equip('sword');
    __game.teleport(-150, -20, 0);
    __game.step(0.3);
    g.raids.start();
    const b = g.raids.raiders[2].c;
    b.place(g.player.pos.x, g.player.pos.y, g.player.pos.z - 1.9, 0);
    b.stop();
    const h0 = b.health;
    for (let i = 0; i < 4; i++) {
      g.vitals.stamina = 100;
      __game.lookAt(b.pos.x, b.pos.y + 1.2, b.pos.z);
      b.phase = 'none'; b.blocking = false; b.attackCooldown = 99;
      __game.press('attack', true); __game.step(1 / 30); __game.press('attack', false);
      __game.step(1.0);
    }
    const dealt = h0 - b.health;
    // Bloqueo: el bandido golpea mientras el jugador bloquea de frente.
    const hp0 = g.vitals.health;
    __game.press('block', true); __game.step(0.2);
    g.combat.hitPlayer({ id: b.id, pos: b.pos }, 30, b.weapon, false);
    const blockedDmg = hp0 - g.vitals.health;
    __game.press('block', false); __game.step(0.1);
    const hp1 = g.vitals.health;
    g.combat.hitPlayer({ id: b.id, pos: b.pos }, 30, b.weapon, false);
    const openDmg = hp1 - g.vitals.health;
    return { dealt, blockedDmg, openDmg, alive: b.alive };
  });
  assert(r.dealt > 20, `daño infligido ${r.dealt.toFixed(1)}`);
  assert(r.blockedDmg < r.openDmg * 0.5, `el bloqueo reduce el daño (${r.blockedDmg.toFixed(1)} vs ${r.openDmg.toFixed(1)})`);
});

await test('ataque de bandidos: viajan, se detectan, alarma, guardias a puestos, vecinos a casa, retirada y consecuencias', async () => {
  const r = await ev(() => {
    const g = __game.game;
    g.vitals.health = 100;
    // Reiniciar el ataque de la prueba anterior.
    for (const rd of g.raids.raiders) if (rd.c.alive) rd.c.die(null);
    __game.step(1);
    for (let i = 0; i < 200 && g.raids.active; i++) __game.step(2);
    g.flags.clear('first_raid_done');
    __game.setHour(21);
    __game.teleport(0, 10, 0);
    g.raids.start();
    const camp = g.raids.raiders.map((r) => Math.hypot(r.c.pos.x - 170, r.c.pos.z + 280));
    let spottedAt = -1;
    for (let t = 0; t < 400; t += 2) {
      __game.step(2);
      if (g.raids.spotted && spottedAt < 0) { spottedAt = t; break; }
    }
    const npcStates = { ines: __game.npc('ines'), mendo: __game.npc('mendo'), lucia: __game.npc('lucia') };
    return { startNearCamp: Math.max(...camp) < 15, spottedAt, phase: g.raids.phase, alert: g.raids.alertActive, quest: g.quests.status('defense_robledo'), npcStates };
  });
  await page.screenshot({ path: `${shots}/ataque_alarma.png` });
  assert(r.startNearCamp, 'los atacantes aparecen en su campamento, no junto al pueblo');
  assert(r.spottedAt > 20, `tardan en llegar (avistados a los ${r.spottedAt} s)`);
  assert(r.alert && r.quest === 'active', 'alarma y misión de defensa');
  const r2 = await ev(() => {
    const g = __game.game;
    __game.step(6);
    const mendo = __game.npc('mendo');
    const ines = __game.npc('ines');
    // El jugador y los guardias abaten al cabecilla → retirada.
    __game.killRaiders(1);
    __game.step(2);
    const phase = g.raids.phase;
    for (let i = 0; i < 90 && g.raids.active; i++) __game.step(2);
    return { mendo, ines, phase, active: g.raids.active, history: g.raids.history, questStatus: g.quests.status('defense_robledo'), flags: __game.flags().filter((f) => f.startsWith('last_raid') || f === 'raid_reward_pending'), order: [...g.worldItems.items.values()].some((w) => w.itemId === 'payment_order') };
  });
  assert(r2.mendo.state === 'defend' || r2.mendo.state === 'fight', `Mendo defiende (${r2.mendo.state})`);
  assert(r2.ines.state === 'shelter' || r2.ines.indoors, `Inés se refugia (${r2.ines.state})`);
  assert(r2.phase === 'retreat', `retirada tras caer el cabecilla (${r2.phase})`);
  assert(!r2.active && r2.history.length >= 1, 'el ataque termina y queda en el historial');
  assert(r2.flags.length >= 1, `consecuencias registradas ${JSON.stringify(r2.flags)}`);
  assert(r2.order, 'el cabecilla deja la orden de pago (pista de la conspiración)');
});

await test('fauna: ciervos huyen del jugador, lobos de noche', async () => {
  const r = await ev(() => {
    const g = __game.game;
    __game.setHour(9);
    __game.teleport(-60, -40, 0);
    for (let i = 0; i < 8; i++) __game.step(3.1);
    const deer = [...g.animals.animals.values()].filter((a) => a.species === 'deer' && a.alive);
    if (!deer.length) return { deer: 0 };
    const d0 = deer[0];
    __game.teleport(d0.pos.x + 8, d0.pos.z, 0);
    g.player.sprinting = true;
    __game.press('sprint', true); __game.press('forward', true);
    __game.step(3);
    __game.press('sprint', false); __game.press('forward', false);
    const fled = deer.some((a) => a.state === 'flee' || a.state === 'alert');
    __game.setHour(23);
    __game.teleport(-130, -165, 0);
    for (let i = 0; i < 4; i++) __game.step(3.1);
    const wolves = [...g.animals.animals.values()].filter((a) => a.species === 'wolf').length;
    return { deer: deer.length, fled, wolves };
  });
  assert(r.deer > 0, 'hay ciervos de día en el prado');
  assert(r.fled, 'los ciervos se alertan/huyen');
  assert(r.wolves > 0, 'lobos de noche cerca de su guarida');
});

await test('rutinas: los vecinos caminan a su trabajo según la hora y vuelven a casa', async () => {
  const r = await ev(() => {
    const g = __game.game;
    g.time.dayLengthSeconds = 480; // acelerar el reloj para la prueba (1 h = 20 s)
    g.raids.alertActive = false; // sin la alerta residual del ataque anterior
    __game.setHour(7.0);
    __game.teleport(10, 5, 0);
    const smith0 = __game.npc('bartolome');
    const anvil = g.settlement.places.get('smithy_anvil');
    for (let i = 0; i < 24; i++) __game.step(1.5); // ~7:00 → 8:48 (sale a las 7:30)
    const smith1 = __game.npc('bartolome');
    const dAnvil = Math.hypot(smith1.x - anvil.x, smith1.z - anvil.z);
    const anim = g.npcs.get('bartolome').c.model.state;
    __game.setHour(21.8);
    for (let i = 0; i < 24; i++) __game.step(1.5);
    const smithNight = __game.npc('bartolome');
    const pedro = __game.npc('pedro');
    const lit = [...g.fires.fires.values()].filter((f) => f.policy === 'night' && f.lit).length;
    g.time.dayLengthSeconds = 1800;
    return { smith0, dAnvil, anim, smithNight, pedro, lit, hour: g.time.hourFloat };
  });
  assert(r.dAnvil < 3, `el herrero llega al yunque (distancia ${r.dAnvil.toFixed(1)} m)`);
  assert(r.anim === 'hammer', `y martillea (${r.anim})`);
  assert(r.smithNight.indoors || r.smithNight.place.startsWith('in:') || r.smithNight.place.startsWith('tavern'), `de noche se retira (${r.smithNight.place})`);
  assert(r.pedro.place === 'tower_top', `el vigía sube a la torre de noche (${r.pedro.place})`);
  assert(r.lit >= 5, `el pueblo enciende sus antorchas al anochecer (${r.lit})`);
});

await test('caza: flecha real a un ciervo, despiece con cuchillo, pieles', async () => {
  const r = await ev(() => {
    const g = __game.game;
    __game.setHour(9);
    g.inventory.add('bow'); g.inventory.add('arrow', 10); g.inventory.add('knife');
    g.equipment.equip('bow');
    __game.teleport(-60, -40, 0);
    for (let i = 0; i < 8; i++) __game.step(3.1);
    const deer = [...g.animals.animals.values()].find((a) => a.species === 'deer' && a.alive);
    if (!deer) return { noDeer: true };
    // Acecho: agachado, a 13 m (de pie a esa distancia el ciervo huye).
    __game.press('crouch', true);
    let shots = 0;
    while (deer.alive && shots < 8) {
      deer.state = 'graze'; deer.speed = 0; deer.lastAttacker = null;
      // Un sitio a 13 m con vista despejada (sin árboles ni lomas en medio).
      let ox = -13, oz = 0;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, cx = deer.pos.x + Math.cos(a) * 13, cz = deer.pos.z + Math.sin(a) * 13;
        const cy = g.hf.heightAt(cx, cz) + 1.2;
        if (g.physics.lineOfSight(cx, cy, cz, deer.pos.x, deer.pos.y + 0.9, deer.pos.z)) { ox = Math.cos(a) * 13; oz = Math.sin(a) * 13; break; }
      }
      __game.teleport(deer.pos.x + ox, deer.pos.z + oz, 0);
      __game.step(0.2);
      __game.lookAt(deer.pos.x, deer.pos.y + 0.95, deer.pos.z);
      g.vitals.stamina = 100;
      __game.press('attack', true);
      __game.step(1.1);
      __game.lookAt(deer.pos.x, deer.pos.y + 0.95, deer.pos.z);
      __game.press('attack', false);
      __game.step(1.2);
      shots++;
    }
    __game.press('crouch', false);
    const stateSeen = deer.state;
    const arrowsLeft = g.inventory.count('arrow');
    __game.teleport(deer.pos.x - 1.4, deer.pos.z, 0);
    __game.lookAt(deer.pos.x, deer.pos.y + 0.3, deer.pos.z);
    __game.step(0.2);
    const focus = __game.focus();
    __game.interact();
    __game.step(0.2);
    return { shots, dead: !deer.alive, arrowsLeft, focus, hide: g.inventory.count('hide'), meat: g.inventory.count('meat_raw'), stateSeen };
  });
  assert(!r.noDeer, 'hay un ciervo');
  assert(r.dead, `el ciervo muere por flechas (${r.shots} disparos)`);
  assert(r.arrowsLeft < 10, 'se gastan flechas');
  assert(r.focus.includes('Despiezar'), `foco ${r.focus}`);
  assert(r.hide >= 1 && r.meat >= 2, `piel ${r.hide}, carne ${r.meat}`);
});

await test('asalto real: combate de guardias, incendio y apagarlo con cubos del pozo', async () => {
  const r = await ev(() => {
    const g = __game.game;
    g.vitals.health = 100;
    __game.setHour(22.5);
    g.settlement.setPalisadeRepaired(false);
    g.npcs.nav.setWallEnabled('breach', false);
    g.raids.start();
    // Dejar que vengan y ataquen sin ayuda del jugador (el jugador observa desde la plaza).
    __game.teleport(-20, 20, 0);
    let assaultT = -1;
    for (let t = 0; t < 360 && g.raids.active; t += 2) {
      __game.step(2);
      g.vitals.health = 100;
      if (g.raids.phase === 'assault' && assaultT < 0) assaultT = t;
      if (assaultT >= 0 && t - assaultT > 70) break;
    }
    const raidersHurt = g.raids.raiders.filter((x) => x.c.health < x.c.maxHealth || !x.c.alive).length;
    const guardsFought = ['mendo', 'pedro', 'bartolome', 'sancho', 'gil'].some((id) => { const n = g.npcs.get(id); return n.c.health < n.c.maxHealth || n.state === 'fight'; });
    const burning = [...g.settlement.buildings.values()].filter((b) => b.burning).map((b) => b.def.id);
    return { assaultT, phase: g.raids.phase, raidersHurt, guardsFought, burning };
  });
  assert(r.assaultT >= 0, 'los bandidos llegan a asaltar el pueblo');
  assert(r.raidersHurt > 0 || r.guardsFought, 'hay combate real entre guardias/vecinos y bandidos');
  // Si hay un incendio, apagarlo con agua del pozo.
  const r2 = await ev(() => {
    const g = __game.game;
    for (const rd of g.raids.raiders) if (rd.c.alive) rd.c.die('player');
    __game.step(2);
    let b = [...g.settlement.buildings.values()].find((x) => x.burning);
    if (!b) { g.raids.ignite(g.settlement.buildings.get('granary')); b = g.settlement.buildings.get('granary'); }
    const h0 = b.health;
    g.inventory.add('bucket');
    for (let k = 0; k < 2; k++) {
      g.actions.useWater('pozo');
      g.raids.douse(b.def.id);
    }
    __game.step(1);
    return { id: b.def.id, h0, burning: b.burning, health: b.health, max: b.def.maxHealth };
  });
  assert(!r2.burning, `el fuego de ${r2.id} se apaga con dos cubos`);
  assert(r2.health < r2.max, 'el edificio queda dañado (persistente)');
});

await test('comercio: comprar y vender con precios según la reputación', async () => {
  const r = await ev(() => {
    const g = __game.game;
    g.inventory.coins = 100;
    const buyLow = g.economy.buyPrice('bread', 'robledo');
    const okBuy = g.economy.buy('lucia', 'bread');
    const okSell = g.economy.sell('gil', 'hide') || (g.inventory.add('hide', 1), g.economy.sell('gil', 'hide'));
    const rep0 = g.reputation.get('robledo');
    g.reputation.change('robledo', 60, 'prueba');
    const buyHigh = g.economy.buyPrice('sword', 'robledo');
    g.reputation.change('robledo', -200, 'prueba');
    const buyHostile = g.economy.buyPrice('sword', 'robledo');
    const canTrade = g.economy.canTrade('lucia', 'robledo').ok;
    g.reputation.change('robledo', rep0 - g.reputation.get('robledo'), 'restaurar');
    return { buyLow, okBuy, okSell, buyHigh, buyHostile, canTrade, coins: g.inventory.coins };
  });
  assert(r.okBuy && r.okSell, 'compra y venta');
  assert(r.buyHostile > r.buyHigh, `los precios empeoran con mala reputación (${r.buyHigh} → ${r.buyHostile})`);
  assert(!r.canTrade, 'con reputación hostil no comercian contigo');
});

await test('casa: guardar y sacar del arcón, dormir hasta el alba con autoguardado', async () => {
  const r = await ev(() => {
    const g = __game.game;
    // Evitar que el ataque programado caiga esta noche (no se puede dormir durante un ataque).
    g.flags.set('first_raid_done');
    g.director.lastRaidDay = g.time.day + 1;
    for (const rd of g.raids.raiders) if (rd.c.alive) rd.c.die(null);
    for (let i = 0; i < 100 && g.raids.active; i++) __game.step(2);
    g.raids.alertActive = false;
    const chest = g.containers.get('chest_player');
    g.inventory.add('apple', 3);
    g.ui.openContainer('chest_player');
    const btn = [...document.querySelectorAll('.screen.show .col')[0].querySelectorAll('button')].find((b) => b.textContent.includes('Manzana'));
    btn.click();
    const inChest = chest.inv.count('apple');
    g.ui.close();
    __game.setHour(22);
    const hut = g.settlement.buildings.get('player_hut');
    __game.teleport(hut.def.x, hut.def.z, 0, hut.floorY + 0.1);
    localStorage.removeItem('tlh_save_auto');
    const day0 = g.time.day;
    const ok = g.actions.rest(g.actions.hoursUntilDawn(), true);
    return { inChest, ok, day0, day1: g.time.day, hour: g.time.hourFloat, autosave: !!localStorage.getItem('tlh_save_auto'), stamina: g.vitals.stamina };
  });
  assert(r.inChest >= 1, 'la manzana pasa al arcón');
  assert(r.ok && r.day1 === r.day0 + 1 && Math.abs(r.hour - 6.5) < 0.2, `duerme hasta el alba (día ${r.day0}→${r.day1}, ${r.hour.toFixed(2)} h)`);
  assert(r.autosave, 'dormir autoguarda');
});

await test('audio: todos los sonidos se sintetizan sin errores', async () => {
  const r = await ev(() => {
    const g = __game.game;
    g.audio.unlock();
    const ids = ['step_grass', 'step_dirt', 'step_mud', 'step_wood', 'step_rock', 'step_water', 'jump', 'land', 'dodge', 'swing', 'swing_heavy', 'hit_flesh', 'clash', 'block_wood', 'chop', 'kick',
      'bow_draw', 'bow_release', 'arrow_fly', 'arrow_hit', 'pickup', 'grab', 'grab_heavy', 'throw', 'equip', 'coins', 'paper', 'chest_open', 'door_open', 'door_close', 'door_locked', 'gate',
      'wood_creak', 'ladder', 'drink', 'eat', 'water_fill', 'fire_light', 'sizzle', 'hammer', 'bell', 'horn', 'thunder', 'tree_crack', 'tree_fall', 'splash', 'wolf_howl', 'wolf_growl', 'wolf_bite',
      'deer_alarm', 'grunt', 'pain', 'shout', 'death'];
    const errs = [];
    const state = g.audio.ctx ? g.audio.ctx.state : 'none';
    // Forzar el contexto a "running" si el navegador lo permite sin gesto.
    for (const id of ids) {
      try { g.audio.play(id, { x: g.player.pos.x + 2, y: g.player.pos.y, z: g.player.pos.z }); } catch (e) { errs.push(`${id}: ${e.message}`); }
    }
    try { g.audio.updateAmbience(0.5, { day: 0.2, wind: 0.8, rain: 0.8, inCave: 0, indoors: 0, waterDist: 5, fireDist: 3, forest: 0.8, village: 0.5, storm: true }); } catch (e) { errs.push(`ambience: ${e.message}`); }
    return { errs, state, n: ids.length };
  });
  assert(r.errs.length === 0, r.errs.join('; '));
});

await test('muerte del jugador: pantalla de muerte y opción de cargar', async () => {
  const r = await ev(() => {
    const g = __game.game;
    g.vitals.hurt(1000);
    __game.step(0.2);
    return { dead: g.vitals.dead };
  });
  assert(r.dead, 'el jugador muere');
  await page.waitForSelector('.screen.show h1', { timeout: 10000 });
  const title = await ev(() => document.querySelector('.screen.show h1').textContent);
  assert(title.includes('Has muerto'), `pantalla: ${title}`);
  await ev(() => { const g = __game.game; g.vitals.dead = false; g.vitals.health = 100; g.ui.close(); });
});

await test('guardado y carga persistente (recarga completa de la página)', async () => {
  const before = await ev(() => {
    const g = __game.game;
    __game.setHour(15);
    __game.teleport(10, 5, 1.0);
    g.inventory.coins = 77;
    // Talar un árbol justo antes de guardar (los antiguos pueden haber rebrotado).
    const t = g.vegetation.nearbyTrees(-150, -20, 30)[0];
    if (t) g.vegetation.fell(t.id, g.time.day);
    g.save.save('2');
    return { coins: 77, day: g.time.day, stage: __game.quest('main_legacy'), rep: g.reputation.get('robledo'), repaired: g.settlement.palisadeRepaired, felled: g.vegetation.felled.size, pos: g.player.pos.toArray(), letterGone: !g.worldItems.items.has('letter_rodrigo') };
  });
  await ev(() => { sessionStorage.setItem('tlh_pending_load', '2'); location.reload(); }).catch(() => {});
  await page.waitForFunction(() => window.__game !== undefined && window.__game.game.started, null, { timeout: 120000 });
  const after = await ev(() => {
    const g = __game.game;
    return { coins: g.inventory.coins, day: g.time.day, stage: __game.quest('main_legacy'), rep: g.reputation.get('robledo'), repaired: g.settlement.palisadeRepaired, felled: g.vegetation.felled.size, pos: g.player.pos.toArray(), letterGone: !g.worldItems.items.has('letter_rodrigo'), axeGone: !g.worldItems.items.has('hut_axe'), board: g.flags.has('board_opened') };
  });
  assert(after.coins === before.coins, 'dinero');
  assert(after.day === before.day, 'día');
  assert(after.stage === before.stage, `misión ${after.stage}`);
  assert(Math.abs(after.rep - before.rep) < 0.01, 'reputación');
  assert(after.repaired === before.repaired, 'estado del pueblo (empalizada)');
  assert(after.felled === before.felled && after.felled > 0, 'árboles talados');
  assert(Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]) < 1, 'posición');
  assert(after.axeGone && after.letterGone && after.board, 'objetos recogidos no reaparecen');
});

await test('heridas: hachazo a un vecino sin testigos, se desangra, cargarlo al hombro y tirarlo al mar sin castigo', async () => {
  // Tras la prueba de carga el juego espera un clic: reanudarlo.
  await ev(() => { const g = __game.game; g.ui.close(); g.ui.setHint(''); g.started = true; g.paused = false; g.input.gameplayEnabled = true; });
  const r = await ev(() => {
    const api = __game, g = api.game;
    api.setHour(11);
    api.give('axe'); g.equipment.equip('axe');
    const n = [...g.npcs.npcs.values()].find((x) => x.c.alive && x.c.faction === 'villager' && !x.c.downed);
    const x = -130, z = 20, y = g.hf.heightAt(x, z);
    n.c.place(x, y, z, Math.PI); n.c.stop(); n.c.indoors = false;
    api.teleport(x, z + 1.6, 0); api.step(0.2);
    n.c.place(x, y, z, Math.PI); n.c.stop();
    const rep0 = g.reputation.get('robledo');
    let swings = 0;
    for (; swings < 6 && n.c.alive && !n.c.downed; swings++) {
      api.lookAt(n.c.pos.x, n.c.pos.y + 1.2, n.c.pos.z);
      g.vitals.stamina = 100;
      api.press('attack', true); api.step(1 / 30); api.press('attack', false); api.step(1.2);
    }
    const downed = n.c.downed || !n.c.alive;
    const h0 = n.c.health; api.step(2);
    const bleeding = !n.c.alive || n.c.health < h0;
    for (let i = 0; i < 45 && n.c.alive; i++) api.step(1);
    const dead = !n.c.alive;
    const pending = g.bodies.isPending(n.def.id);
    api.teleport(n.c.pos.x, n.c.pos.z + 1.5, 0);
    api.lookAt(n.c.pos.x, n.c.pos.y, n.c.pos.z); api.step(0.1);
    const focus = g.interaction.focus.text;
    api.press('grab', true); api.step(1 / 30); api.press('grab', false); api.step(0.1);
    const dragging = !!g.interaction.dragging;
    let sx = 0;
    for (let xx = 60; xx < 300; xx += 2) if (g.hf.isSeaWater(xx, 10) && g.hf.waterLevelAt(xx, 10) - g.hf.heightAt(xx, 10) > 2.5) { sx = xx; break; }
    api.teleport(sx - 1.2, 10, -Math.PI / 2); api.step(1.2);
    // Llevarlo al agua honda y soltarlo: flota unos segundos y se hunde.
    api.press('grab', true); api.step(1 / 30); api.press('grab', false); api.step(0.8);
    const floatY = n.c.pos.y - g.hf.waterLevelAt(n.c.pos.x, n.c.pos.z);
    api.step(16);
    const hidden = n.c.hiddenBody;
    return { swings, downed, bleeding, dead, pending, focus, dragging, hidden, floatY, rep0, rep1: g.reputation.get('robledo') };
  });
  assert(r.downed, `cae a la primera o segunda (golpes ${r.swings})`);
  assert(r.bleeding, 'se desangra');
  assert(r.dead, 'muere desangrado');
  assert(r.pending, 'crimen sin testigos pendiente');
  assert(r.focus.startsWith('Cuerpo de'), `foco ${r.focus}`);
  assert(r.dragging, 'se carga el cuerpo al hombro');
  assert(r.floatY > -0.5, `al soltarlo en el agua primero flota (${r.floatY.toFixed(2)})`);
  assert(r.hidden, 'el cuerpo se hunde en el mar');
  assert(r.rep1 === r.rep0, `sin castigo de reputación (${r.rep0} → ${r.rep1})`);
});

await test('heridas: brazo, pierna y cabeza cortados; el cuerpo encontrado sí castiga', async () => {
  const r = await ev(() => {
    const api = __game, g = api.game;
    const alive = [...g.npcs.npcs.values()].filter((x) => x.c.alive && !x.c.downed && x.c.faction === 'villager').slice(0, 3);
    const W = { id: 'axe', type: 'slash' };
    alive.forEach((n, i) => { const x = -150 + i * 1.8, z = -40; n.c.place(x, g.hf.heightAt(x, z), z, 0); n.c.stop(); n.c.indoors = false; });
    api.teleport(-148, -36, 0); api.step(0.2);
    const from = g.player.pos.clone();
    g.wounds.onPlayerHit(alive[0].c, 'armR', W, true, from);
    g.wounds.onPlayerHit(alive[1].c, 'legL', W, true, from);
    g.wounds.onPlayerHit(alive[2].c, 'head', W, true, from);
    api.step(1);
    const res = alive.map((n) => ({ sev: [...n.c.model.severed], anim: n.c.model.state, alive: n.c.alive }));
    // Crimen sin testigos y un vecino que llega y ve el cuerpo.
    g.combat.onPlayerAggression(alive[2].c);
    const rep0 = g.reputation.get('robledo');
    const w = [...g.npcs.npcs.values()].find((x) => x.c.alive && !x.c.downed && !alive.includes(x));
    w.c.place(-140, g.hf.heightAt(-140, -40), -40, -Math.PI / 2); w.c.stop(); w.c.indoors = false;
    api.teleport(-190, -40, 0);
    api.step(3);
    return { res, rep0, rep1: g.reputation.get('robledo') };
  });
  assert(r.res[0].sev.includes('armR') && r.res[0].anim === 'kneel' && r.res[0].alive, `brazo: ${JSON.stringify(r.res[0])}`);
  assert(r.res[1].sev.includes('legL') && r.res[1].anim === 'downed', `pierna: ${JSON.stringify(r.res[1])}`);
  assert(r.res[2].sev.includes('head') && !r.res[2].alive, `cabeza: ${JSON.stringify(r.res[2])}`);
  assert(r.rep1 < r.rep0, `al encontrar el cuerpo baja la reputación (${r.rep0} → ${r.rep1})`);
});

await test('remate por la espalda: degollar y romper el cuello; cuerpo guardado en casa', async () => {
  const r = await ev(() => {
    const api = __game, g = api.game;
    api.setHour(10);
    const vict = [...g.npcs.npcs.values()].filter((x) => x.c.alive && !x.c.downed && x.c.faction === 'villager').slice(0, 2);
    const out = [];
    vict.forEach((n, i) => {
      if (i === 0) { api.give('knife'); g.equipment.equip('knife'); } else g.equipment.slots.main = null;
      const x = -150 + i * 40, z = 20;
      n.entry = n.def.schedule.filter((s) => s.from <= 10).pop() ?? n.def.schedule[0];
      n.placeId = 'forest_edge'; n.settled = true;
      n.c.place(x, g.hf.heightAt(x, z), z, 0); n.c.stop(); n.c.indoors = false; n.c.faceYaw = 0; n.c.yaw = 0;
      api.step(0.1);
      // Detrás de él (mira hacia +z).
      api.teleport(x, z - 1.1, 0); api.lookAt(x, n.c.pos.y + 1.3, z); api.step(0.1);
      const prompt = g.interaction.focus.sub;
      api.press('takedown', true); api.step(1 / 30); api.press('takedown', false);
      api.step(2.5);
      out.push({ prompt, dead: !n.c.alive, pending: g.bodies.isPending(n.def.id), neck: n.c.model.neckBroken });
    });
    // El segundo cuerpo, a la choza: dentro nadie lo ve y al dormir no se encuentra.
    const c = vict[1].c;
    const hut = g.settlement.buildings.get('player_hut');
    const inside = hut.localToWorld(0.3, 0, 0.5);
    c.pos.set(inside.x, hut.floorY, inside.z); c.prevPos.copy(c.pos);
    const pp = hut.localToWorld(0.9, 0, 1.2);
    api.teleport(pp.x, pp.z, 0, hut.floorY + 0.05); api.lookAt(c.pos.x, c.pos.y, c.pos.z); api.step(0.1);
    api.press('grab', true); api.step(1 / 30); api.press('grab', false); api.step(1.2);
    const carried = !!g.interaction.dragging;
    g.player.yaw = hut.rotY; api.step(0.1);
    api.press('grab', true); api.step(1 / 30); api.press('grab', false); api.step(1.0);
    const inHut = hut.contains(c.pos.x, c.pos.z, 0.1) && Math.abs(c.pos.y - hut.floorY) < 0.3;
    g.bodies.onTimeSkip();
    return { out, carried, inHut, stillPending: g.bodies.isPending(vict[1].def.id) };
  });
  assert(r.out[0].prompt.includes('Degollar'), `aviso con cuchillo: ${r.out[0].prompt}`);
  assert(r.out[0].dead && r.out[0].pending, `degollado sin testigos: ${JSON.stringify(r.out[0])}`);
  assert(r.out[1].prompt.includes('cuello'), `aviso a mano: ${r.out[1].prompt}`);
  assert(r.out[1].dead && r.out[1].neck, `cuello roto: ${JSON.stringify(r.out[1])}`);
  assert(r.carried && r.inHut, `cuerpo dejado dentro de la choza (${r.carried}, ${r.inHut})`);
  assert(r.stillPending, 'en la choza no lo encuentra nadie al dormir');
});

await test('barca: subir, remar, girar y bajarse', async () => {
  const r = await ev(() => {
    const api = __game, g = api.game;
    g.flags.set('boat_permit');
    const b = g.boats.boats.get('boat_1');
    api.teleport(b.x - 2.5, b.z, 0, g.settlement.pier.y + 0.05);
    api.lookAt(b.x, b.curPos.y + 0.4, b.z); api.step(0.2);
    api.press('interact', true); api.step(1 / 30); api.press('interact', false); api.step(0.3);
    const riding = !!g.boats.riding;
    const p0 = { x: b.x, z: b.z };
    api.press('forward', true); api.step(5); api.press('forward', false);
    const moved = Math.hypot(b.x - p0.x, b.z - p0.z);
    const h0 = b.heading;
    api.press('left', true); api.step(1.5); api.press('left', false);
    const turned = Math.abs(b.heading - h0);
    api.press('interact', true); api.step(1 / 30); api.press('interact', false); api.step(0.5);
    return { riding, moved, turned, off: !g.boats.riding };
  });
  assert(r.riding, 'sube a la barca');
  assert(r.moved > 8, `rema (${r.moved.toFixed(1)} m)`);
  assert(r.turned > 0.4, `gira (${r.turned.toFixed(2)} rad)`);
  assert(r.off, 'se baja');
});

await test('vecinos: no todos quietos con la misma postura', async () => {
  const r = await ev(() => {
    const api = __game, g = api.game;
    api.setHour(11);
    const ns = [...g.npcs.npcs.values()].filter((n) => n.c.alive && !n.c.downed);
    const p0 = ns.map((n) => n.c.pos.clone());
    api.step(90);
    const moved = ns.filter((n, i) => n.c.pos.distanceTo(p0[i]) > 0.8).length;
    const styles = new Set(ns.map((n) => n.c.model.idleStyle)).size;
    return { moved, styles, total: ns.length };
  });
  assert(r.moved >= Math.min(3, Math.ceil(r.total / 4)), `vecinos que se mueven en 90 s: ${r.moved}/${r.total}`);
  assert(r.styles >= 3, `posturas distintas: ${r.styles}`);
});

await test('sin errores de ejecución', async () => {
  assert(errors.length === 0, errors.slice(0, 5).join('\n'));
});

// ---------------------------------------------------------------------------
await browser.close();
stopServer();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} pruebas superadas`);
process.exit(ok === results.length ? 0 : 1);
