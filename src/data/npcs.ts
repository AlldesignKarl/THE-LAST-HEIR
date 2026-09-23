/**
 * Habitantes de Robledo. Cada uno tiene casa, oficio, agenda propia,
 * relaciones y apariencia. Las horas son de juego (0..24).
 */
import type { Appearance } from '../actors/HumanoidModel';
import type { WeaponId } from '../combat/WeaponDefs';

export type Activity = 'home' | 'work' | 'eat' | 'tavern' | 'pray' | 'patrol' | 'guard' | 'sell' | 'farm' | 'wander' | 'sleep' | 'hunt' | 'social';

export interface ScheduleEntry {
  from: number;
  place: string;
  activity: Activity;
}

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  profession: 'hunter' | 'smith' | 'innkeeper' | 'priest' | 'carpenter' | 'merchant' | 'guard' | 'farmer' | 'physician';
  village: string;
  home: string; // id de edificio
  faction: 'villager' | 'guard';
  appearance: Appearance;
  schedule: ScheduleEntry[];
  weapon: WeaponId | null;
  shield?: boolean;
  /** 0..1: probabilidad de plantar cara en un ataque (civiles). */
  bravery: number;
  health: number;
  relations: Record<string, string>;
  trader?: boolean;
  /** Frase de ambiente mientras trabaja. */
  barks: string[];
}

const skin = [0xc99a78, 0xb98b68, 0xd8ac88, 0xa87a58];

export const NPCS: NpcDef[] = [
  {
    id: 'gil', name: 'Gil «el Tuerto»', role: 'Cazador', profession: 'hunter', village: 'robledo', home: 'house_gil', faction: 'villager',
    appearance: { skin: skin[1], tunic: 0x4a4a2c, pants: 0x3a3226, hair: 0x5a5046, beard: true, hood: true, build: 1.02 },
    schedule: [
      { from: 5.5, place: 'door:house_gil', activity: 'wander' },
      { from: 6.5, place: 'forest_edge', activity: 'hunt' },
      { from: 12, place: 'plaza_bench', activity: 'eat' },
      { from: 13, place: 'forest_edge', activity: 'hunt' },
      { from: 18, place: 'tavern_table', activity: 'tavern' },
      { from: 21.5, place: 'in:house_gil', activity: 'sleep' },
    ],
    weapon: 'bow', bravery: 0.8, health: 90, relations: { rodrigo: 'amigo', anselmo: 'desconfía' }, trader: true,
    barks: ['Hay rastro de ciervo junto al arroyo.', 'Los lobos bajan cuando refresca.'],
  },
  {
    id: 'bartolome', name: 'Bartolomé', role: 'Herrero', profession: 'smith', village: 'robledo', home: 'house_bartolome', faction: 'villager',
    appearance: { skin: skin[0], tunic: 0x5a4636, pants: 0x2e2a26, hair: 0x2a2018, beard: true, apron: true, build: 1.12 },
    schedule: [
      { from: 6.5, place: 'door:house_bartolome', activity: 'wander' },
      { from: 7.5, place: 'smithy_anvil', activity: 'work' },
      { from: 12.5, place: 'tavern_table2', activity: 'eat' },
      { from: 13.5, place: 'smithy_anvil', activity: 'work' },
      { from: 19, place: 'tavern_table', activity: 'tavern' },
      { from: 22, place: 'in:house_bartolome', activity: 'sleep' },
    ],
    weapon: 'club', bravery: 0.9, health: 120, relations: { mendo: 'cuñado' }, trader: true,
    barks: ['¡Ese hierro no se forja solo!', 'El carbón está caro este año.'],
  },
  {
    id: 'ines', name: 'Inés', role: 'Tabernera', profession: 'innkeeper', village: 'robledo', home: 'tavern', faction: 'villager',
    appearance: { skin: skin[2], tunic: 0x7a3a2a, pants: 0x4a3a30, hair: 0x3a2618, beard: false, female: true, apron: true, build: 0.95 },
    schedule: [
      { from: 1, place: 'in:tavern', activity: 'sleep' },
      { from: 7, place: 'well', activity: 'work' },
      { from: 7.6, place: 'tavern_counter', activity: 'sell' },
    ],
    weapon: null, bravery: 0.3, health: 70, relations: { gil: 'aprecia' }, trader: true,
    barks: ['Vino de Toro, del bueno. O casi.', '¿Otra jarra?'],
  },
  {
    id: 'anselmo', name: 'Padre Anselmo', role: 'Sacerdote', profession: 'priest', village: 'robledo', home: 'parish_house', faction: 'villager',
    appearance: { skin: skin[2], tunic: 0x1e1c1c, pants: 0x1e1c1c, hair: 0x9a9a98, beard: false, robe: true, build: 0.96 },
    schedule: [
      { from: 6, place: 'church_altar', activity: 'pray' },
      { from: 9, place: 'plaza', activity: 'social' },
      { from: 11, place: 'church_altar', activity: 'pray' },
      { from: 13, place: 'in:parish_house', activity: 'home' },
      { from: 16, place: 'church_altar', activity: 'pray' },
      { from: 20.5, place: 'in:parish_house', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.1, health: 60, relations: { rodrigo: 'teme', conde: 'deudor' },
    barks: ['Dios os guarde.', 'Hay que pagar el diezmo, hijos.'],
  },
  {
    id: 'sancho', name: 'Sancho', role: 'Carpintero', profession: 'carpenter', village: 'robledo', home: 'house_sancho', faction: 'villager',
    appearance: { skin: skin[0], tunic: 0x6a5a3a, pants: 0x3a3a30, hair: 0x6a4a2a, beard: true, build: 1.0 },
    schedule: [
      { from: 6.5, place: 'door:house_sancho', activity: 'wander' },
      { from: 7, place: 'carpentry_bench', activity: 'work' },
      { from: 12, place: 'plaza_bench', activity: 'eat' },
      { from: 13, place: 'woodpile_zone', activity: 'work' },
      { from: 18, place: 'tavern_table2', activity: 'tavern' },
      { from: 21, place: 'in:house_sancho', activity: 'sleep' },
    ],
    weapon: 'axe', bravery: 0.6, health: 100, relations: { mendo: 'amigo' },
    barks: ['Esa brecha nos va a costar un disgusto.', 'Madera de roble, la mejor.'],
  },
  {
    id: 'lucia', name: 'Lucía', role: 'Comerciante', profession: 'merchant', village: 'robledo', home: 'house_lucia', faction: 'villager',
    appearance: { skin: skin[2], tunic: 0x2e4a5a, pants: 0x3a3030, hair: 0x6a3a1a, beard: false, female: true, build: 0.94 },
    schedule: [
      { from: 7.5, place: 'market_stall', activity: 'sell' },
      { from: 13, place: 'in:house_lucia', activity: 'home' },
      { from: 15, place: 'market_stall', activity: 'sell' },
      { from: 19.5, place: 'in:house_lucia', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.2, health: 70, relations: { ines: 'amiga' }, trader: true,
    barks: ['¡Pan, manzanas, antorchas!', 'Las caravanas de Almenara ya no llegan como antes.'],
  },
  {
    id: 'mendo', name: 'Mendo', role: 'Capitán de la guardia', profession: 'guard', village: 'robledo', home: 'house_mendo', faction: 'guard',
    appearance: { skin: skin[1], tunic: 0x7a2a22, pants: 0x3a3a3a, hair: 0x2a2218, beard: true, helmet: true, build: 1.08 },
    schedule: [
      { from: 6.5, place: 'gate_n', activity: 'guard' },
      { from: 10, place: 'patrol_1', activity: 'patrol' },
      { from: 13, place: 'plaza', activity: 'eat' },
      { from: 14, place: 'patrol_2', activity: 'patrol' },
      { from: 19, place: 'gate_n', activity: 'guard' },
      { from: 22.5, place: 'in:house_mendo', activity: 'sleep' },
    ],
    weapon: 'sword', shield: true, bravery: 1, health: 140, relations: { bartolome: 'cuñado' },
    barks: ['Ojos abiertos.', 'Los Cuervos andan cerca, lo huelo.'],
  },
  {
    id: 'pedro', name: 'Pedro', role: 'Guardia (vigía nocturno)', profession: 'guard', village: 'robledo', home: 'house_pedro', faction: 'guard',
    appearance: { skin: skin[3], tunic: 0x7a2a22, pants: 0x3a3226, hair: 0x1a1410, beard: false, helmet: true, build: 1.0 },
    schedule: [
      { from: 6.5, place: 'in:house_pedro', activity: 'sleep' },
      { from: 16, place: 'plaza', activity: 'social' },
      { from: 18.5, place: 'tower_top', activity: 'guard' },
    ],
    weapon: 'spear', bravery: 0.9, health: 110, relations: { mendo: 'superior' },
    barks: ['Noche tranquila... por ahora.', 'Desde la torre se ve hasta el bosque.'],
  },
  {
    id: 'teresa', name: 'Teresa', role: 'Agricultora', profession: 'farmer', village: 'robledo', home: 'house_teresa', faction: 'villager',
    appearance: { skin: skin[0], tunic: 0x6a6a4a, pants: 0x4a3a2a, hair: 0x4a2a1a, beard: false, female: true, build: 0.98 },
    schedule: [
      { from: 6, place: 'field_0', activity: 'farm' },
      { from: 10, place: 'field_1', activity: 'farm' },
      { from: 12, place: 'in:house_teresa', activity: 'eat' },
      { from: 14, place: 'field_2', activity: 'farm' },
      { from: 18.5, place: 'well', activity: 'work' },
      { from: 19.2, place: 'in:house_teresa', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.4, health: 80, relations: {},
    barks: ['Si no llueve pronto, poca cosecha.', 'Los jabalíes me destrozan el trigo.'],
  },
  {
    id: 'ferran', name: 'Maese Ferrán', role: 'Médico', profession: 'physician', village: 'robledo', home: 'house_ferran', faction: 'villager',
    appearance: { skin: skin[2], tunic: 0x3a2a4a, pants: 0x2a2a2a, hair: 0xb0aaa0, beard: true, robe: true, build: 0.95 },
    schedule: [
      { from: 8, place: 'door:house_ferran', activity: 'work' },
      { from: 13, place: 'in:house_ferran', activity: 'eat' },
      { from: 15, place: 'door:house_ferran', activity: 'work' },
      { from: 18.5, place: 'tavern_table2', activity: 'tavern' },
      { from: 21, place: 'in:house_ferran', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.2, health: 70, relations: {},
    barks: ['Lávate las heridas con vino, no con agua de charca.', 'Sangría y reposo.'],
  },
];

/** Entrada de agenda vigente para una hora (con vuelta de medianoche). */
export function scheduleAt(s: ScheduleEntry[], hour: number): ScheduleEntry {
  let cur = s[s.length - 1];
  for (const e of s) if (hour >= e.from) cur = e;
  return cur;
}
