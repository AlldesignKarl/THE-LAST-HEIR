/**
 * Misiones del vertical slice.
 */
import type { QuestDef } from '../quests/QuestSystem';
import { CAVE, DEER_MEADOW, PLAYER_PLOT, QUARRY } from '../world/WorldLayout';

const PLOT: [number, number] = [PLAYER_PLOT.x, PLAYER_PLOT.z];

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
          { kind: 'flag', flag: 'board_opened', text: 'Registra la choza: bajo la cama de tu padre cruje una tabla', target: { place: 'in:player_hut' } },
          { kind: 'read', doc: 'letter_rodrigo', text: 'Lee lo que encuentres' },
        ],
        onComplete: (c) => { c.setFlag('story_stage_1'); },
      },
      {
        id: 'ask_gil',
        desc: 'La carta habla de «donde el cuervo guarda la oscuridad», en una peña del bosque pasado el arroyo. Dice que Gil el cazador sabe llegar.',
        objectives: [{ kind: 'flag', flag: 'gil_told_cave', text: 'Pregunta a Gil el cazador por la peña del cuervo', target: { npc: 'gil' } }],
      },
      {
        id: 'find_cave',
        desc: 'Gil te ha indicado el camino: cruzar el puente del arroyo y seguir la senda del bosque hacia el oeste hasta la peña. Dentro no se ve nada: lleva una antorcha (T).',
        objectives: [{ kind: 'goto', area: 'cave_crow_inside', text: 'Entra en la Cueva del Cuervo', target: { pos: [CAVE.mouth.x, CAVE.mouth.z] } }],
      },
      {
        id: 'search_cave',
        desc: 'Tu padre dejó algo al fondo de la cueva.',
        objectives: [{ kind: 'collect', item: 'satchel_rodrigo', count: 1, text: 'Busca lo que escondió Rodrigo', target: { item: 'satchel_rodrigo' } }],
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
          { kind: 'flag', flag: 'asked_priest_crest', text: 'Enseña la ficha al padre Anselmo', target: { npc: 'anselmo' } },
          { kind: 'flag', flag: 'gil_crest', text: 'Pregunta a Gil por el emblema', target: { npc: 'gil' } },
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
    id: 'side_home',
    title: 'Un techo propio',
    type: 'side',
    giver: 'gonzalo',
    stages: [
      {
        id: 'ask',
        desc: 'La choza de tu padre se cae a pedazos. Al sur tienes un descampado que es tuyo: tu parcela. Gonzalo el Calafate, en la atarazana junto al embarcadero, sabe de madera y de obras.',
        objectives: [{ kind: 'flag', flag: 'asked_build', text: 'Pregunta a Gonzalo cómo construir una casa', target: { npc: 'gonzalo' } }],
      },
      {
        id: 'tools',
        desc: 'Necesitas un hacha para la madera y un pico para la piedra. El hacha está en la mesa de tu choza; el pico viejo de tu padre, en el arcón de la parcela.',
        objectives: [
          { kind: 'collect', item: 'axe', count: 1, text: 'Coge el hacha', target: { item: 'axe' } },
          { kind: 'collect', item: 'pickaxe', count: 1, text: 'Coge el pico del arcón de la parcela', target: { pos: [PLAYER_PLOT.x - PLAYER_PLOT.size / 2 - 1.3, PLAYER_PLOT.z - PLAYER_PLOT.size / 2 + 2] } },
        ],
      },
      {
        id: 'gather',
        desc: 'Tala un árbol con el hacha y, ya en el suelo, parte cada tronco a hachazos: salen tablones. Luego ve a la cantera, al sur de tu parcela, y pica las rocas con el pico.',
        objectives: [
          { kind: 'collect', item: 'plank', count: 16, text: 'Consigue tablones', target: { near: 'log' } },
          { kind: 'collect', item: 'stone', count: 8, text: 'Saca piedra en la cantera', target: { pos: [QUARRY.x, QUARRY.z] } },
        ],
      },
      {
        id: 'build',
        desc: 'Ve a tu parcela y pulsa B (o «Construir» en el móvil). Elige la pieza, apunta y coloca. Primero el suelo o los cimientos, luego las paredes, una con puerta, el tejado y una cama.',
        objectives: [
          { kind: 'flag', flag: 'built_base', text: 'Pon el suelo o los cimientos', target: { pos: PLOT } },
          { kind: 'flag', flag: 'built_walls4', text: 'Levanta al menos cuatro paredes', target: { pos: PLOT } },
          { kind: 'flag', flag: 'built_wall_door', text: 'Pon una pared con puerta', target: { pos: PLOT } },
          { kind: 'flag', flag: 'built_roof', text: 'Cubre la casa con un tejado', target: { pos: PLOT } },
          { kind: 'flag', flag: 'built_bed', text: 'Hazte una cama', target: { pos: PLOT } },
        ],
      },
    ],
    onComplete: (c) => {
      c.giveCoins(30);
      c.changeRep('robledo', 6, 'casa propia');
      c.setFlag('has_home');
      c.bus.emit('notify', { text: 'Ya tienes casa propia. Puedes dormir en tu cama y guardar tus cosas en tus arcones. +30 mrv', kind: 'quest' });
    },
  },
  {
    id: 'side_fishing',
    title: 'El mar da de comer',
    type: 'side',
    giver: 'nuno',
    stages: [
      {
        id: 'rod',
        desc: 'Nuño el pescador vende cañas en el embarcadero. Con una caña y algo de paciencia, el mar te dará de comer.',
        objectives: [{ kind: 'collect', item: 'fishing_rod', count: 1, text: 'Consigue una caña de pescar', target: { npc: 'nuno' } }],
      },
      {
        id: 'catch',
        desc: 'Equipa la caña, colócate al final del embarcadero mirando al agua y lánzala (clic). Cuando el corcho se hunda, tira (clic otra vez).',
        objectives: [{ kind: 'collect', item: 'fish_raw', count: 3, text: 'Pesca tres peces', target: { place: 'pier_end' } }],
      },
    ],
    onComplete: (c) => {
      c.changeRep('robledo', 3, 'pescar');
      c.bus.emit('notify', { text: 'Ásalos en una hoguera o en el hogar: el pescado asado alimenta mucho.', kind: 'quest' });
    },
  },
  {
    id: 'side_islands',
    title: 'Lo que guardan las islas',
    type: 'explore',
    giver: 'mateo',
    stages: [
      {
        id: 'boat',
        desc: 'Mateo, el patrón de barcas, alquila una barca por 25 maravedíes. Las islas guardan una ermita en ruinas, una cueva y los restos de una coca.',
        objectives: [{ kind: 'flag', flag: 'boat_permit', text: 'Consigue una barca de Mateo', target: { npc: 'mateo' } }],
      },
      {
        id: 'explore',
        desc: 'Rema hasta las islas (E junto a la barca para subir; W/S remar, A/D girar; E de nuevo para bajar en la orilla) y registra lo que encuentres.',
        objectives: [
          { kind: 'flag', flag: 'found_chapel', text: 'Explora la ermita de la Isla de las Gaviotas', target: { place: 'chapel_isle' } },
          { kind: 'flag', flag: 'found_wreck', text: 'Registra los restos de la coca', target: { place: 'wreck_isle' } },
          { kind: 'flag', flag: 'found_penon', text: 'Entra en la cueva del Peñón', target: { place: 'penon_cave' } },
        ],
      },
    ],
    onComplete: (c) => {
      c.changeRep('robledo', 5, 'explorar las islas');
      c.bus.emit('notify', { text: 'Has recorrido las tres islas.', kind: 'quest' });
    },
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
        objectives: [{ kind: 'flag', flag: 'logs_delivered', count: LOGS_REQUIRED, text: 'Troncos en la carpintería', target: { near: 'log' } }],
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
          { kind: 'collect', item: 'hide', count: 2, text: 'Consigue pieles de ciervo', target: { pos: [DEER_MEADOW.x, DEER_MEADOW.z] } },
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
