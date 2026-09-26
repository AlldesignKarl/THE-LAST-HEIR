/**
 * Capa de transporte para el multijugador.
 *
 * - En claude.ai (Artifact publicado): capacidades `room` (presencia y
 *   mensajes en tiempo real entre quienes tienen la página abierta), `db`
 *   (documentos compartidos persistentes) y `user` (identidad).
 * - En local, con `?mplocal`: BroadcastChannel + localStorage entre
 *   pestañas del mismo navegador (para desarrollo y pruebas E2E).
 * - Sin nada de eso: `null` (el juego sigue en un jugador).
 */

export interface NetPeer {
  /** Pestaña/documento abierto (único por conexión). */
  peer: string;
  /** Id duradero del usuario (null si la plataforma no lo da). */
  by: string | null;
  isMe: boolean;
  guest: boolean;
  presence: Record<string, unknown>;
}

export interface NetDoc {
  exists: boolean;
  data: Record<string, unknown> | undefined;
}

export interface NetDb {
  get(path: string): Promise<NetDoc>;
  set(path: string, data: Record<string, unknown>): Promise<void>;
  update(path: string, data: Record<string, unknown>): Promise<void>;
  delete(path: string): Promise<void>;
  /** Documentos de una colección (una vez). */
  list(collection: string): Promise<{ id: string; data: Record<string, unknown> }[]>;
  /** Suscripción a una colección: cambios en vivo. */
  watch(collection: string, cb: (docs: { id: string; data: Record<string, unknown> }[]) => void): () => void;
  /** Colecciones cuyos documentos tienen `field` que contiene `value`. */
  query(collection: string, field: string, value: string): Promise<{ id: string; data: Record<string, unknown> }[]>;
}

/** Una sala con nombre (un servidor): solo la oyen quienes se unen a ella. */
export interface NetRoom {
  /** Fusiona `patch` en mi presencia (un campo a null lo borra). */
  presence(patch: Record<string, unknown>): void;
  peers(): NetPeer[];
  onPeers(cb: (peers: NetPeer[]) => void): () => void;
  connected(): boolean;
  leave(): void;
}

export interface NetTransport {
  kind: 'claude' | 'local';
  /** Id del usuario (para datos privados y como identidad estable). */
  userId: string | null;
  /** Nombre visible de un usuario por id (puede ser ""). */
  names(ids: string[]): Promise<Record<string, string>>;
  /** Entra en una sala con nombre (^[a-z0-9][a-z0-9_.-]{0,47}$). */
  join(name: string): Promise<NetRoom>;
  /** Base de datos compartida (null si no disponible). */
  db: NetDb | null;
  /** ¿Puede este usuario escribir datos compartidos? (null = desconocido) */
  canWrite: boolean | null;
}

// ------------------------------------------------------------------ claude.ai

type Anyish = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function claudeTransport(): Promise<NetTransport | null> {
  const w = window as Anyish;
  if (!w.claude?.use) return null;
  const [room, db, user] = await Promise.all([
    w.claude.use('room').catch(() => null),
    w.claude.use('db').catch(() => null),
    w.claude.use('user').catch(() => null),
  ]);
  if (!room) return null;
  const userId: string | null = user ? await user.id().catch(() => null) : null;
  const canWrite: boolean | null = user ? await user.can('data.write').catch(() => null) : null;
  const toPeer = (p: Anyish): NetPeer => ({ peer: p.peer, by: p.by ?? null, isMe: !!p.sameTab, guest: !!p.guest, presence: (p.presence ?? {}) as Record<string, unknown> });
  const netDb: NetDb | null = db ? {
    async get(path) { const s = await db.doc(path).get(); return { exists: s.exists, data: s.data() }; },
    set: (path, data) => db.doc(path).set(data),
    update: (path, data) => db.doc(path).update(data),
    delete: (path) => db.doc(path).delete(),
    async list(col) { const s = await db.collection(col).get(); return s.docs.map((d: Anyish) => ({ id: d.id, data: d.data() })); },
    watch(col, cb) {
      return db.collection(col).onSnapshot((s: Anyish) => cb(s.docs.map((d: Anyish) => ({ id: d.id, data: d.data() }))), () => {});
    },
    async query(col, field, value) {
      const s = await db.collection(col).where(field, 'array-contains', value).limit(20).get();
      return s.docs.map((d: Anyish) => ({ id: d.id, data: d.data() }));
    },
  } : null;
  return {
    kind: 'claude',
    userId,
    async names(ids) {
      const out: Record<string, string> = {};
      if (!user || !ids.length) return out;
      const ps = await user.profiles(ids).catch(() => ({}));
      for (const id of ids) out[id] = ps[id]?.name || '';
      return out;
    },
    async join(name) {
      const r = await room.join(name);
      return {
        presence(patch) { r.presence(patch).catch(() => {}); },
        peers() { return r.peers().filter((p: Anyish) => p.kind !== 'agent').map(toPeer); },
        onPeers(cb) { return r.onPeers((c: Anyish) => cb(c.peers.filter((p: Anyish) => p.kind !== 'agent').map(toPeer)), () => {}); },
        connected: () => r.connected(),
        leave() { r.leave().catch(() => {}); },
      };
    },
    db: netDb,
    canWrite,
  };
}

// ------------------------------------------------------------------ local (pruebas)

function localTransport(): NetTransport {
  const peerId = `p${Math.random().toString(36).slice(2, 10)}`;
  const params = new URLSearchParams(location.search);
  const userId = params.get('uid') ?? `u_${peerId}`;
  const K = (path: string) => `tlh_db:${path}`;
  const watchers = new Map<string, ((docs: { id: string; data: Record<string, unknown> }[]) => void)[]>();
  const listCol = (col: string) => {
    const out: { id: string; data: Record<string, unknown> }[] = [];
    const prefix = K(col) + '/';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) out.push({ id: k.slice(prefix.length), data: JSON.parse(localStorage.getItem(k)!) });
    }
    return out;
  };
  const fire = (path: string) => {
    const col = path.slice(0, path.lastIndexOf('/'));
    for (const cb of watchers.get(col) ?? []) cb(listCol(col));
  };
  window.addEventListener('storage', (e) => { if (e.key?.startsWith('tlh_db:')) fire(e.key.slice(7)); });
  const db: NetDb = {
    async get(path) { const v = localStorage.getItem(K(path)); return { exists: v !== null, data: v ? JSON.parse(v) : undefined }; },
    async set(path, data) { localStorage.setItem(K(path), JSON.stringify(data)); fire(path); },
    async update(path, data) { const v = localStorage.getItem(K(path)); if (!v) throw new Error('invalid_argument'); localStorage.setItem(K(path), JSON.stringify({ ...JSON.parse(v), ...data })); fire(path); },
    async delete(path) { localStorage.removeItem(K(path)); fire(path); },
    async list(col) { return listCol(col); },
    watch(col, cb) {
      if (!watchers.has(col)) watchers.set(col, []);
      watchers.get(col)!.push(cb);
      setTimeout(() => cb(listCol(col)), 0);
      return () => { const a = watchers.get(col)!; a.splice(a.indexOf(cb), 1); };
    },
    async query(col, field, value) { return listCol(col).filter((d) => Array.isArray(d.data[field]) && (d.data[field] as unknown[]).includes(value)); },
  };
  const join = async (name: string): Promise<NetRoom> => {
    const ch = new BroadcastChannel(`tlh_mp_${name}`);
    const peers = new Map<string, NetPeer & { seen: number }>();
    let me: Record<string, unknown> = {};
    let left = false;
    const cbs: ((p: NetPeer[]) => void)[] = [];
    const list = (): NetPeer[] => [
      { peer: peerId, by: userId, isMe: true, guest: false, presence: me },
      ...[...peers.values()].map(({ seen: _s, ...p }) => p),
    ];
    const notify = () => { const l = list(); for (const cb of cbs) cb(l); };
    const send = (t: string) => { if (!left) ch.postMessage({ t, peer: peerId, by: userId, presence: me }); };
    ch.onmessage = (ev) => {
      const m = ev.data as { t: string; peer: string; by: string; presence?: Record<string, unknown> };
      if (m.peer === peerId) return;
      if (m.t === 'presence' || m.t === 'hello') {
        const isNew = !peers.has(m.peer);
        peers.set(m.peer, { peer: m.peer, by: m.by, isMe: false, guest: false, presence: m.presence ?? {}, seen: performance.now() });
        if (m.t === 'hello' && isNew) send('presence');
        notify();
      } else if (m.t === 'bye') { peers.delete(m.peer); notify(); }
    };
    send('hello');
    const bye = () => send('bye');
    window.addEventListener('beforeunload', bye);
    const iv = setInterval(() => {
      const now = performance.now();
      let changed = false;
      for (const [id, p] of peers) if (now - p.seen > 6000) { peers.delete(id); changed = true; }
      if (changed) notify();
      send('presence');
    }, 2000);
    let presT = 0, pending: ReturnType<typeof setTimeout> | null = null;
    return {
      presence(patch) {
        me = { ...me, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === null) delete me[k];
        const now = performance.now();
        if (now - presT > 60) { presT = now; send('presence'); }
        else if (!pending) pending = setTimeout(() => { pending = null; presT = performance.now(); send('presence'); }, 60);
      },
      peers: list,
      onPeers(cb) { cbs.push(cb); setTimeout(() => cb(list()), 0); return () => { const i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); }; },
      connected: () => !left,
      leave() { bye(); left = true; clearInterval(iv); ch.close(); window.removeEventListener('beforeunload', bye); },
    };
  };
  return {
    kind: 'local',
    userId,
    async names(ids) { const o: Record<string, string> = {}; for (const id of ids) o[id] = `Jugador ${id.slice(-3)}`; return o; },
    join,
    db,
    canWrite: params.get('ro') === null,
  };
}

/** Obtiene el transporte disponible (o null en un jugador puro). */
export async function openTransport(): Promise<NetTransport | null> {
  const params = new URLSearchParams(location.search);
  if (params.has('mplocal')) return localTransport();
  try {
    return await claudeTransport();
  } catch {
    return null;
  }
}
