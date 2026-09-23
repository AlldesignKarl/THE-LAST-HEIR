import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { Flags } from '../src/core/Flags';
import { Inventory } from '../src/items/Inventory';
import { QuestSystem, type QuestContext } from '../src/quests/QuestSystem';
import { QUESTS } from '../src/data/quests';
import { Reputation } from '../src/social/Reputation';

function setup() {
  const bus = new EventBus();
  const flags = new Flags(bus);
  const inv = new Inventory();
  const rep = new Reputation(bus);
  const ctx: QuestContext = {
    bus,
    hasFlag: (f) => flags.has(f),
    setFlag: (f) => flags.set(f),
    itemCount: (id) => inv.count(id),
    giveItem: (id, n) => { inv.add(id, n); bus.emit('item:acquired', { itemId: id, count: n, source: 'reward' }); },
    takeItem: (id, n) => inv.remove(id, n),
    giveCoins: (n) => { inv.coins += n; },
    changeRep: (v, d, r) => rep.change(v, d, r),
  };
  const qs = new QuestSystem(QUESTS, ctx);
  return { bus, flags, inv, rep, qs };
}

describe('QuestSystem', () => {
  it('historia principal avanza por eventos en orden', () => {
    const { bus, flags, inv, qs } = setup();
    qs.start('main_legacy');
    expect(qs.stageId('main_legacy')).toBe('search_hut');
    flags.set('board_opened');
    bus.emit('doc:read', { docId: 'letter_rodrigo' });
    expect(qs.stageId('main_legacy')).toBe('ask_gil');
    expect(flags.has('story_stage_1')).toBe(true);
    flags.set('gil_told_cave');
    bus.emit('area:entered', { areaId: 'cave_crow_inside' });
    expect(qs.stageId('main_legacy')).toBe('search_cave');
    inv.add('satchel_rodrigo');
    bus.emit('item:acquired', { itemId: 'satchel_rodrigo', count: 1, source: 'pickup' });
    expect(qs.stageId('main_legacy')).toBe('open_satchel');
    bus.emit('doc:read', { docId: 'journal_page_1' });
    flags.set('asked_priest_crest');
    flags.set('gil_crest');
    expect(qs.stageId('main_legacy')).toBe('to_valdeolmo');
  });

  it('una etapa ya cumplida al entrar se salta (flags previos)', () => {
    const { bus, flags, qs } = setup();
    flags.set('board_opened');
    flags.set('gil_told_cave');
    qs.start('main_legacy');
    bus.emit('doc:read', { docId: 'letter_rodrigo' });
    expect(qs.stageId('main_legacy')).toBe('find_cave');
  });

  it('entrega y recompensa de caza', () => {
    const { inv, qs, rep } = setup();
    qs.start('hunt_gil');
    inv.add('hide', 2);
    expect(qs.canDeliver('hunt_gil', 'gil')).toBe(true);
    const before = rep.get('robledo');
    expect(qs.deliver('hunt_gil', 'gil')).toBe(true);
    expect(qs.status('hunt_gil')).toBe('completed');
    expect(inv.count('hide')).toBe(0);
    expect(inv.coins).toBe(30);
    expect(inv.count('arrow')).toBe(10);
    expect(rep.get('robledo')).toBeGreaterThan(before);
  });

  it('progreso externo (troncos) y serialización', () => {
    const { qs, bus } = setup();
    qs.start('side_palisade');
    qs.setProgress('side_palisade', 0, 3);
    const saved = JSON.parse(JSON.stringify(qs.serialize()));
    const s2 = setup();
    s2.qs.deserialize(saved);
    expect(s2.qs.list()[0].objectives[0].text).toContain('(3/6)');
    qs.setProgress('side_palisade', 0, 6);
    expect(qs.stageId('side_palisade')).toBe('report');
    bus.emit('npc:talked', { npcId: 'sancho' });
    expect(qs.status('side_palisade')).toBe('completed');
  });
});

describe('Reputation', () => {
  it('los delitos presenciados bajan la reputación y activan persecución', () => {
    const bus = new EventBus();
    const rep = new Reputation(bus);
    bus.emit('crime', { type: 'assault', village: 'robledo', witnessed: true });
    expect(rep.get('robledo')).toBeLessThan(0);
    expect(rep.hostile('robledo')).toBe(true);
    rep.update(200);
    expect(rep.hostile('robledo')).toBe(false);
  });

  it('precios según reputación', () => {
    const rep = new Reputation(null);
    const lowBuy = rep.buyMultiplier('robledo');
    rep.change('robledo', 60, 'test');
    expect(rep.buyMultiplier('robledo')).toBeLessThan(lowBuy);
    expect(rep.sellFraction('robledo')).toBeGreaterThan(0.45);
  });
});
