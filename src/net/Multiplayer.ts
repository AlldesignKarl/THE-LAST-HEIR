/**
 * Multijugador cooperativo (hasta 5 personas por servidor).
 *
 * Un "servidor" es un mundo compartido con id `sid`:
 *  - Sala en tiempo real `s-<sid>` (capacidad `room` de claude.ai): cada
 *    jugador publica su presencia ~10 veces por segundo (posición, mirada,
 *    animación, herramienta, antorcha, barca) y en ella una cola corta de
 *    ACCIONES numeradas (talar, picar) y el
 *    último mensaje de chat. La presencia la puede fijar cualquiera que
 *    esté en la sala (también invitados de solo lectura), así que todos
 *    ven lo que hacen los demás.
 *  - Documento `worlds/<sid>` (capacidad `db`): el estado compartido que
 *    persiste (árboles talados, rocas,
 *    barcas, hora y tiempo). Lo escribe un único "guardián" (el jugador
 *    con permiso de escritura de menor id de conexión) para no pisarse.
 *  - Partida personal (inventario, misiones, salud…) en
 *    `data/users/<uid>/w_<sid>` (privada de cada usuario) y copia local.
 *
 * Lo que NO se sincroniza (cada cliente lo simula por su cuenta): vecinos,
 * animales, asaltos, objetos sueltos por el suelo, contenido de arcones y
 * las misiones (cada jugador lleva su historia). Ver docs/ESTADO.md.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { openTransport, type NetTransport, type NetRoom, type NetPeer } from './Net';
import { HumanoidModel, type Appearance, type AnimState } from '../actors/HumanoidModel';
import type { SaveDoc } from '../save/SaveSystem';
import { itemDef } from '../data/items';
import { WEAPONS } from '../combat/WeaponDefs';
import { damp } from '../core/math';

export const MAX_PLAYERS = 5;
/** Dirección pública del juego publicado (para los enlaces de invitación). */
export const ARTIFACT_URL = 'https://claude.ai/artifact/GzFDGhFYs8k2mdVn115mby';
/** Sistemas del guardado que pertenecen al mundo compartido, no al jugador. */
const WORLD_SYSTEMS = ['vegetation', 'resources', 'boats', 'time', 'weather'];
const ACT_KEEP = 12;

/** Acciones que viajan en la presencia: [tipo, nº de secuencia, ...datos]. */
export type Act =
  | ['f', number, string, number, number]
  | ['m', number, string, number, number];

export interface WorldDoc {
  v: 1;
  name: string;
  owner: string;
  members: string[];
  created: number;
  savedAt: number;
  clock: number;
  weather: Record<string, unknown> | null;
  felled: [string, number][];
  rocks: Record<string, [number, number]>;
  boats: Record<string, [number, number, number]>;
}

interface Remote {
  peer: string;
  uid: string | null;
  model: HumanoidModel;
  tag: THREE.Sprite;
  name: string;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  tyaw: number;
  speed: number;
  lastSeq: number;
  chatSeq: number;
  weapon: string;
  off: string;
  boat: string | null;
  anim: string;
}

export interface ChatLine { who: string; text: string; me: boolean; t: number }

/** Resultado de intentar entrar en un servidor. */
export type JoinResult = { ok: true } | { ok: false; reason: string };

const SID_RE = /^[a-z0-9]{6,20}$/;

/** Extrae el id de servidor de un enlace, un `#s-…` o un código suelto. */
export function parseServerId(text: string): string | null {
  const t = text.trim().toLowerCase();
  const m = t.match(/(?:#|^)s-([a-z0-9]{6,20})\b/) ?? t.match(/^([a-z0-9]{6,20})$/);
  return m && SID_RE.test(m[1]) ? m[1] : null;
}

function randomId(n = 10): string {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((x) => a[x % a.length]).join('');
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const TUNICS = [0x6a3a2a, 0x3a4a6a, 0x4a5a32, 0x6a5a3a, 0x5a2a3a, 0x2a4a4a, 0x7a6a4a];
const SKINS = [0xd8b090, 0xc89a78, 0xb08060, 0x8a6048, 0xe0c0a0];
const HAIRS = [0x2a2018, 0x5a4030, 0x8a6a40, 0x1a1410, 0x6a5a50];

/** Aspecto estable a partir del id del jugador. */
export function appearanceFor(id: string): Appearance {
  const h = hash(id);
  return {
    skin: SKINS[h % SKINS.length], tunic: TUNICS[(h >>> 3) % TUNICS.length], pants: 0x3a3226,
    hair: HAIRS[(h >>> 6) % HAIRS.length], beard: ((h >>> 9) & 3) === 0, female: ((h >>> 11) & 1) === 1,
    hood: ((h >>> 12) & 3) === 1, build: 0.95 + ((h >>> 14) % 10) / 100,
  };
}

function nameTag(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const x = c.getContext('2d')!;
  x.font = '600 26px "EB Garamond", Georgia, serif';
  const w = Math.min(248, x.measureText(text).width + 20);
  x.fillStyle = 'rgba(20,14,8,0.55)';
  x.fillRect(128 - w / 2, 6, w, 36);
  x.fillStyle = '#f0e2c0';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  s.scale.set(1.6, 0.3, 1);
  s.renderOrder = 5;
  return s;
}

export class Multiplayer {
  transport: NetTransport | null = null;
  /** Promesa de disponibilidad (se resuelve al arrancar). */
  readonly ready: Promise<boolean>;
  sid: string | null = null;
  world: WorldDoc | null = null;
  private room: NetRoom | null = null;
  private myPeer = '';
  readonly remotes = new Map<string, Remote>();
  private acts: Act[] = [];
  private seq = 0;
  private chatSeq = 0;
  private myChat: [number, string] | null = null;
  readonly chat: ChatLine[] = [];
  private sendT = 0;
  private dirty = false;
  private persistT = 0;
  private lastPersist = 0;
  private lastCloudSave = 0;
  private names = new Map<string, string>();
  private lastPeers: NetPeer[] = [];
  /** Última acción y chat aplicados de cada conexión (sobrevive a cortes). */
  private seenSeq = new Map<string, [number, number]>();
  /** Cambios de la lista de jugadores o del chat (para la interfaz). */
  onChange: (() => void) | null = null;
  status = '';

  constructor(private readonly g: Game) {
    this.ready = openTransport().then((t) => { this.transport = t; return !!t; }).catch(() => false);
  }

  get active(): boolean { return !!this.room && !!this.sid; }
  get available(): boolean { return !!this.transport; }
  get canPersist(): boolean { return !!this.transport?.db && this.transport.canWrite !== false; }
  get userId(): string | null { return this.transport?.userId ?? null; }

  /** Enlace para invitar a este servidor. */
  inviteLink(sid = this.sid ?? ''): string {
    if (this.transport?.kind === 'local') {
      const u = new URL(location.href);
      u.searchParams.delete('uid');
      u.hash = `s-${sid}`;
      return u.toString();
    }
    return `${ARTIFACT_URL}#s-${sid}`;
  }

  /** Jugadores conectados ahora (incluido yo). */
  players(): { peer: string; name: string; me: boolean; guest: boolean }[] {
    const out = [{ peer: this.myPeer, name: 'Tú', me: true, guest: false }];
    for (const p of this.lastPeers) if (!p.isMe) out.push({ peer: p.peer, name: this.displayName(p.by, p.peer), me: false, guest: p.guest });
    return out;
  }

  private displayName(uid: string | null, peer: string): string {
    return (uid && this.names.get(uid)) || `Viajero ${peer.slice(-3).toUpperCase()}`;
  }

  // ------------------------------------------------------------ servidores

  async createServer(name: string): Promise<{ sid: string } | { error: string }> {
    await this.ready;
    const t = this.transport;
    if (!t) return { error: 'El multijugador no está disponible aquí.' };
    const sid = randomId();
    const uid = t.userId ?? 'anon';
    const doc: WorldDoc = {
      v: 1, name: name.trim().slice(0, 40) || 'Robledo', owner: uid, members: [uid], created: Date.now(), savedAt: Date.now(),
      clock: 0, weather: null, felled: [], rocks: {}, boats: {},
    };
    if (t.db && t.canWrite !== false) {
      try { await t.db.set(`worlds/${sid}`, doc as unknown as Record<string, unknown>); }
      catch { return { error: 'No tienes permiso para crear servidores en esta página. Pide al dueño que te dé acceso de «colaborador» o únete con un enlace.' }; }
    }
    return { sid };
  }

  async myServers(): Promise<{ sid: string; name: string; savedAt: number; owner: boolean }[]> {
    await this.ready;
    const t = this.transport;
    if (!t?.db || !t.userId) return [];
    try {
      const list = await t.db.query('worlds', 'members', t.userId);
      return list.map((d) => ({ sid: d.id, name: String(d.data.name ?? d.id), savedAt: Number(d.data.savedAt ?? 0), owner: d.data.owner === t.userId }))
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch { return []; }
  }

  async peek(sid: string): Promise<{ name: string } | null> {
    await this.ready;
    try {
      const d = await this.transport?.db?.get(`worlds/${sid}`);
      return d?.exists ? { name: String(d.data?.name ?? sid) } : null;
    } catch { return null; }
  }

  /** Entra en un servidor. Debe llamarse sobre un mundo recién cargado (desde el menú). */
  async join(sid: string): Promise<JoinResult> {
    await this.ready;
    const t = this.transport;
    const g = this.g;
    if (!t) return { ok: false, reason: 'El multijugador solo funciona en la versión publicada en claude.ai.' };
    if (!SID_RE.test(sid)) return { ok: false, reason: 'Código de servidor no válido.' };
    let room: NetRoom;
    try { room = await t.join(`s-${sid}`); }
    catch { return { ok: false, reason: 'No se pudo conectar con la sala del servidor. Inténtalo de nuevo.' }; }
    // Esperar a que respondan los que ya están (el primer aviso no es definitivo).
    await new Promise((r) => setTimeout(r, 2500));
    const others = new Set(room.peers().filter((p) => !p.isMe).map((p) => p.peer));
    if (others.size >= MAX_PLAYERS) {
      room.leave();
      return { ok: false, reason: `El servidor está lleno (${MAX_PLAYERS}/${MAX_PLAYERS}). Prueba más tarde.` };
    }
    this.room = room;
    this.sid = sid;
    this.myPeer = room.peers().find((p) => p.isMe)?.peer ?? `me${randomId(6)}`;
    const uid = t.userId ?? this.myPeer;
    g.localPlayerId = uid;

    // Mundo compartido.
    let world: WorldDoc | null = null;
    try {
      const d = await t.db?.get(`worlds/${sid}`);
      if (d?.exists) world = d.data as unknown as WorldDoc;
    } catch { /* sin base de datos: mundo solo en memoria */ }
    const fresh = !world;
    if (!world) {
      world = { v: 1, name: 'Robledo', owner: uid, members: [uid], created: Date.now(), savedAt: 0, clock: 0, weather: null, felled: [], rocks: {}, boats: {} };
    }
    if (!world.members.includes(uid)) world.members = [...world.members, uid];
    this.world = world;

    // Partida personal: la más reciente entre la nube y la copia local.
    // La ranura local lleva el usuario: dos cuentas en un mismo navegador no se pisan.
    const slot = `mp_${sid}_${uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`;
    let personal: SaveDoc | null = g.save.read(slot);
    if (t.db && t.userId) {
      try {
        const d = await t.db.get(`data/users/${t.userId}/w_${sid}`);
        const cloud = d.exists ? (d.data as unknown as SaveDoc) : null;
        if (cloud && (!personal || Date.parse(cloud.savedAt) > Date.parse(personal.savedAt))) personal = cloud;
      } catch { /* sin nube: solo local */ }
    }
    if (personal) {
      g.save.apply(personal, new Set(WORLD_SYSTEMS));
      g.started = true;
    } else {
      g.newGame();
    }
    if (!fresh) this.applyWorld(world);
    // Guardado: la ranura del servidor y, además, la nube privada.
    g.save.autoSlot = slot;
    g.save.onAutosave = (doc) => this.cloudSave(doc);
    this.wire();
    room.onPeers((peers) => this.onPeers(peers));
    setInterval(() => this.tick(0.1), 100);
    this.dirty = true;
    if (t.canWrite !== false && t.db) {
      t.db.update(`worlds/${sid}`, { members: world.members }).catch(() => {
        if (fresh) t.db!.set(`worlds/${sid}`, world as unknown as Record<string, unknown>).catch(() => {});
      });
    }
    this.names.set(uid, 'Tú');
    this.status = '';
    this.sysChat(`Has entrado en «${world.name}».`);
    return { ok: true };
  }

  /** Sale del servidor (guardando antes). */
  leave(): void {
    if (!this.room) return;
    this.g.save.autosave();
    this.persist(true);
    this.room.leave();
    this.room = null;
  }

  // ------------------------------------------------------------ estado del mundo

  private applyWorld(w: WorldDoc): void {
    const g = this.g;
    if (w.clock) g.time.deserialize({ totalMinutes: w.clock });
    if (w.weather) g.weather.deserialize(w.weather as Parameters<typeof g.weather.deserialize>[0]);
    g.vegetation.deserialize({ felled: w.felled ?? [] });
    g.resources.deserialize(w.rocks ?? {});
    g.boats.deserialize(w.boats ?? {});
  }

  private snapshotWorld(): WorldDoc {
    const g = this.g;
    const w = this.world!;
    const members = new Set(w.members);
    for (const p of this.lastPeers) if (p.by) members.add(p.by);
    return {
      ...w,
      v: 1,
      members: [...members].slice(0, 200),
      savedAt: Date.now(),
      clock: g.time.serialize().totalMinutes,
      weather: g.weather.serialize() as Record<string, unknown>,
      felled: (g.vegetation.serialize() as { felled: [string, number][] }).felled,
      rocks: g.resources.serialize() as Record<string, [number, number]>,
      boats: g.boats.serialize() as Record<string, [number, number, number]>,
    };
  }

  /** ¿Me toca guardar el mundo? (el escritor con menor id de conexión). */
  private isPersister(): boolean {
    if (!this.canPersist) return false;
    const writers = [this.myPeer, ...this.lastPeers.filter((p) => !p.isMe && p.presence.wr === true).map((p) => p.peer)].sort();
    return writers[0] === this.myPeer;
  }

  /** ¿Marco yo la hora y el tiempo? (el dueño si está; si no, el menor id). */
  private isClockHost(): boolean {
    const owner = this.world?.owner;
    const all = [{ peer: this.myPeer, by: this.g.localPlayerId }, ...this.lastPeers.filter((p) => !p.isMe).map((p) => ({ peer: p.peer, by: p.by }))];
    const owners = all.filter((p) => p.by && p.by === owner).map((p) => p.peer).sort();
    const host = owners[0] ?? all.map((p) => p.peer).sort()[0];
    return host === this.myPeer;
  }

  private persist(force = false): void {
    const t = this.transport;
    if (!t?.db || !this.sid || !this.world || !this.isPersister()) return;
    const now = Date.now();
    if (!force && now - this.lastPersist < 1500) return;
    this.lastPersist = now;
    this.dirty = false;
    const doc = this.snapshotWorld();
    this.world = doc;
    t.db.set(`worlds/${this.sid}`, doc as unknown as Record<string, unknown>).catch(() => { this.status = 'No se pudo guardar el mundo en la nube.'; });
  }

  private cloudSave(doc: SaveDoc): void {
    const t = this.transport;
    this.persist(true);
    if (!t?.db || !t.userId || !this.sid || t.canWrite === false) return;
    const now = Date.now();
    if (now - this.lastCloudSave < 10000) return;
    this.lastCloudSave = now;
    const personal: SaveDoc = { ...doc, systems: { ...doc.systems } };
    for (const k of WORLD_SYSTEMS) delete personal.systems[k];
    t.db.set(`data/users/${t.userId}/w_${this.sid}`, personal as unknown as Record<string, unknown>).catch(() => { /* la copia local sigue */ });
  }

  // ------------------------------------------------------------ acciones locales → red

  private wire(): void {
    const g = this.g;
    g.resources.onChange = (id, stones, day) => this.push(['m', 0, id, stones, day]);
    g.bus.on('tree:felled', (e) => this.push(['f', 0, e.treeId, e.fromX ?? 0, e.fromZ ?? 0]));
  }

  private push(a: Act): void {
    a[1] = ++this.seq;
    this.acts.push(a);
    while (this.acts.length > ACT_KEEP) this.acts.shift();
    this.dirty = true;
    this.sendT = 1; // enviar ya
    this.tick(0);
  }

  sendChat(text: string): void {
    const t = text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').trim().slice(0, 140);
    if (!t || !this.room) return;
    this.myChat = [++this.chatSeq, t];
    this.chat.push({ who: 'Tú', text: t, me: true, t: performance.now() });
    this.trimChat();
    this.sendT = 1;
    this.tick(0);
    this.onChange?.();
  }

  private sysChat(text: string): void {
    this.chat.push({ who: '', text, me: false, t: performance.now() });
    this.trimChat();
    this.onChange?.();
  }

  private trimChat(): void { while (this.chat.length > 30) this.chat.shift(); }

  // ------------------------------------------------------------ red → mundo

  private onPeers(peers: NetPeer[]): void {
    const g = this.g;
    const before = new Set(this.remotes.keys());
    this.lastPeers = peers;
    const unknown: string[] = [];
    for (const p of peers) {
      if (p.isMe) continue;
      before.delete(p.peer);
      const pr = p.presence as Record<string, unknown>;
      if (!Array.isArray(pr.p)) continue; // aún sin estado
      let r = this.remotes.get(p.peer);
      if (!r) {
        r = this.spawnRemote(p);
        if (p.by && !this.names.has(p.by)) unknown.push(p.by);
      }
      const [x, y, z] = (pr.p as number[]).map(Number);
      if ([x, y, z].every(Number.isFinite)) r.target.set(x, y, z);
      if (typeof pr.yw === 'number') r.tyaw = pr.yw;
      r.anim = typeof pr.an === 'string' ? pr.an : 'idle';
      const w = typeof pr.w === 'string' ? pr.w : '';
      if (w !== r.weapon) { r.weapon = w; r.model.setWeapon(g.models, w || null, w === 'bow' ? 'bow' : w || null); }
      const o = typeof pr.o === 'string' ? pr.o : '';
      if (o !== r.off) { r.off = o; r.model.setOffhand(g.models, o || null); }
      this.remoteBoat(r, pr.bt);
      this.remoteActs(r, pr.a);
      this.remoteChat(r, pr.ch);
      if (Array.isArray(pr.hc) && !this.isClockHost()) this.syncClock(pr.hc as unknown[]);
    }
    for (const gone of before) this.dropRemote(gone, true);
    if (unknown.length && this.transport) {
      this.transport.names(unknown).then((n) => {
        for (const [id, name] of Object.entries(n)) if (name) this.names.set(id, name);
        for (const r of this.remotes.values()) this.retag(r);
        this.onChange?.();
      }).catch(() => {});
    }
    this.onChange?.();
  }

  private spawnRemote(p: NetPeer): Remote {
    const g = this.g;
    const model = new HumanoidModel(appearanceFor(p.by ?? p.peer), g.materials);
    model.models = g.models;
    g.renderer.scene.add(model.root);
    const name = this.displayName(p.by, p.peer);
    const tag = nameTag(name);
    g.renderer.scene.add(tag);
    const pr = p.presence as Record<string, unknown>;
    const start = Array.isArray(pr.p) ? new THREE.Vector3(...(pr.p as number[]).map(Number)) : new THREE.Vector3();
    // Las acciones que ya lleva en su cola son anteriores a mi llegada y
    // están en el mundo guardado; si no hay nube, se aplican todas.
    // Si esa conexión ya estuvo (un corte breve), se sigue donde se quedó.
    const acts = Array.isArray(pr.a) ? (pr.a as Act[]) : [];
    const prevSeen = this.seenSeq.get(p.peer);
    const baseline = prevSeen ? prevSeen[0] : this.transport?.db ? Math.max(0, ...acts.map((a) => Number(a[1]) || 0)) : 0;
    const chatBase = prevSeen ? prevSeen[1] : Array.isArray(pr.ch) ? Number((pr.ch as unknown[])[0]) || 0 : 0;
    const r: Remote = {
      peer: p.peer, uid: p.by, model, tag, name, pos: start.clone(), target: start, yaw: Number(pr.yw) || 0, tyaw: Number(pr.yw) || 0,
      speed: 0, lastSeq: baseline, chatSeq: chatBase, weapon: '', off: '', boat: null, anim: 'idle',
    };
    this.remotes.set(p.peer, r);
    this.sysChat(`${name} ha entrado.`);
    return r;
  }

  private retag(r: Remote): void {
    const name = this.displayName(r.uid, r.peer);
    if (name === r.name) return;
    r.name = name;
    this.g.renderer.scene.remove(r.tag);
    (r.tag.material as THREE.SpriteMaterial).map?.dispose();
    r.tag.material.dispose();
    r.tag = nameTag(name);
    this.g.renderer.scene.add(r.tag);
  }

  private dropRemote(peer: string, announce: boolean): void {
    const r = this.remotes.get(peer);
    if (!r) return;
    const g = this.g;
    g.renderer.scene.remove(r.model.root, r.tag);
    r.model.dispose();
    g.lights.remove(`mp_torch_${peer}`);
    if (r.boat) { const b = g.boats.boats.get(r.boat); if (b && b.rider === r.uid) b.rider = null; }
    this.seenSeq.set(peer, [r.lastSeq, r.chatSeq]);
    this.remotes.delete(peer);
    if (announce) this.sysChat(`${r.name} se ha ido.`);
  }

  private remoteBoat(r: Remote, bt: unknown): void {
    const boats = this.g.boats;
    const id = Array.isArray(bt) ? String(bt[0]) : null;
    if (r.boat && r.boat !== id) {
      const b = boats.boats.get(r.boat);
      if (b && b.rider === (r.uid ?? r.peer)) b.rider = null;
    }
    r.boat = id;
    if (!id || !Array.isArray(bt)) return;
    const b = boats.boats.get(id);
    if (!b || b === boats.riding) return;
    const [x, z, h] = [Number(bt[1]), Number(bt[2]), Number(bt[3])];
    if (![x, z, h].every(Number.isFinite)) return;
    b.rider = r.uid ?? r.peer;
    b.x = x; b.z = z; b.heading = h;
  }

  private remoteActs(r: Remote, list: unknown): void {
    if (!Array.isArray(list)) return;
    const g = this.g;
    const acts = (list as Act[]).filter((a) => Array.isArray(a) && Number(a[1]) > r.lastSeq).sort((a, b) => a[1] - b[1]);
    for (const a of acts) {
      r.lastSeq = a[1];
      try {
        switch (a[0]) {
          case 'f': g.treeFelling.fellRemote(String(a[2]), Number(a[3]) || 0, Number(a[4]) || 0); break;
          case 'm': g.resources.setRock(String(a[2]), Number(a[3]) || 0, Number(a[4]) || 0); break;
        }
      } catch (err) { console.warn('[MP] acción remota inválida', err); }
      this.dirty = true;
    }
  }

  private remoteChat(r: Remote, ch: unknown): void {
    if (!Array.isArray(ch)) return;
    const n = Number(ch[0]);
    if (!(n > r.chatSeq)) return;
    r.chatSeq = n;
    const text = String(ch[1] ?? '').slice(0, 140);
    if (!text) return;
    this.chat.push({ who: r.name, text, me: false, t: performance.now() });
    this.trimChat();
    this.g.bus.emit('sfx', { id: 'pickup', volume: 0.3 });
  }

  private syncClock(hc: unknown[]): void {
    const g = this.g;
    const minutes = Number(hc[0]);
    if (Number.isFinite(minutes) && Math.abs(minutes - g.time.totalMinutes) > 4) g.time.deserialize({ totalMinutes: minutes });
    const [state, cloud, fog, rain, wind, wet] = hc.slice(1) as [string, number, number, number, number, number];
    if (typeof state === 'string') {
      g.weather.deserialize({ state: state as Parameters<typeof g.weather.deserialize>[0]['state'], cloud: +cloud || 0, fog: +fog || 0, rain: +rain || 0, wind: +wind || 0, wetness: +wet || 0, next: 9999 });
    }
  }

  // ------------------------------------------------------------ cada frame

  frame(dt: number): void {
    if (!this.room) return;
    const g = this.g;
    // Jugadores remotos: interpolación y animación.
    const cam = g.renderer.camera.position;
    for (const r of this.remotes.values()) {
      const prev = r.pos.clone();
      if (r.pos.distanceTo(r.target) > 12) r.pos.copy(r.target);
      else r.pos.set(damp(r.pos.x, r.target.x, 10, dt), damp(r.pos.y, r.target.y, 10, dt), damp(r.pos.z, r.target.z, 10, dt));
      const d = Math.atan2(Math.sin(r.tyaw - r.yaw), Math.cos(r.tyaw - r.yaw));
      r.yaw += d * Math.min(1, dt * 12);
      const v = dt > 0 ? Math.hypot(r.pos.x - prev.x, r.pos.z - prev.z) / dt : 0;
      r.speed = damp(r.speed, v, 8, dt);
      const m = r.model;
      m.root.position.copy(r.pos);
      m.root.rotation.y = r.yaw + Math.PI;
      m.speed = r.speed;
      let st: AnimState = r.speed > 3.2 ? 'run' : r.speed > 0.4 ? 'walk' : 'idle';
      if (r.anim === 'strike' || r.anim === 'windup' || r.anim === 'block' || r.anim === 'fish' || r.anim === 'sit' || r.anim === 'aim') st = r.anim as AnimState;
      if (r.boat) st = 'sit';
      m.setState(st);
      const dist = r.pos.distanceTo(cam);
      m.root.visible = dist < 220;
      m.update(dt, dist < 45);
      r.tag.position.set(r.pos.x, r.pos.y + 2.15, r.pos.z);
      r.tag.visible = dist < 60;
      // Antorcha de otro jugador: luz real en el mundo.
      const lid = `mp_torch_${r.peer}`;
      if (r.off === 'torch') {
        const tp = m.torchWorld(new THREE.Vector3());
        const l = g.lights.get(lid);
        if (!l) g.lights.add({ id: lid, pos: tp, color: new THREE.Color(0xff9a4a), intensity: 30, range: 14, flicker: 0.4, priority: 6, enabled: true });
        else l.pos.copy(tp);
      } else if (g.lights.get(lid)) g.lights.remove(lid);
    }
  }

  /** Red (~10 Hz, con temporizador: sigue aunque no se dibuje). */
  private tick(dt: number): void {
    if (!this.room) return;
    this.sendT += dt;
    if (this.sendT >= 0.1) {
      this.sendT = 0;
      this.room.presence(this.myPresence());
    }
    // Guardián del mundo: guardar tras cambios y cada 30 s.
    this.persistT += dt;
    if ((this.dirty && this.persistT > 2) || this.persistT > 30) {
      this.persistT = 0;
      this.persist();
    }
  }

  private myPresence(): Record<string, unknown> {
    const g = this.g;
    const p = g.player.pos;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const main = g.equipment.slots.main;
    let w = '';
    if (main) {
      const d = itemDef(main);
      w = d.weapon ? WEAPONS[d.weapon].model : d.handTool ? d.model ?? '' : '';
    }
    const off = g.equipment.slots.off === 'torch' && g.equipment.torchLit ? 'torch' : g.equipment.slots.off === 'shield' ? 'shield' : '';
    const cs = g.combat.state;
    const an = g.fishing.state !== 'idle' ? 'fish' : cs === 'windup' || cs === 'strike' || cs === 'block' ? cs : cs === 'draw' ? 'aim' : '';
    const b = g.boats.riding;
    const out: Record<string, unknown> = {
      v: 1, p: [r2(p.x), r2(p.y), r2(p.z)], yw: Math.round(g.player.yaw * 1000) / 1000, an, w, o: off,
      bt: b ? [b.id, r2(b.x), r2(b.z), Math.round(b.heading * 1000) / 1000] : null,
      a: this.acts, ch: this.myChat, wr: this.canPersist,
    };
    if (this.isClockHost()) {
      const ws = g.weather.serialize() as { state: string; cloud: number; fog: number; rain: number; wind: number; wetness: number };
      out.hc = [Math.round(g.time.totalMinutes * 10) / 10, ws.state, r2(ws.cloud), r2(ws.fog), r2(ws.rain), r2(ws.wind), r2(ws.wetness)];
    } else out.hc = null;
    return out;
  }
}
