/**
 * Datos del mapa del Valle de Arnós. Todo lo que define "dónde está qué"
 * vive aquí, sin dependencias de render. Norte = -Z, Este = +X.
 *
 * Vertical slice: Robledo (parcial), casa del jugador, bosque, arroyo,
 * Cueva del Cuervo y campamento de Los Cuervos.
 */

export const WORLD_HALF = 1024;
export const WORLD_SEED = 1492;

export type P2 = readonly [number, number];

export interface RoadDef {
  id: string;
  width: number;
  points: P2[];
  kind: 'road' | 'path' | 'trail';
}

export type BuildingStyle = 'stone' | 'timber' | 'wattle' | 'shed' | 'plank';

export interface BuildingDef {
  id: string;
  name: string;
  village: string;
  x: number;
  z: number;
  /** Punto hacia el que mira la fachada (puerta). */
  faceX: number;
  faceZ: number;
  w: number; // ancho (fachada)
  d: number; // fondo
  wallH: number;
  style: BuildingStyle;
  roof: 'thatch' | 'tile' | 'plank';
  /** Se puede entrar (puerta interactuable). */
  enterable: boolean;
  /** Frente abierto (cobertizo, herrería). */
  openFront?: boolean;
  hasChimney?: boolean;
  tower?: boolean;
  maxHealth: number;
}

export interface VillageDef {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  /** Radio de aplanado del terreno. */
  flatRadius: number;
}

export interface POI {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  discoverable: boolean;
}

export const VILLAGES: VillageDef[] = [
  { id: 'robledo', name: 'Robledo', x: 0, z: 0, radius: 80, flatRadius: 70 },
];

const B = (
  id: string, name: string, x: number, z: number, face: P2, w: number, d: number,
  style: BuildingStyle, roof: BuildingDef['roof'], extra: Partial<BuildingDef> = {},
): BuildingDef => ({
  id, name, village: 'robledo', x, z, faceX: face[0], faceZ: face[1], w, d,
  wallH: extra.wallH ?? 3.2, style, roof, enterable: false, maxHealth: 100, ...extra,
});

const PLAZA: P2 = [0, 0];

export const BUILDINGS: BuildingDef[] = [
  B('player_hut', 'Tu choza', -58, 18, [-40, 14], 5.5, 4.5, 'wattle', 'thatch', { enterable: true, hasChimney: true, wallH: 2.7 }),
  B('church', 'Iglesia de San Millán', -24, -24, PLAZA, 9, 16, 'stone', 'tile', { enterable: true, wallH: 6.5, tower: true, maxHealth: 300 }),
  B('parish_house', 'Casa parroquial', -40, -30, [-24, -12], 5, 5, 'stone', 'tile', { hasChimney: true }),
  B('tavern', 'Taberna El Jabalí Cojo', 21, -17, PLAZA, 11, 8, 'timber', 'tile', { enterable: true, hasChimney: true, wallH: 3.6, maxHealth: 180 }),
  B('smithy', 'Herrería', 23, 13, PLAZA, 7, 6, 'shed', 'plank', { openFront: true, enterable: true, hasChimney: true, maxHealth: 120 }),
  B('house_bartolome', 'Casa de Bartolomé', 36, 20, [20, 6], 6, 5, 'timber', 'thatch', { hasChimney: true }),
  B('carpentry', 'Carpintería de Sancho', -32, 4, PLAZA, 7, 6, 'shed', 'plank', { openFront: true, enterable: true }),
  B('house_sancho', 'Casa de Sancho', -44, -8, [-28, -2], 6, 5, 'wattle', 'thatch', { hasChimney: true }),
  B('house_gil', 'Casa de Gil', -46, 32, [-30, 20], 5.5, 5, 'wattle', 'thatch', { hasChimney: true }),
  B('house_lucia', 'Casa de Lucía', -12, 32, PLAZA, 6, 5, 'timber', 'tile', { hasChimney: true }),
  B('house_teresa', 'Casa de Teresa', 28, 38, [14, 20], 7, 5, 'wattle', 'thatch', { hasChimney: true }),
  B('house_mendo', 'Casa de Mendo', 10, -38, PLAZA, 6, 5, 'stone', 'tile', { hasChimney: true }),
  B('house_pedro', 'Casa de Pedro', -8, -44, [0, -20], 5, 4.5, 'wattle', 'thatch', { hasChimney: true }),
  B('granary', 'Granero', 42, -8, [20, -4], 8, 11, 'plank', 'thatch', { wallH: 4.2, maxHealth: 150 }),
  B('house_ferran', 'Casa del médico', 8, 30, PLAZA, 6, 5, 'timber', 'tile', { hasChimney: true }),
  B('stable', 'Establo', 32, -34, [16, -20], 9, 6, 'shed', 'thatch', { openFront: true, enterable: true }),
];

/** Pozo de la plaza. */
export const WELL = { x: 4, z: 3 };
/** Puestos del mercado. */
export const MARKET_STALLS: { x: number; z: number; rot: number }[] = [
  { x: -8, z: 10, rot: 0.3 },
  { x: 2, z: 13, rot: -0.1 },
  { x: -14, z: 4, rot: 1.2 },
];

/** Empalizada: arco norte (de oeste a este pasando por el norte). */
export const PALISADE = {
  center: [0, 0] as P2,
  radius: 64,
  /** Ángulos (rad, atan2(z,x)) de inicio y fin; recorre el norte (z<0). */
  from: Math.PI,
  to: 2 * Math.PI,
  gateAngle: -Math.PI / 2 + 2 * Math.PI, // norte
  gateWidth: 5,
  breachAngle: -Math.PI / 4 + 2 * Math.PI, // noreste
  breachWidth: 7,
};

export const WATCHTOWER = { x: -9, z: -56, height: 8 };

export const ROADS: RoadDef[] = [
  { id: 'north_road', width: 4.5, kind: 'road', points: [[0, -20], [0, -64], [2, -120], [-18, -220], [-12, -400], [10, -700]] },
  { id: 'south_road', width: 4.5, kind: 'road', points: [[0, 18], [0, 66], [10, 150], [60, 300], [120, 600]] },
  { id: 'forest_path', width: 2.6, kind: 'path', points: [[-20, 8], [-42, 14], [-58, 22], [-78, 20], [-95, 15], [-120, 4], [-150, -20], [-176, -70], [-184, -112], [-188, -130]] },
  { id: 'bandit_trail', width: 1.8, kind: 'trail', points: [[170, -280], [128, -205], [70, -140], [26, -106], [3, -110]] },
  { id: 'field_path', width: 2.2, kind: 'path', points: [[4, 40], [30, 62], [52, 90]] },
];

/** Arroyo del Robledo (afluente del Arnós). */
export const STREAM = {
  width: 5,
  depth: 1.3,
  points: [[-112, -520], [-104, -300], [-98, -160], [-92, -60], [-95, 15], [-88, 120], [-102, 300], [-96, 560]] as P2[],
};

export const BRIDGES = [{ id: 'bridge_forest', x: -95, z: 15, rot: Math.atan2(15 - 4, -95 + 120) + Math.PI / 2, length: 11, width: 3 }];

export const FIELDS = [{ id: 'fields_robledo', x: 55, z: 100, w: 60, d: 46, rot: 0.15 }];

/** Colina rocosa con la Cueva del Cuervo. */
export const CAVE_HILL = { x: -250, z: -130, radius: 58, height: 26, cliff: 14 };

/** Recorrido de la cueva: boca → túnel → cámara. y relativo al suelo de la boca. */
export const CAVE = {
  id: 'cave_crow',
  name: 'Cueva del Cuervo',
  mouth: { x: -190.5, z: -130 },
  path: [
    { x: -190.5, z: -130, dy: 0, r: 2.9 },
    { x: -197, z: -130.5, dy: -0.3, r: 2.6 },
    { x: -206, z: -131.5, dy: -1.0, r: 2.4 },
    { x: -218, z: -129, dy: -2.4, r: 2.3 },
    { x: -229, z: -125, dy: -3.6, r: 2.6 },
    { x: -240, z: -122, dy: -4.4, r: 4.8 },
    { x: -250, z: -124, dy: -4.6, r: 5.2 },
    { x: -256, z: -132, dy: -4.8, r: 3.2 },
    { x: -254, z: -142, dy: -5.2, r: 2.2 },
    { x: -247, z: -148, dy: -5.4, r: 2.0 },
  ],
  /** Hueco del terreno sobre la boca (el túnel lo sustituye). */
  hole: { x0: -203, x1: -189.8, z0: -133.4, z1: -127.1 },
};

export const BANDIT_CAMP = { id: 'bandit_camp', name: 'Campamento de Los Cuervos', x: 170, z: -280, radius: 22 };

/** Punto de reunión de atacantes antes de asaltar Robledo. */
export const RAID_STAGING = { x: 30, z: -118 };

export const DEER_MEADOW = { x: -165, z: -45, radius: 28 };
export const WOLF_DEN = { x: -205, z: -175, radius: 20 };
/** Arboleda junto a la brecha (misión de la madera). */
export const GROVE_NE = { x: 82, z: -78, radius: 20 };

export const POIS: POI[] = [
  { id: 'robledo', name: 'Robledo', x: 0, z: 0, radius: 80, discoverable: true },
  { id: 'cave_crow', name: 'Cueva del Cuervo', x: CAVE.mouth.x, z: CAVE.mouth.z, radius: 14, discoverable: true },
  { id: 'bandit_camp', name: 'Campamento de Los Cuervos', x: BANDIT_CAMP.x, z: BANDIT_CAMP.z, radius: 40, discoverable: true },
  { id: 'deer_meadow', name: 'Prado de los ciervos', x: DEER_MEADOW.x, z: DEER_MEADOW.z, radius: 30, discoverable: true },
  { id: 'forest_bridge', name: 'Puente del arroyo', x: -95, z: 15, radius: 10, discoverable: true },
];

/**
 * Mar del Este: la costa corre de norte a sur al este de Robledo, con
 * playa, fondo que se hunde mar adentro e islas que se pueden explorar.
 */
export const SEA = {
  level: 5,
  islands: [
    { id: 'isla_gaviotas', name: 'Isla de las Gaviotas', x: 252, z: -34, r: 58, peak: 17 },
    { id: 'penon', name: 'El Peñón', x: 336, z: 150, r: 28, peak: 24 },
    { id: 'islote_naufrago', name: 'Islote del Náufrago', x: 206, z: 196, r: 17, peak: 4.5 },
  ],
};

/** Muelle de Robledo (el embarcadero). */
export const PIER = { x0: 0, z: 8, length: 34, width: 3.2 };

/** Parcela del jugador: descampado propio para construir. */
export const PLAYER_PLOT = { x: -76, z: 50, size: 21 };

export const PLAYER_START = { x: -59.2, z: 18.4, yaw: -Math.PI * 0.5 };
