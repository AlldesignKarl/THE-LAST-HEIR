/**
 * Base de datos de objetos. Precios en maravedíes (mrv).
 * `heavy`: no cabe en el inventario, solo se transporta físicamente.
 */
import type { WeaponId } from '../combat/WeaponDefs';

export type ItemCategory =
  | 'weapon' | 'tool' | 'ammo' | 'food' | 'drink' | 'resource' | 'quest' | 'document' | 'light' | 'armor' | 'misc';

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  category: ItemCategory;
  weight: number;
  value: number;
  stack: number;
  model: string;
  heavy?: boolean;
  food?: { hunger: number; thirst: number; warmth?: number; health?: number };
  /** Se transforma al cocinar. */
  cooksTo?: string;
  weapon?: WeaponId;
  /** Documento legible. */
  doc?: string;
  /** Se equipa en la mano izquierda (antorcha, escudo). */
  offhand?: 'torch' | 'shield';
  armor?: { slot: 'head' | 'body'; slash: number; blunt: number; pierce: number; warmth: number };
  questItem?: boolean;
  /** Recipiente reutilizable (odre, cubo). */
  container?: { fullId?: string; emptyId?: string };
}

const I = (d: ItemDef): ItemDef => d;

export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  I({ id: 'sword', name: 'Espada de armas', desc: 'Hoja recta de un solo filo desgastado. Equilibrada y fiable.', category: 'weapon', weight: 1.4, value: 160, stack: 1, model: 'sword', weapon: 'sword' }),
  I({ id: 'axe', name: 'Hacha de leñador', desc: 'Sirve para talar y, si no queda otra, para pelear.', category: 'tool', weight: 1.8, value: 45, stack: 1, model: 'axe', weapon: 'axe' }),
  I({ id: 'bow', name: 'Arco de tejo', desc: 'Arco de caza. Necesita flechas.', category: 'weapon', weight: 0.9, value: 70, stack: 1, model: 'bow', weapon: 'bow' }),
  I({ id: 'knife', name: 'Cuchillo', desc: 'Para desollar, cortar pan y defenderse de cerca.', category: 'tool', weight: 0.3, value: 12, stack: 1, model: 'knife', weapon: 'knife' }),
  I({ id: 'club', name: 'Maza de bandido', desc: 'Madera dura con clavos de hierro.', category: 'weapon', weight: 2.0, value: 20, stack: 1, model: 'club', weapon: 'club' }),
  I({ id: 'spear', name: 'Lanza', desc: 'Asta de fresno con punta de hierro. Mantiene la distancia.', category: 'weapon', weight: 2.2, value: 55, stack: 1, model: 'spear', weapon: 'spear' }),
  I({ id: 'arrow', name: 'Flecha', desc: 'Punta de hierro y plumas de ganso.', category: 'ammo', weight: 0.05, value: 2, stack: 40, model: 'arrow' }),
  I({ id: 'torch', name: 'Antorcha', desc: 'Estopa empapada en sebo. Ilumina y calienta un poco. Se lleva en la mano izquierda (T).', category: 'light', weight: 0.5, value: 3, stack: 5, model: 'torch', offhand: 'torch' }),
  I({ id: 'shield', name: 'Escudo redondo', desc: 'Tablas de pino con umbo de hierro.', category: 'armor', weight: 3.5, value: 60, stack: 1, model: 'shield', offhand: 'shield' }),
  I({ id: 'gambeson', name: 'Gambesón', desc: 'Jubón acolchado. Abriga y amortigua golpes.', category: 'armor', weight: 3, value: 80, stack: 1, model: 'hide', armor: { slot: 'body', slash: 0.25, blunt: 0.2, pierce: 0.15, warmth: 4 } }),
  I({ id: 'bread', name: 'Pan de centeno', desc: 'Duro pero alimenta.', category: 'food', weight: 0.4, value: 3, stack: 10, model: 'bread', food: { hunger: 22, thirst: -3 } }),
  I({ id: 'apple', name: 'Manzana', desc: 'Pequeña y ácida.', category: 'food', weight: 0.15, value: 1, stack: 20, model: 'apple', food: { hunger: 7, thirst: 5 } }),
  I({ id: 'cheese', name: 'Queso de oveja', desc: 'Curado, fuerte.', category: 'food', weight: 0.5, value: 6, stack: 5, model: 'cheese', food: { hunger: 26, thirst: -5 } }),
  I({ id: 'meat_raw', name: 'Carne cruda', desc: 'Mejor asarla antes. Cruda puede sentar mal.', category: 'food', weight: 0.6, value: 4, stack: 10, model: 'meat_raw', food: { hunger: 8, thirst: 0, health: -6 }, cooksTo: 'meat_cooked' }),
  I({ id: 'meat_cooked', name: 'Carne asada', desc: 'Caliente y jugosa. Alimenta y reconforta.', category: 'food', weight: 0.5, value: 8, stack: 10, model: 'meat_cooked', food: { hunger: 35, thirst: -4, warmth: 120, health: 5 } }),
  I({ id: 'fish_raw', name: 'Pescado fresco', desc: 'Sardinas y alguna lubina. Mejor asado; crudo sienta mal.', category: 'food', weight: 0.5, value: 4, stack: 10, model: 'fish_raw', food: { hunger: 6, thirst: -2, health: -4 }, cooksTo: 'fish_cooked' }),
  I({ id: 'fish_cooked', name: 'Pescado asado', desc: 'Con sal gorda. Alimenta bien.', category: 'food', weight: 0.4, value: 7, stack: 10, model: 'fish_cooked', food: { hunger: 30, thirst: -6, warmth: 80, health: 4 } }),
  I({ id: 'fishing_rod', name: 'Caña de pescar', desc: 'Avellano, sedal de crin y anzuelo de hierro. Úsala mirando al agua.', category: 'tool', weight: 0.8, value: 18, stack: 1, model: 'fishing_rod' }),
  I({ id: 'pickaxe', name: 'Pico', desc: 'Para arrancar piedra de las rocas. También sirve de arma, aunque torpe.', category: 'tool', weight: 2.4, value: 40, stack: 1, model: 'pickaxe', weapon: 'pickaxe' }),
  I({ id: 'plank', name: 'Tablón', desc: 'Madera aserrada. Se obtiene partiendo troncos con el hacha.', category: 'resource', weight: 0.6, value: 3, stack: 30, model: 'plank' }),
  I({ id: 'thatch', name: 'Haz de paja', desc: 'Para techar. Se compra o se siega en los campos.', category: 'resource', weight: 0.5, value: 2, stack: 30, model: 'thatch_bundle' }),
  I({ id: 'waterskin', name: 'Odre (lleno)', desc: 'Agua fresca. Se rellena en el pozo o el arroyo.', category: 'drink', weight: 1.2, value: 6, stack: 1, model: 'waterskin', food: { hunger: 0, thirst: 35 }, container: { emptyId: 'waterskin_empty' } }),
  I({ id: 'waterskin_empty', name: 'Odre (vacío)', desc: 'Rellénalo en el pozo o en el arroyo.', category: 'drink', weight: 0.3, value: 4, stack: 1, model: 'waterskin', container: { fullId: 'waterskin' } }),
  I({ id: 'wine', name: 'Jarra de vino', desc: 'Vino áspero de la taberna.', category: 'drink', weight: 0.8, value: 4, stack: 5, model: 'waterskin', food: { hunger: 4, thirst: 20, warmth: 30 } }),
  I({ id: 'bucket', name: 'Cubo', desc: 'Para acarrear agua. Úsalo en el pozo.', category: 'tool', weight: 1.2, value: 5, stack: 1, model: 'bucket', container: { fullId: 'bucket_water' } }),
  I({ id: 'bucket_water', name: 'Cubo de agua', desc: 'Pesa. Sirve para apagar un fuego.', category: 'tool', weight: 9, value: 5, stack: 1, model: 'bucket_water', container: { emptyId: 'bucket' } }),
  I({ id: 'log', name: 'Tronco', desc: 'Demasiado pesado para la bolsa: agárralo (R) y llévalo a mano.', category: 'resource', weight: 22, value: 6, stack: 1, model: 'log', heavy: true }),
  I({ id: 'firewood', name: 'Leña', desc: 'Para encender fuego.', category: 'resource', weight: 2, value: 2, stack: 10, model: 'firewood' }),
  I({ id: 'stone', name: 'Piedra', desc: 'Piedra de cantera, buena para cimientos y muros.', category: 'resource', weight: 1.0, value: 1, stack: 30, model: 'stone' }),
  I({ id: 'herbs', name: 'Hierbas medicinales', desc: 'Milenrama y llantén. Cortan hemorragias y alivian.', category: 'food', weight: 0.1, value: 5, stack: 20, model: 'herbs', food: { hunger: 1, thirst: 0, health: 12 } }),
  I({ id: 'hide', name: 'Piel de ciervo', desc: 'Se vende bien a curtidores y comerciantes.', category: 'resource', weight: 2.5, value: 14, stack: 5, model: 'hide' }),
  I({ id: 'pelt_wolf', name: 'Piel de lobo', desc: 'Gruesa y gris. Valiosa.', category: 'resource', weight: 2, value: 22, stack: 5, model: 'pelt_wolf' }),
  I({ id: 'letter_rodrigo', name: 'Carta de tu padre', desc: 'Doblada y lacrada con cera roja. La letra de Rodrigo.', category: 'document', weight: 0.05, value: 0, stack: 1, model: 'letter', doc: 'letter_rodrigo', questItem: true }),
  I({ id: 'satchel_rodrigo', name: 'Zurrón de Rodrigo', desc: 'Cuero viejo con las iniciales R. V. grabadas.', category: 'quest', weight: 1.5, value: 0, stack: 1, model: 'satchel', questItem: true }),
  I({ id: 'map_fragment_1', name: 'Fragmento de mapa (I)', desc: 'Un cuarto de un mapa del valle, dibujado a tinta. Hay una cruz cerca de un molino.', category: 'document', weight: 0.05, value: 0, stack: 1, model: 'map_fragment', doc: 'map_fragment_1', questItem: true }),
  I({ id: 'olmedo_token', name: 'Ficha con emblema', desc: 'Moneda de bronce dorado: una torre y un olmo. No es moneda corriente.', category: 'quest', weight: 0.05, value: 0, stack: 1, model: 'olmedo_token', questItem: true }),
  I({ id: 'journal_page_1', name: 'Página del diario de Rodrigo', desc: 'Arrancada de un cuaderno. Tinta corrida por la humedad.', category: 'document', weight: 0.02, value: 0, stack: 1, model: 'journal_page', doc: 'journal_page_1', questItem: true }),
  I({ id: 'payment_order', name: 'Orden de pago', desc: 'Papel sellado encontrado en un bandido.', category: 'document', weight: 0.02, value: 0, stack: 1, model: 'letter', doc: 'payment_order', questItem: true }),
  I({ id: 'coin_purse', name: 'Bolsa de monedas', desc: 'Tintinea.', category: 'misc', weight: 0.3, value: 0, stack: 1, model: 'coin_purse' }),
].map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Objeto desconocido: ${id}`);
  return d;
}
