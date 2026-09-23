/**
 * Bus de eventos tipado. Es la columna vertebral de la comunicación entre
 * sistemas: misiones, reputación, audio y UI escuchan lo que ocurre en el
 * mundo sin que la lógica de juego los conozca.
 */
export interface GameEvents {
  'item:acquired': { itemId: string; count: number; source: 'pickup' | 'trade' | 'reward' | 'container' | 'craft' | 'loot' };
  'item:removed': { itemId: string; count: number; reason: 'drop' | 'consume' | 'trade' | 'deliver' | 'store' };
  'item:stolen': { itemId: string; ownerVillage: string; witnessed: boolean };
  'item:placed': { itemId: string; x: number; y: number; z: number };
  'npc:talked': { npcId: string };
  'npc:died': { npcId: string; killerId: string | null };
  'doc:read': { docId: string };
  'area:entered': { areaId: string };
  'area:left': { areaId: string };
  'flag:set': { flag: string };
  'actor:damaged': { targetId: string; attackerId: string | null; amount: number; part: string; blocked: boolean };
  'actor:killed': { victimId: string; victimKind: string; victimFaction: string; killerId: string | null };
  'player:damaged': { amount: number; attackerId: string | null; blocked: boolean };
  'player:died': { cause: string };
  'player:slept': { hours: number };
  'crime': { type: 'theft' | 'assault' | 'murder' | 'livestock'; village: string; witnessed: boolean };
  'reputation:changed': { village: string; delta: number; value: number; reason: string };
  'quest:started': { questId: string };
  'quest:updated': { questId: string; text: string };
  'quest:completed': { questId: string };
  'quest:failed': { questId: string };
  'raid:planned': { raidId: string; village: string };
  'raid:spotted': { raidId: string; village: string; direction: string };
  'raid:retreat': { raidId: string };
  'raid:ended': { raidId: string; village: string; result: 'repelled' | 'failed'; summary: string };
  'building:damaged': { buildingId: string; health: number };
  'building:fire': { buildingId: string; burning: boolean };
  'tree:felled': { treeId: string };
  'time:hour': { day: number; hour: number };
  'weather:changed': { state: string };
  'notify': { text: string; kind?: 'info' | 'quest' | 'warning' | 'alert' | 'item' };
  'sfx': { id: string; x?: number; y?: number; z?: number; volume?: number };
  'game:saved': { slot: string };
  'game:loaded': { slot: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<unknown>);
    return () => set!.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    // Copia para permitir que un manejador se desuscriba durante el emit.
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[EventBus] error en manejador de "${String(type)}"`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
