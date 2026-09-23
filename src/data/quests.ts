/**
 * Misiones del vertical slice.
 */
import type { QuestDef } from '../quests/QuestSystem';

export const LOGS_REQUIRED = 6;

export const QUESTS: QuestDef[] = [
  {
    id: 'main_legacy',
    title: 'El legado de Rodrigo',
    type: 'main',
    stages: [
      {
        id: 'search_hut',
        desc: 'Hace siete años que tu padre, Rodrigo, se fue y no volvió. Antes de irse te dijo: «si un día no vuelvo, busca bajo mis pies». Siempre creíste que era una de sus bromas.',
        objectives: [
          { kind: 'flag', flag: 'board_opened', text: 'Registra la choza: bajo la cama de tu padre cruje una tabla' },
          { kind: 'read', doc: 'letter_rodrigo', text: 'Lee lo que encuentres' },
        ],
        onComplete: (c) => { c.setFlag('story_stage_1'); },
      },
      {
        id: 'ask_gil',
        desc: 'La carta habla de «donde el cuervo guarda la oscuridad», en una peña del bosque pasado el arroyo. Dice que Gil el cazador sabe llegar.',
        objectives: [{ kind: 'flag', flag: 'gil_told_cave', text: 'Pregunta a Gil el cazador por la peña del cuervo' }],
      },
      {
        id: 'find_cave',
        desc: 'Gil te ha indicado el camino: cruzar el puente del arroyo y seguir la senda del bosque hacia el oeste hasta la peña. Dentro no se ve nada: lleva una antorcha (T).',
        objectives: [{ kind: 'goto', area: 'cave_crow_inside', text: 'Entra en la Cueva del Cuervo' }],
      },
      {
        id: 'search_cave',
        desc: 'Tu padre dejó algo al fondo de la cueva.',
        objectives: [{ kind: 'collect', item: 'satchel_rodrigo', count: 1, text: 'Busca lo que escondió Rodrigo' }],
        onComplete: (c) => { c.setFlag('story_stage_2'); },
      },
      {
        id: 'open_satchel',
        desc: 'Un zurrón de cuero con las iniciales R. V. Ábrelo desde el inventario.',
        objectives: [{ kind: 'read', doc: 'journal_page_1', text: 'Examina el contenido del zurrón' }],
      },
      {
        id: 'ask_crest',
        desc: 'Una ficha con una torre y un olmo. Rodrigo escribió que el cura de Robledo la reconoció aunque juró que no.',
        objectives: [
          { kind: 'flag', flag: 'asked_priest_crest', text: 'Enseña la ficha al padre Anselmo' },
          { kind: 'flag', flag: 'gil_crest', text: 'Pregunta a Gil por el emblema' },
        ],
        onComplete: (c) => { c.setFlag('story_stage_3'); },
      },
      {
        id: 'to_valdeolmo',
        desc: 'La torre y el olmo son el emblema de los Olmedo, la casa que el conde exterminó hace treinta años. El cura mintió. La siguiente pista está en el molino de Valdeolmo. [Valdeolmo llegará en la Fase 3 del desarrollo: esta tarea no puede completarse aún.]',
        objectives: [{ kind: 'flag', flag: 'valdeolmo_mill_found', text: 'Viaja a Valdeolmo y busca al molinero (próximamente)' }],
      },
    ],
  },
  {
    id: 'side_palisade',
    title: 'Madera para la empalizada',
    type: 'village',
    giver: 'sancho',
    stages: [
      {
        id: 'logs',
        desc: 'Sancho el carpintero necesita troncos para cerrar la brecha de la empalizada del noreste antes de que los bandidos la aprovechen. Tala árboles con el hacha y lleva los troncos (agárralos con R) al círculo de estacas frente a la carpintería.',
        objectives: [{ kind: 'flag', flag: 'logs_delivered', count: LOGS_REQUIRED, text: 'Troncos en la carpintería' }],
      },
      {
        id: 'report',
        desc: 'Ya hay suficiente madera. Avisa a Sancho.',
        objectives: [{ kind: 'talk', npc: 'sancho', text: 'Habla con Sancho' }],
      },
    ],
    onComplete: (c) => {
      c.giveCoins(40);
      c.changeRep('robledo', 8, 'madera para la empalizada');
      c.setFlag('palisade_repair_pending');
      c.bus.emit('notify', { text: 'Sancho reparará la brecha mañana al alba. +40 mrv', kind: 'quest' });
    },
  },
  {
    id: 'hunt_gil',
    title: 'Pieles para el invierno',
    type: 'hunt',
    giver: 'gil',
    stages: [
      {
        id: 'hides',
        desc: 'Gil necesita pieles de ciervo para los curtidores de Almenara. Los ciervos pastan en el prado al oeste del arroyo, de día. Son asustadizos: acércate agachado (Ctrl) y usa el arco.',
        objectives: [
          { kind: 'collect', item: 'hide', count: 2, text: 'Consigue pieles de ciervo' },
          { kind: 'deliver', item: 'hide', count: 2, npc: 'gil', text: 'Entrégaselas a Gil' },
        ],
      },
    ],
    onComplete: (c) => {
      c.giveCoins(30);
      c.giveItem('arrow', 10);
      c.changeRep('robledo', 5, 'ayudar a Gil');
      c.bus.emit('notify', { text: 'Gil te paga 30 mrv y 10 flechas.', kind: 'quest' });
    },
  },
  {
    id: 'defense_robledo',
    title: 'Defender Robledo',
    type: 'defense',
    stages: [
      {
        id: 'defend',
        desc: 'Los bandidos atacan Robledo. Protege a los vecinos, cierra el portón, sube a la torre con el arco o lucha en primera línea. Si pierden a su cabecilla o a la mitad de los suyos, huirán.',
        objectives: [{ kind: 'flag', flag: 'raid_over', text: 'Rechaza el ataque' }],
      },
    ],
  },
];
