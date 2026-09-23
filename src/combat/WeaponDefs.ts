/**
 * Definiciones de armas. Los tiempos (preparación/golpe/recuperación) son
 * lo que da "peso" al combate: un ataque fuerte compromete al atacante.
 */
export type DamageType = 'slash' | 'blunt' | 'pierce';
export type WeaponId = 'fists' | 'knife' | 'sword' | 'axe' | 'club' | 'spear' | 'bow';

export interface MeleeTiming {
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  stamina: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: 'melee' | 'bow';
  type: DamageType;
  twoHanded: boolean;
  reach: number;
  light: MeleeTiming;
  heavy: MeleeTiming;
  /** Fracción del daño que absorbe al bloquear (0..1). */
  blockEff: number;
  /** Stamina por punto de daño bloqueado. */
  blockCost: number;
  /** Multiplicador de daño contra árboles. */
  chop: number;
  /** Modelo en mano (id de ModelLibrary). */
  model: string;
  /** Aturdimiento que causa el golpe fuerte (s). */
  stagger: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: {
    id: 'fists', name: 'Puños', kind: 'melee', type: 'blunt', twoHanded: false, reach: 1.35,
    light: { windup: 0.16, active: 0.1, recovery: 0.22, damage: 5, stamina: 6 },
    heavy: { windup: 0.42, active: 0.12, recovery: 0.35, damage: 11, stamina: 14 },
    blockEff: 0.3, blockCost: 1.2, chop: 0.05, model: '', stagger: 0.25,
  },
  knife: {
    id: 'knife', name: 'Cuchillo', kind: 'melee', type: 'pierce', twoHanded: false, reach: 1.5,
    light: { windup: 0.16, active: 0.1, recovery: 0.24, damage: 13, stamina: 7 },
    heavy: { windup: 0.38, active: 0.12, recovery: 0.4, damage: 26, stamina: 15 },
    blockEff: 0.35, blockCost: 1.1, chop: 0.15, model: 'knife', stagger: 0.2,
  },
  sword: {
    id: 'sword', name: 'Espada', kind: 'melee', type: 'slash', twoHanded: false, reach: 2.15,
    light: { windup: 0.3, active: 0.16, recovery: 0.36, damage: 24, stamina: 14 },
    heavy: { windup: 0.62, active: 0.2, recovery: 0.55, damage: 44, stamina: 28 },
    blockEff: 0.8, blockCost: 0.6, chop: 0.3, model: 'sword', stagger: 0.55,
  },
  axe: {
    id: 'axe', name: 'Hacha', kind: 'melee', type: 'slash', twoHanded: false, reach: 1.9,
    light: { windup: 0.38, active: 0.16, recovery: 0.42, damage: 26, stamina: 16 },
    heavy: { windup: 0.72, active: 0.2, recovery: 0.6, damage: 50, stamina: 32 },
    blockEff: 0.5, blockCost: 0.9, chop: 1, model: 'axe', stagger: 0.7,
  },
  club: {
    id: 'club', name: 'Maza', kind: 'melee', type: 'blunt', twoHanded: false, reach: 1.85,
    light: { windup: 0.36, active: 0.16, recovery: 0.4, damage: 21, stamina: 15 },
    heavy: { windup: 0.7, active: 0.2, recovery: 0.58, damage: 40, stamina: 30 },
    blockEff: 0.45, blockCost: 1.0, chop: 0.2, model: 'axe', stagger: 0.9,
  },
  spear: {
    id: 'spear', name: 'Lanza', kind: 'melee', type: 'pierce', twoHanded: true, reach: 2.8,
    light: { windup: 0.3, active: 0.14, recovery: 0.38, damage: 22, stamina: 13 },
    heavy: { windup: 0.6, active: 0.18, recovery: 0.55, damage: 40, stamina: 26 },
    blockEff: 0.55, blockCost: 0.9, chop: 0.1, model: 'sword', stagger: 0.45,
  },
  bow: {
    id: 'bow', name: 'Arco', kind: 'bow', type: 'pierce', twoHanded: true, reach: 1.2,
    light: { windup: 0.2, active: 0.1, recovery: 0.3, damage: 4, stamina: 6 },
    heavy: { windup: 0.4, active: 0.1, recovery: 0.4, damage: 8, stamina: 10 },
    blockEff: 0.15, blockCost: 1.5, chop: 0, model: 'bow', stagger: 0.2,
  },
};

/** Arco: tiempo de tensado completo y daño máximo de flecha. */
export const BOW = { drawTime: 0.95, holdStamina: 7, arrowDamage: 48, arrowSpeed: 55, minDraw: 0.25 };

/** Multiplicadores de daño por zona (daño localizado). */
export const HIT_ZONES = { head: 2.0, torso: 1.0, arm: 0.6, leg: 0.65 } as const;
export type HitZone = keyof typeof HIT_ZONES;

/** Reducción de daño por armadura y tipo. */
export interface ArmorValues { slash: number; blunt: number; pierce: number }

export function applyArmor(dmg: number, type: DamageType, armor: ArmorValues): number {
  return dmg * (1 - Math.min(0.8, armor[type]));
}
