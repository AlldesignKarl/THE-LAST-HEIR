import { describe, expect, it } from 'vitest';
import { Inventory, Equipment } from '../src/items/Inventory';
import { Vitals } from '../src/survival/Vitals';

describe('Inventory', () => {
  it('apila hasta el máximo de pila y crea nuevas pilas', () => {
    const inv = new Inventory();
    expect(inv.add('arrow', 50)).toBe(50);
    expect(inv.stacks.length).toBe(2);
    expect(inv.count('arrow')).toBe(50);
  });

  it('respeta el límite de peso', () => {
    const inv = new Inventory(10, 12);
    const added = inv.add('bucket_water', 5); // 9 kg cada uno
    expect(added).toBe(1);
    expect(inv.weight).toBeLessThanOrEqual(12);
  });

  it('los objetos pesados no entran en la bolsa', () => {
    const inv = new Inventory();
    expect(inv.canAdd('log')).toBe(false);
    expect(inv.add('log')).toBe(0);
  });

  it('quita de varias pilas', () => {
    const inv = new Inventory();
    inv.add('arrow', 45);
    expect(inv.remove('arrow', 42)).toBe(42);
    expect(inv.count('arrow')).toBe(3);
  });

  it('serializa ida y vuelta', () => {
    const inv = new Inventory();
    inv.add('bread', 3); inv.coins = 17;
    const b = new Inventory();
    b.deserialize(JSON.parse(JSON.stringify(inv.serialize())));
    expect(b.count('bread')).toBe(3);
    expect(b.coins).toBe(17);
  });

  it('equipo: arco a dos manos quita la antorcha', () => {
    const inv = new Inventory();
    inv.add('bow'); inv.add('torch'); inv.add('sword');
    const eq = new Equipment(inv);
    eq.equip('torch');
    expect(eq.torchLit).toBe(true);
    eq.equip('bow');
    expect(eq.slots.off).toBeNull();
    expect(eq.torchLit).toBe(false);
    eq.equip('sword');
    eq.equip('torch');
    expect(eq.slots.main).toBe('sword');
    expect(eq.slots.off).toBe('torch');
    inv.remove('torch');
    eq.validate();
    expect(eq.slots.off).toBeNull();
  });
});

describe('Vitals', () => {
  it('hambre y sed bajan con el tiempo; dormir reduce el consumo', () => {
    const a = new Vitals(), b = new Vitals();
    a.timeSkip(8, false);
    b.timeSkip(8, true);
    expect(b.hunger).toBeGreaterThan(a.hunger);
    expect(a.thirst).toBeLessThan(80);
  });

  it('el frío intenso acaba dañando', () => {
    const v = new Vitals();
    for (let i = 0; i < 30 * 600; i++) v.update(1 / 30, 0.02, { ambientTemp: -8, insulation: 0, exertion: 0, resting: true });
    expect(v.warmth).toBeLessThan(12);
    expect(v.health).toBeLessThan(100);
  });

  it('la stamina se regenera tras el retraso', () => {
    const v = new Vitals();
    v.useStamina(50);
    for (let i = 0; i < 60; i++) v.update(1 / 30, 0.02, { ambientTemp: 18, insulation: 4, exertion: 0, resting: true });
    expect(v.stamina).toBeGreaterThan(55);
  });
});
