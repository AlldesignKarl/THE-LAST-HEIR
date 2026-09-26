// Prueba del multijugador con el transporte local (dos pestañas del mismo
// navegador: BroadcastChannel + localStorage hacen de sala y base de datos).
// Uso: node e2e/mp.mjs <url-base>   (p. ej. http://localhost:5199/)
import { launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5199/';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
const errors = [];
let failed = 0;
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) failed++; };
const open = async (uid, hash = '') => {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${uid}] ${m.text()}`); if (m.type() === 'warning' && m.text().includes('[MP]')) console.log(`[${uid}]`, m.text()); });
  p.on('pageerror', (e) => errors.push(`[${uid}] ${e.message}`));
  await p.goto(`${base}?debug&mplocal&uid=${uid}&quality=low${hash}`);
  await p.waitForFunction(() => window.__game !== undefined, null, { timeout: 300000 });
  return p;
};
const play = (p) => p.evaluate(() => { const g = window.__game.game; g.ui.close(); g.paused = false; g.input.gameplayEnabled = true; });

const A = await open('alice');
await A.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('tlh_')) localStorage.removeItem(k); });
const created = await A.evaluate(() => window.__game.game.mp.createServer('Prueba de Robledo'));
const sid = created.sid;
ok(!!sid, `servidor creado ${sid}`);
const ja = await A.evaluate((sid) => window.__game.game.mp.join(sid), sid);
ok(ja.ok, 'A entra');
await play(A);

// Límite: con A + 4 pestañas falsas (5) el siguiente no entra.
await A.evaluate((sid) => {
  window.__fakes = [];
  for (let i = 0; i < 4; i++) {
    const ch = new BroadcastChannel(`tlh_mp_s-${sid}`);
    const peer = `pfake${i}`;
    const send = (t) => ch.postMessage({ t, peer, by: `fake${i}`, presence: {} });
    ch.onmessage = (e) => { if (e.data.t === 'hello') send('presence'); };
    send('hello');
    window.__fakes.push({ ch, send, iv: setInterval(() => send('presence'), 1500) });
  }
}, sid);

const B = await open('bob', `#s-${sid}`);
ok(await B.evaluate(() => document.body.innerText.includes('Invitación')), 'B ve la invitación del enlace');
await B.getByText('Entrar al servidor').click();
await B.waitForFunction(() => document.querySelector('.mp-msg')?.textContent.includes('lleno'), null, { timeout: 20000 }).catch(() => {});
ok(await B.evaluate(() => document.querySelector('.mp-msg')?.textContent.includes('lleno') && !window.__game.game.mp.active), 'servidor lleno: B rechazado con 5 dentro');
await A.evaluate(() => { for (const f of window.__fakes) { clearInterval(f.iv); f.send('bye'); f.ch.close(); } });
await B.waitForTimeout(500);
await B.getByText('Entrar al servidor').click();
await B.waitForFunction(() => window.__game.game.mp.active, null, { timeout: 20000 }).catch(() => {});
ok(await B.evaluate(() => window.__game.game.mp.active), 'B entra cuando hay sitio');
await play(B);
await B.waitForTimeout(1500);

const remotes = (p) => p.evaluate(() => [...window.__game.game.mp.remotes.values()].map((r) => ({ uid: r.uid, pos: r.target.toArray() })));
ok((await remotes(A)).some((r) => r.uid === 'bob'), 'A ve a B');
ok((await remotes(B)).some((r) => r.uid === 'alice'), 'B ve a A');

// Movimiento: A se teletransporta, B lo ve llegar.
await A.evaluate(() => { const g = window.__game.game; g.player.teleport(-60, g.hf.heightAt(-60, 40) + 0.1, 40, 0); });
await B.waitForTimeout(1500);
const ra = (await remotes(B)).find((r) => r.uid === 'alice');
ok(ra && Math.hypot(ra.pos[0] + 60, ra.pos[2] - 40) < 1.5, `B ve a A en su nueva posición (${ra?.pos.map((v) => v.toFixed(1))})`);

// Acciones: talar, picar.
const acts = await A.evaluate(() => {
  const g = window.__game.game;
  const t = g.vegetation.nearbyTrees(-40, 60, 60).find((x) => g.vegetation.isStanding(x));
  g.treeFelling.damage(t.id, 9999, new THREE_V(t.x - 2, t.y, t.z));
  const rock = [...g.resources.rocks.values()][0];
  g.resources.mine(rock.id, 200, { x: rock.x ?? 0, y: 10, z: rock.z ?? 0 });
  return { tree: t.id, rock: rock.id, stones: rock.stones };
  function THREE_V(x, y, z) { return g.player.pos.clone().set(x, y, z); }
});
await B.waitForFunction((a) => window.__game.game.vegetation.felled.has(a.tree), acts, { timeout: 15000 }).catch(() => {});
const seen = await B.evaluate((a) => {
  const g = window.__game.game;
  return { felled: g.vegetation.felled.has(a.tree), stones: g.resources.rocks.get(a.rock).stones };
}, acts);
ok(seen.felled, 'B ve talado el árbol de A');
ok(seen.stones === acts.stones, `B ve la roca picada (${seen.stones}/${acts.stones})`);

// Chat.
await A.evaluate(() => window.__game.game.mp.sendChat('¡Hola, Bob!'));
await B.waitForFunction(() => window.__game.game.mp.chat.some((l) => l.text === '¡Hola, Bob!'), null, { timeout: 15000 }).catch(() => {});
ok(await B.evaluate(() => window.__game.game.mp.chat.some((l) => l.text === '¡Hola, Bob!' && l.who)), 'B recibe el chat de A');
ok(await B.evaluate(() => document.querySelector('.mp-log')?.textContent.includes('¡Hola, Bob!')), 'el chat se ve en pantalla');

// Hora: la marca el dueño (A).
await A.evaluate(() => { const g = window.__game.game; g.time.deserialize({ totalMinutes: g.time.totalMinutes + 300 }); });
await B.waitForTimeout(1500);
const [ta, tb] = await Promise.all([A, B].map((p) => p.evaluate(() => window.__game.game.time.totalMinutes)));
ok(Math.abs(ta - tb) < 5, `hora sincronizada (${ta.toFixed(0)} / ${tb.toFixed(0)})`);

// Guardado: mundo en la "nube" y partida personal.
await B.evaluate(() => { const g = window.__game.game; g.inventory.add('stone', 7); g.save.autosave(); });
await A.evaluate(() => window.__game.game.save.autosave());
await A.waitForTimeout(2500);
const worldDoc = await A.evaluate((sid) => JSON.parse(localStorage.getItem(`tlh_db:worlds/${sid}`) ?? 'null'), sid);
ok(worldDoc?.rocks && Object.keys(worldDoc.rocks).includes(acts.rock), 'el mundo guardado tiene la roca picada');
ok(worldDoc?.felled?.some(([id]) => id === acts.tree), 'el mundo guardado tiene el árbol talado');
ok(worldDoc?.members?.includes('bob'), 'B figura como miembro');
const cloudB = await B.evaluate((sid) => localStorage.getItem(`tlh_db:data/users/bob/w_${sid}`)?.length ?? 0, sid);
ok(cloudB > 1000, `partida personal de B en la nube (${(cloudB / 1024).toFixed(0)} KB)`);

// B recarga con el enlace: vuelve con su inventario y el mundo compartido.
const stonesBefore = await B.evaluate(() => window.__game.game.inventory.count('stone'));
await B.close();
await A.close(); // el mundo sale de la base de datos, no de A
const B2 = await open('bob', `#s-${sid}`);
console.log('guardados', JSON.stringify(await B2.evaluate((sid) => {
  const loc = JSON.parse(localStorage.getItem(`tlh_save_mp_${sid}_bob`) ?? 'null');
  const cl = JSON.parse(localStorage.getItem(`tlh_db:data/users/bob/w_${sid}`) ?? 'null');
  const st = (d) => d && { at: d.savedAt, inv: JSON.stringify(d.systems.inventory).match(/stone[^\]]*/)?.[0] };
  return { loc: st(loc), cloud: st(cl), invNow: window.__game.game.inventory.count('stone') };
}, sid)));
await B2.getByText('Entrar al servidor').click({ timeout: 90000 });
await B2.waitForFunction(() => window.__game.game.mp.active, null, { timeout: 20000 }).catch(() => {});
const after = await B2.evaluate((a) => { const g = window.__game.game; return { stones: g.inventory.count('stone'), felled: g.vegetation.felled.has(a.tree), rock: g.resources.rocks.get(a.rock).stones }; }, acts);
ok(after.stones === stonesBefore, `B recupera su inventario (${after.stones} piedras, antes ${stonesBefore})`);
ok(after.felled && after.rock === acts.stones, 'B recupera el mundo compartido (árbol talado y roca picada)');
const servers = await B2.evaluate(() => window.__game.game.mp.myServers());
ok(servers.some((s) => s.sid === sid && s.name === 'Prueba de Robledo'), 'el servidor aparece en «Tus servidores»');

// Pausa con enlace de invitación.
await B2.evaluate(() => window.__game.game.ui.openPause());
const pauseText = await B2.evaluate(() => document.body.innerText);
ok(pauseText.includes('Copiar enlace') && pauseText.includes('/5 jugadores'), 'la pausa muestra invitación y jugadores');
ok(await B2.evaluate(() => document.querySelector('.mp-panel, .panel input.mp-text')?.value?.includes(`#s-`) ?? false), 'el enlace lleva el id del servidor');

const bad = errors.filter((e) => !/WebGL|GPU stall|pointer lock|Pointer Lock|requestPointerLock/i.test(e));
ok(bad.length === 0, `sin errores de consola${bad.length ? ': ' + bad.slice(0, 5).join(' | ') : ''}`);
await browser.close();
console.log(failed ? `${failed} fallos` : 'multijugador OK');
process.exit(failed ? 1 : 0);
