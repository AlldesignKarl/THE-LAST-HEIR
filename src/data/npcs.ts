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
  profession: 'hunter' | 'smith' | 'innkeeper' | 'priest' | 'carpenter' | 'merchant' | 'guard' | 'farmer' | 'physician' | 'fisher' | 'baker' | 'boatwright' | 'cooper' | 'widow';
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
  // ---------------- Ampliación del pueblo: puerto y barrios nuevos
  {
    id: 'nuno', name: 'Nuño', role: 'Pescador', profession: 'fisher', village: 'robledo', home: 'fisher_1', faction: 'villager',
    appearance: { skin: skin[3], tunic: 0x3e4a52, pants: 0x3a3226, hair: 0x2a2420, beard: true, build: 1.05 },
    schedule: [
      { from: 5, place: 'door:fisher_1', activity: 'wander' },
      { from: 5.6, place: 'pier_end', activity: 'work' },
      { from: 11, place: 'fish_rack_work', activity: 'work' },
      { from: 13, place: 'tavern_table', activity: 'eat' },
      { from: 14.5, place: 'pier_end', activity: 'work' },
      { from: 19.5, place: 'in:fisher_1', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.6, health: 95, relations: { aldonza: 'esposa' }, trader: true,
    barks: ['Con este levante las sardinas se van a la isla.', 'El Peñón tiene cuevas donde anidan los cormoranes.'],
  },
  {
    id: 'aldonza', name: 'Aldonza', role: 'Redera', profession: 'fisher', village: 'robledo', home: 'fisher_2', faction: 'villager',
    appearance: { skin: skin[0], tunic: 0x6a4a3a, pants: 0x3a2a22, hair: 0x3a2618, beard: false, female: true, build: 0.96 },
    schedule: [
      { from: 6.5, place: 'beach_nets', activity: 'work' },
      { from: 12, place: 'in:fisher_2', activity: 'eat' },
      { from: 13.5, place: 'beach_nets2', activity: 'work' },
      { from: 17.5, place: 'well', activity: 'social' },
      { from: 19, place: 'in:fisher_2', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.3, health: 75, relations: { nuno: 'marido' },
    barks: ['Una red rota es una cena perdida.', 'Mira dónde pisas, que las redes muerden.'],
  },
  {
    id: 'gonzalo', name: 'Gonzalo el Calafate', role: 'Carpintero de ribera', profession: 'boatwright', village: 'robledo', home: 'fisher_3', faction: 'villager',
    appearance: { skin: skin[1], tunic: 0x5a5040, pants: 0x2e2a26, hair: 0x6a6258, beard: true, apron: true, build: 1.08 },
    schedule: [
      { from: 6.5, place: 'boat_shed_work', activity: 'work' },
      { from: 12.5, place: 'tavern_table2', activity: 'eat' },
      { from: 13.5, place: 'boat_shed_work', activity: 'work' },
      { from: 18.5, place: 'pier_mid', activity: 'social' },
      { from: 20.5, place: 'in:fisher_3', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.5, health: 90, relations: {}, trader: true,
    barks: ['Estopa y brea: así no entra el agua.', 'Una barca bien calafateada dura veinte años.'],
  },
  {
    id: 'mateo', name: 'Mateo', role: 'Patrón de barcas', profession: 'fisher', village: 'robledo', home: 'harbor_house', faction: 'villager',
    appearance: { skin: skin[3], tunic: 0x2e3a4a, pants: 0x2a2a2a, hair: 0x1a1612, beard: true, hood: true, build: 1.1 },
    schedule: [
      { from: 6, place: 'pier_mid', activity: 'work' },
      { from: 12, place: 'in:harbor_house', activity: 'eat' },
      { from: 13, place: 'pier_end2', activity: 'work' },
      { from: 18, place: 'tavern_table', activity: 'tavern' },
      { from: 22, place: 'in:harbor_house', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.7, health: 100, relations: { nuno: 'cuñado' },
    barks: ['Nadie sale al mar sin preguntarme a mí.', 'Las islas tienen dueño: el que llega primero.'],
  },
  {
    id: 'elvira', name: 'Elvira', role: 'Hornera', profession: 'baker', village: 'robledo', home: 'bakery', faction: 'villager',
    appearance: { skin: skin[2], tunic: 0x8a7050, pants: 0x4a3a30, hair: 0x5a3a20, beard: false, female: true, apron: true, build: 1.02 },
    schedule: [
      { from: 4.5, place: 'bakery_oven', activity: 'work' },
      { from: 9, place: 'market_stall', activity: 'sell' },
      { from: 13, place: 'bakery_oven', activity: 'work' },
      { from: 18, place: 'church_altar', activity: 'pray' },
      { from: 19, place: 'in:bakery', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.3, health: 75, relations: {}, trader: true,
    barks: ['¡Pan caliente, recién sacado!', 'El horno no espera a nadie.'],
  },
  {
    id: 'urraca', name: 'Urraca', role: 'Viuda', profession: 'widow', village: 'robledo', home: 'house_n3', faction: 'villager',
    appearance: { skin: skin[2], tunic: 0x2a2626, pants: 0x2a2626, hair: 0xa8a098, beard: false, female: true, robe: true, build: 0.9 },
    schedule: [
      { from: 7, place: 'church_altar', activity: 'pray' },
      { from: 9, place: 'well', activity: 'social' },
      { from: 11, place: 'plaza_bench', activity: 'social' },
      { from: 13, place: 'in:house_n3', activity: 'eat' },
      { from: 16, place: 'plaza', activity: 'social' },
      { from: 19, place: 'in:house_n3', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.1, health: 60, relations: { anselmo: 'confesor' },
    barks: ['En mis tiempos los bandidos no se atrevían a tanto.', 'Mi Lope se fue al mar y no volvió.'],
  },
  {
    id: 'diego', name: 'Diego Aranda', role: 'Labrador', profession: 'farmer', village: 'robledo', home: 'house_n1', faction: 'villager',
    appearance: { skin: skin[1], tunic: 0x5a5a3a, pants: 0x3a3226, hair: 0x3a2a1a, beard: false, build: 1.0 },
    schedule: [
      { from: 5.5, place: 'field_3', activity: 'farm' },
      { from: 12, place: 'in:house_n1', activity: 'eat' },
      { from: 13.5, place: 'field_1', activity: 'farm' },
      { from: 18.5, place: 'tavern_table2', activity: 'tavern' },
      { from: 21, place: 'in:house_n1', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.5, health: 90, relations: { teresa: 'vecina' },
    barks: ['La paja de este año es buena para techar.', 'Si quieres paja para tu tejado, págamela bien.'],
    trader: true,
  },
  {
    id: 'fortun', name: 'Fortún', role: 'Tonelero', profession: 'cooper', village: 'robledo', home: 'house_n2', faction: 'villager',
    appearance: { skin: skin[0], tunic: 0x4a3a2a, pants: 0x2a2622, hair: 0x2a2018, beard: true, apron: true, build: 1.04 },
    schedule: [
      { from: 7, place: 'salt_work', activity: 'work' },
      { from: 12.5, place: 'in:house_n2', activity: 'eat' },
      { from: 14, place: 'salt_work', activity: 'work' },
      { from: 18, place: 'tavern_table', activity: 'tavern' },
      { from: 21.5, place: 'in:house_n2', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.4, health: 85, relations: {},
    barks: ['Duelas de roble y aros de hierro, como manda el oficio.', 'Sin barriles no hay salazón.'],
  },
  {
    id: 'blasco', name: 'Blasco', role: 'Herrador', profession: 'smith', village: 'robledo', home: 'house_n4', faction: 'villager',
    appearance: { skin: skin[3], tunic: 0x4a4038, pants: 0x2a2622, hair: 0x1a1410, beard: true, build: 1.1 },
    schedule: [
      { from: 7, place: 'stable_work', activity: 'work' },
      { from: 12, place: 'in:house_n4', activity: 'eat' },
      { from: 13, place: 'stable_work', activity: 'work' },
      { from: 18, place: 'plaza', activity: 'social' },
      { from: 21, place: 'in:house_n4', activity: 'sleep' },
    ],
    weapon: 'club', bravery: 0.75, health: 105, relations: { bartolome: 'compadre' },
    barks: ['Un caballo sin herrar no llega ni a Valdeolmo.', 'Si vienen los Cuervos, que vengan.'],
  },
  // ----- Vecinos del arrabal sur, del puerto y de paso.
  {
    id: 'juan_pardo', name: 'Juan Pardo', role: 'Labrador', profession: 'farmer', village: 'robledo', home: 'house_s1', faction: 'villager',
    appearance: { skin: skin[1], tunic: 0x6a5a3a, pants: 0x3a3226, hair: 0x4a3a28, beard: true, build: 1.05 },
    schedule: [
      { from: 5.5, place: 'field_0', activity: 'farm' },
      { from: 12, place: 'in:house_s1', activity: 'eat' },
      { from: 13.5, place: 'field_2', activity: 'farm' },
      { from: 18.5, place: 'tavern_table2', activity: 'tavern' },
      { from: 21, place: 'in:house_s1', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.55, health: 95, relations: { mencia: 'esposa', diego: 'compadre' },
    barks: ['Este año la cebada viene flaca.', 'Mi Mencía lava más ropa que la de todo el pueblo.'],
  },
  {
    id: 'mencia', name: 'Mencía Pardo', role: 'Lavandera', profession: 'farmer', village: 'robledo', home: 'house_s1', faction: 'villager',
    appearance: { skin: skin[2], tunic: 0x6a6a7a, pants: 0x3a3a40, hair: 0x6a4a2a, beard: false, female: true, build: 0.97 },
    schedule: [
      { from: 6.5, place: 'well', activity: 'work' },
      { from: 8, place: 'washing_spot', activity: 'work' },
      { from: 12, place: 'in:house_s1', activity: 'eat' },
      { from: 14, place: 'washing_spot', activity: 'work' },
      { from: 17, place: 'south_lane', activity: 'social' },
      { from: 20, place: 'in:house_s1', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.2, health: 70, relations: { juan_pardo: 'esposo', urraca: 'comadre' },
    barks: ['El agua del arroyo baja helada.', 'Con ceniza y agua, la ropa queda como nueva.'],
  },
  {
    id: 'simon', name: 'Simón', role: 'Cestero', profession: 'carpenter', village: 'robledo', home: 'house_s2', faction: 'villager',
    appearance: { skin: skin[0], tunic: 0x5a6a4a, pants: 0x2e2a26, hair: 0x8a8278, beard: true, build: 0.94 },
    schedule: [
      { from: 7, place: 'door:house_s2', activity: 'work' },
      { from: 9.5, place: 'washing_spot2', activity: 'work' },
      { from: 12.5, place: 'in:house_s2', activity: 'eat' },
      { from: 14, place: 'door:house_s2', activity: 'work' },
      { from: 17, place: 'plaza_bench', activity: 'social' },
      { from: 19, place: 'tavern_table', activity: 'tavern' },
      { from: 21.5, place: 'in:house_s2', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.3, health: 75, relations: { lucia: 'le vende cestos' }, trader: true,
    barks: ['El mimbre bueno crece junto al agua.', 'Un cesto bien hecho aguanta una arroba de pescado.'],
  },
  {
    id: 'martin_mozo', name: 'Martín el Mozo', role: 'Leñador', profession: 'carpenter', village: 'robledo', home: 'house_s3', faction: 'villager',
    appearance: { skin: skin[1], tunic: 0x6a3a2a, pants: 0x3a3226, hair: 0x2a1a10, beard: false, build: 1.08 },
    schedule: [
      { from: 6, place: 'woodcut_n', activity: 'work' },
      { from: 12, place: 'plaza_bench', activity: 'eat' },
      { from: 13, place: 'woodcut_n', activity: 'work' },
      { from: 17, place: 'woodpile_zone', activity: 'work' },
      { from: 19, place: 'tavern_table2', activity: 'tavern' },
      { from: 22, place: 'in:house_s3', activity: 'sleep' },
    ],
    weapon: 'axe', bravery: 0.85, health: 115, relations: { sancho: 'le compra la madera', gil: 'amigo' },
    barks: ['Un roble así da leña para todo el invierno.', 'El hacha, bien afilada, o te cansas el doble.'],
  },
  {
    id: 'lope', name: 'Lope Ibáñez', role: 'Pastor', profession: 'farmer', village: 'robledo', home: 'house_s4', faction: 'villager',
    appearance: { skin: skin[3], tunic: 0x5a4a3a, pants: 0x2a2622, hair: 0x3a3028, beard: true, hood: true, build: 1.0 },
    schedule: [
      { from: 6, place: 'pasture', activity: 'work' },
      { from: 12.5, place: 'in:house_s4', activity: 'eat' },
      { from: 13.5, place: 'pasture', activity: 'work' },
      { from: 18.5, place: 'plaza', activity: 'social' },
      { from: 20.5, place: 'in:house_s4', activity: 'sleep' },
    ],
    weapon: 'club', bravery: 0.7, health: 95, relations: { catalina: 'esposa', gil: 'le avisa de los lobos' },
    barks: ['Anoche los lobos rondaron el aprisco.', 'La lana de este año es buena.'],
  },
  {
    id: 'catalina', name: 'Catalina Ibáñez', role: 'Tejedora', profession: 'merchant', village: 'robledo', home: 'house_s4', faction: 'villager',
    appearance: { skin: skin[2], tunic: 0x7a5a6a, pants: 0x4a3a40, hair: 0x2a1a12, beard: false, female: true, apron: true, build: 0.96 },
    schedule: [
      { from: 7.5, place: 'door:house_s4', activity: 'work' },
      { from: 10.5, place: 'well', activity: 'social' },
      { from: 12, place: 'in:house_s4', activity: 'eat' },
      { from: 14, place: 'market_stall2', activity: 'sell' },
      { from: 18, place: 'church_altar', activity: 'pray' },
      { from: 19.5, place: 'in:house_s4', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.25, health: 70, relations: { lope: 'esposo', lucia: 'rival en el mercado' }, trader: true,
    barks: ['Paño de lana, bien tupido. Toca, toca.', 'El telar no descansa ni en domingo... Dios me perdone.'],
  },
  {
    id: 'inigo', name: 'Íñigo', role: 'Guardia', profession: 'guard', village: 'robledo', home: 'house_pedro', faction: 'guard',
    appearance: { skin: skin[0], tunic: 0x7a2a22, pants: 0x3a3a3a, hair: 0x5a3a20, beard: true, helmet: true, build: 1.06 },
    schedule: [
      { from: 6, place: 'patrol_3', activity: 'patrol' },
      { from: 12.5, place: 'tavern_table2', activity: 'eat' },
      { from: 13.5, place: 'gate_n_out', activity: 'guard' },
      { from: 18.5, place: 'patrol_4', activity: 'patrol' },
      { from: 22, place: 'in:house_pedro', activity: 'sleep' },
    ],
    weapon: 'sword', shield: true, bravery: 0.95, health: 125, relations: { pedro: 'hermano', mendo: 'capitán' },
    barks: ['Circulad.', 'Nada de líos en Robledo.'],
  },
  {
    id: 'vasco', name: 'Vasco', role: 'Pescador', profession: 'fisher', village: 'robledo', home: 'fisher_1', faction: 'villager',
    appearance: { skin: skin[3], tunic: 0x3a4a5a, pants: 0x2a2a2a, hair: 0x2a2018, beard: false, build: 1.02 },
    schedule: [
      { from: 5, place: 'beach_nets2', activity: 'work' },
      { from: 9, place: 'pier_end', activity: 'work' },
      { from: 12.5, place: 'in:fisher_1', activity: 'eat' },
      { from: 14, place: 'fish_rack_work', activity: 'work' },
      { from: 18, place: 'tavern_table', activity: 'tavern' },
      { from: 21.5, place: 'in:fisher_1', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.6, health: 95, relations: { nuno: 'padre', aldonza: 'prima' },
    barks: ['Hoy el mar está picado.', 'Mi padre dice que huele las sardinas.'],
  },
  {
    id: 'beatriz', name: 'Beatriz', role: 'Moza de la taberna', profession: 'innkeeper', village: 'robledo', home: 'tavern', faction: 'villager',
    appearance: { skin: skin[0], tunic: 0x6a4a2a, pants: 0x4a3a30, hair: 0x8a5a2a, beard: false, female: true, apron: true, build: 0.93 },
    schedule: [
      { from: 1.5, place: 'in:tavern', activity: 'sleep' },
      { from: 7.5, place: 'woodpile_zone', activity: 'work' },
      { from: 9, place: 'tavern_serve', activity: 'sell' },
    ],
    weapon: null, bravery: 0.3, health: 65, relations: { ines: 'ama' },
    barks: ['¡Voy, voy!', 'Aquí se paga antes de beber.'],
  },
  {
    id: 'ramiro', name: 'Ramiro el Buhonero', role: 'Buhonero', profession: 'merchant', village: 'robledo', home: 'tavern', faction: 'villager',
    appearance: { skin: skin[1], tunic: 0x4a5a6a, pants: 0x3a3226, hair: 0x6a5a48, beard: true, build: 1.0 },
    schedule: [
      { from: 7, place: 'plaza_cart', activity: 'sell' },
      { from: 13, place: 'tavern_table', activity: 'eat' },
      { from: 14, place: 'plaza_cart', activity: 'sell' },
      { from: 19, place: 'tavern_table2', activity: 'tavern' },
      { from: 23, place: 'in:tavern', activity: 'sleep' },
    ],
    weapon: null, bravery: 0.35, health: 80, relations: { lucia: 'competencia' }, trader: true,
    barks: ['¡Agujas, cintas, peines de hueso!', 'Traigo noticias de Valdeolmo... por una moneda.'],
  },
];

/** Entrada de agenda vigente para una hora (con vuelta de medianoche). */
export function scheduleAt(s: ScheduleEntry[], hour: number): ScheduleEntry {
  let cur = s[s.length - 1];
  for (const e of s) if (hour >= e.from) cur = e;
  return cur;
}
