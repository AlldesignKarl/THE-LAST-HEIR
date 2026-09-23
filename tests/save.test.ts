import { describe, expect, it } from 'vitest';
import { SaveSystem, type StorageBackend } from '../src/save/SaveSystem';
import { EventBus } from '../src/core/EventBus';
import { Inventory } from '../src/items/Inventory';
import { Flags } from '../src/core/Flags';
import { TimeOfDay } from '../src/env/TimeOfDay';
import { Weather } from '../src/env/Weather';
import { Vitals } from '../src/survival/Vitals';

class MemStorage implements StorageBackend {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function world(storage: MemStorage) {
  const bus = new EventBus();
  const inv = new Inventory();
  const flags = new Flags(bus);
  const time = new TimeOfDay(bus);
  const weather = new Weather(bus);
  const vitals = new Vitals();
  const save = new SaveSystem(bus, storage);
  save.register({ id: 'inventory', serialize: () => inv.serialize(), deserialize: (d) => inv.deserialize(d as never) });
  save.register({ id: 'flags', serialize: () => flags.serialize(), deserialize: (d) => flags.deserialize(d as never) });
  save.register({ id: 'time', serialize: () => time.serialize(), deserialize: (d) => time.deserialize(d as never) });
  save.register({ id: 'weather', serialize: () => weather.serialize(), deserialize: (d) => weather.deserialize(d as never) });
  save.register({ id: 'vitals', serialize: () => vitals.serialize(), deserialize: (d) => vitals.deserialize(d as never) });
  save.summary = () => `Día ${time.day}`;
  return { inv, flags, time, weather, vitals, save };
}

describe('SaveSystem', () => {
  it('guarda y restaura el estado completo', () => {
    const st = new MemStorage();
    const a = world(st);
    a.inv.add('sword'); a.inv.add('arrow', 12); a.inv.coins = 99;
    a.flags.set('board_opened'); a.flags.setNum('raids', 2);
    a.time.advanceHours(30);
    a.weather.set('rain', true);
    a.vitals.hunger = 33;
    expect(a.save.save('1')).toBe(true);

    const b = world(st);
    expect(b.save.loadNow('1')).toBe(true);
    expect(b.inv.count('arrow')).toBe(12);
    expect(b.inv.coins).toBe(99);
    expect(b.flags.has('board_opened')).toBe(true);
    expect(b.flags.num('raids')).toBe(2);
    expect(b.time.day).toBe(a.time.day);
    expect(b.weather.state).toBe('rain');
    expect(b.vitals.hunger).toBeCloseTo(33);
    expect(b.save.info('1')).toContain('Día 2');
    expect(b.save.latestSlot()).toBe('1');
  });

  it('un guardado corrupto no rompe la carga', () => {
    const st = new MemStorage();
    st.setItem('tlh_save_2', '{no es json');
    const a = world(st);
    expect(a.save.loadNow('2')).toBe(false);
  });
});
