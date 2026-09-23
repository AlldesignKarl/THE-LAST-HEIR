/**
 * Progresión del misterio del Arca de Olmedo (10 etapas, GDD §3).
 * Las pistas se desbloquean con flags; el diario las muestra.
 */
import type { EventBus } from '../core/EventBus';
import type { Flags } from '../core/Flags';
import type { Inventory } from '../items/Inventory';

interface Clue { flag: string; title: string; text: string }

const CLUES: Clue[] = [
  { flag: 'story_stage_1', title: 'La carta de Rodrigo', text: 'Tu padre no fue solo tratante de lana: mandó una compañía de mercenarios y antes «tuvo otro nombre». Lo que buscaba «no es oro». Repartió sus pistas por el valle. La primera: la peña del cuervo, en el bosque, pasado el arroyo.' },
  { flag: 'gil_told_cave', title: 'Lo que sabe Gil', text: 'Gil acompañó a Rodrigo a la peña del cuervo hace años y esperó fuera. Rodrigo salió con las manos vacías «y la cara de quien ha enterrado a alguien».' },
  { flag: 'story_stage_2', title: 'El zurrón de la cueva', text: 'Al fondo de la Cueva del Cuervo estaba el zurrón de tu padre: un fragmento de mapa, una ficha con una torre y un olmo y una página de su diario.' },
  { flag: 'priest_lied', title: 'El cura miente', text: 'El padre Anselmo juró no conocer el emblema. Rodrigo escribió que el cura estuvo en Peñaseca el año que cayeron los Olmedo.' },
  { flag: 'gil_crest', title: 'La torre y el olmo', text: 'Según Gil, es el emblema de la Casa de Olmedo, señores del valle hasta que el conde de Ubeda los acusó de traición hace treinta años. Nadie de esa casa sobrevivió… en teoría.' },
  { flag: 'story_stage_3', title: '¿Quién era Rodrigo?', text: 'Si Rodrigo guardaba la ficha de los Olmedo y huía de los hombres del conde, quizá tú no seas solo el hijo de un tratante de lana.' },
  { flag: 'read_payment_order', title: 'La orden de pago', text: 'Un bandido llevaba una orden sellada en el castillo de Ubeda: el conde paga a Los Cuervos para vigilar los caminos y para buscar «los papeles» de Rodrigo Varga.' },
  { flag: 'story_next_valdeolmo', title: 'La siguiente pista', text: 'El diario de Rodrigo señala al molinero de Valdeolmo, que guardó el segundo fragmento del mapa: «la rueda que no gira».' },
];

export class Story {
  constructor(private readonly bus: EventBus, private readonly flags: Flags, private readonly inv: Inventory) {
    bus.on('item:acquired', (e) => {
      if (e.itemId === 'satchel_rodrigo') bus.emit('notify', { text: 'El zurrón de tu padre. Ábrelo desde el inventario (Tab).', kind: 'quest' });
    });
    bus.on('doc:read', (e) => {
      if (e.docId === 'payment_order') flags.set('read_payment_order');
      if (e.docId === 'journal_page_1') flags.set('story_next_valdeolmo');
    });
  }

  /** Etapa actual del misterio (1..10). */
  get stage(): number {
    let s = 1;
    if (this.flags.has('story_stage_1')) s = 2;
    if (this.flags.has('story_stage_2')) s = 3;
    if (this.flags.has('story_stage_3')) s = 4;
    return s;
  }

  openSatchel(): void {
    if (!this.inv.has('satchel_rodrigo')) return;
    this.inv.remove('satchel_rodrigo');
    for (const id of ['map_fragment_1', 'olmedo_token', 'journal_page_1']) {
      this.inv.add(id, 1);
      this.bus.emit('item:acquired', { itemId: id, count: 1, source: 'container' });
    }
    this.flags.set('satchel_opened');
    this.bus.emit('sfx', { id: 'paper' });
    this.bus.emit('notify', { text: 'En el zurrón: un fragmento de mapa, una ficha dorada y una página de diario.', kind: 'quest' });
  }

  clues(): { title: string; text: string }[] {
    const list = CLUES.filter((c) => this.flags.has(c.flag));
    if (!list.length) return [{ title: 'Nada todavía', text: 'Tu padre desapareció hace siete años. Antes de irse te dijo: «si un día no vuelvo, busca bajo mis pies».' }];
    return list;
  }
}
