/**
 * Diálogos de los habitantes de Robledo. Algunos ocultan información o
 * mienten (el padre Anselmo). Las condiciones leen misiones, flags,
 * inventario, reputación y hora.
 */
import type { DialogueCtx } from '../social/Dialogue';

export interface Topic {
  id: string;
  text: string | ((c: DialogueCtx) => string);
  reply: string | ((c: DialogueCtx) => string);
  cond?: (c: DialogueCtx) => boolean;
  effect?: (c: DialogueCtx) => void;
  once?: boolean;
  opensTrade?: boolean;
  ends?: boolean;
}

export interface NpcDialogue {
  greet: (c: DialogueCtx) => string;
  topics: Topic[];
}

const hello = (c: DialogueCtx): string => {
  const h = c.g.time.hourFloat;
  const t = h < 6 || h >= 21 ? 'Buenas noches' : h < 13 ? 'Buenos días' : 'Buenas tardes';
  const tier = c.g.reputation.tier(c.npc.def.village);
  if (tier === 'Desconfiado') return `${t}. ¿Qué quieres?`;
  if (tier === 'De confianza' || tier === 'Honrado') return `${t}, Martín. Me alegra verte.`;
  return `${t}, Martín.`;
};

const afterRaid = (c: DialogueCtx): string | null => {
  const f = c.g.flags;
  if (f.num('raid_result_day') === c.g.time.day || f.num('raid_result_day') === c.g.time.day - 1) {
    if (f.has('last_raid_failed')) return 'Nos han destrozado... ¿Dónde estabas cuando llegaron?';
    if (f.has('last_raid_repelled')) return '¡Los echamos! Aún me tiemblan las manos.';
  }
  return null;
};

const trade: Topic = { id: 'trade', text: 'Quiero comerciar.', reply: '', opensTrade: true };

const rumor = (id: string, lines: string[]): Topic => ({
  id: `rumor_${id}`,
  text: '¿Qué se cuenta por aquí?',
  reply: (c) => {
    const k = Math.floor(c.g.time.totalMinutes / 180) % lines.length;
    return lines[k];
  },
});

export const DIALOGUES: Record<string, NpcDialogue> = {
  gil: {
    greet: (c) => afterRaid(c) ?? `${hello(c)} ${c.g.flags.has('gil_told_cave') ? '¿Encontraste lo que buscabas?' : 'Tienes la misma cara que tu padre cuando tramaba algo.'}`,
    topics: [
      {
        id: 'cave', text: 'Mi padre me dejó una carta. Habla de «la peña del cuervo».',
        cond: (c) => c.g.flags.has('story_stage_1') && !c.g.flags.has('gil_told_cave'),
        reply: (c) => {
          const torch = c.g.inventory.has('torch') ? '' : ' Toma una antorcha: ahí dentro no se ve ni la mano.';
          return 'La Cueva del Cuervo. Lo acompañé una vez, hace ocho o nueve años; me hizo esperar fuera y salió con las manos vacías y la cara de quien ha enterrado a alguien. Cruza el puente del arroyo y sigue la senda del bosque hacia el poniente, hasta la peña. Ve de día: de noche bajan los lobos.' + torch;
        },
        effect: (c) => {
          c.g.flags.set('gil_told_cave');
          if (!c.g.inventory.has('torch')) { c.g.inventory.add('torch', 1); c.g.bus.emit('item:acquired', { itemId: 'torch', count: 1, source: 'reward' }); }
          c.g.discovered.add('cave_crow');
          c.g.discovered.add('forest_bridge');
        },
      },
      {
        id: 'crest', text: 'Mira esta ficha. ¿Conoces el emblema?',
        cond: (c) => c.g.inventory.has('olmedo_token') && !c.g.flags.has('gil_crest'),
        reply: 'Guárdala. Ahora. (Mira alrededor.) La torre y el olmo son de los Olmedo, los señores de este valle antes del conde de Ubeda. Los acusaron de traición hace treinta años y no quedó ni el perro. Si tu padre llevaba eso encima... No se lo enseñes al cura. Cuando Rodrigo le preguntó por esa ficha, se puso blanco como la cera.',
        effect: (c) => { c.g.flags.set('gil_crest'); c.g.reputation.change('robledo', 1, 'confianza de Gil'); },
      },
      {
        id: 'hunt_offer', text: '¿Necesitas ayuda con algo?',
        cond: (c) => c.g.quests.status('hunt_gil') === 'inactive',
        reply: (c) => {
          const bow = c.g.inventory.has('bow') ? '' : ' Y llévate mi arco viejo: tira algo torcido, pero caza.';
          return 'Los curtidores de Almenara pagan bien las pieles de ciervo. Tráeme dos y te pago y te doy flechas. Los ciervos pastan en el prado al otro lado del arroyo; son asustadizos, acércate agachado.' + bow;
        },
        effect: (c) => {
          c.g.quests.start('hunt_gil');
          if (!c.g.inventory.has('bow')) {
            c.g.inventory.add('bow', 1); c.g.inventory.add('arrow', 12);
            c.g.bus.emit('item:acquired', { itemId: 'bow', count: 1, source: 'reward' });
            c.g.bus.emit('notify', { text: 'Gil te da su arco viejo y 12 flechas.', kind: 'item' });
          }
          c.g.discovered.add('deer_meadow');
        },
      },
      {
        id: 'hunt_deliver', text: 'Traigo las pieles.',
        cond: (c) => c.g.quests.canDeliver('hunt_gil', 'gil'),
        reply: 'Buenas pieles, sin agujeros de más. Aquí tienes lo tuyo.',
        effect: (c) => { c.g.quests.deliver('hunt_gil', 'gil'); },
      },
      {
        id: 'father', text: 'Háblame de mi padre.', once: true,
        reply: 'Rodrigo llegó a Robledo con dinero de mercenario y modales de caballero, y se hizo tratante de lana como quien se esconde. Sabía leer, sabía de espadas y sabía callar. Siempre miraba el camino del norte, como si esperase a alguien. O como si temiese que llegara.',
      },
      trade,
      rumor('gil', [
        'Los Cuervos tienen su campamento al noreste, en el pinar. Cada vez son más y mejor armados. Eso no lo paga el robo de gallinas.',
        'Los lobos rondan la peña de la cueva. De noche no vayas sin fuego.',
        'Los ciervos bajan al prado por la mañana. Con viento en contra, te acercas a tiro.',
      ]),
    ],
  },
  anselmo: {
    greet: (c) => afterRaid(c) ?? `Dios os guarde, hijo. ${c.g.time.hourFloat < 12 ? 'La misa de alba fue breve hoy.' : ''}`,
    topics: [
      {
        id: 'crest', text: '¿Reconocéis este emblema, padre?',
        cond: (c) => c.g.inventory.has('olmedo_token') && !c.g.flags.has('asked_priest_crest'),
        reply: 'Eh... no. No, no lo había visto nunca. Será moneda de algún mercader extranjero, de Portugal o de Flandes. Guardadla, hijo, y no andéis enseñándola por ahí; hay gente que por una baratija dorada os abriría el cuello. (Evita tu mirada y se santigua dos veces.)',
        effect: (c) => { c.g.flags.set('asked_priest_crest'); c.g.flags.set('priest_lied'); },
      },
      {
        id: 'rodrigo', text: '¿Conocisteis bien a mi padre?',
        reply: 'Venía poco a misa. Era... un hombre inquieto. Rezad por su alma y no remováis el pasado, que el pasado tiene los dientes afilados.',
      },
      {
        id: 'olmedo', text: '¿Quiénes eran los Olmedo?',
        cond: (c) => c.g.flags.has('gil_crest'),
        reply: '(Palidece.) Traidores a la Corona, que Dios los haya perdonado. Todo aquello pasó antes de que vos nacierais. ¿Quién os ha llenado la cabeza con esas historias? ¿Gil? Ese hombre bebe demasiado.',
      },
      rumor('anselmo', [
        'El señor conde ha subido el diezmo otra vez. Son tiempos duros para todos.',
        'Hay que rezar más y preguntar menos, hijo.',
      ]),
    ],
  },
  sancho: {
    greet: (c) => afterRaid(c) ?? (c.g.flags.has('palisade_repaired') ? `${hello(c)} La empalizada aguanta, gracias a ti.` : `${hello(c)} Esa brecha me quita el sueño.`),
    topics: [
      {
        id: 'job', text: '¿Hay trabajo?',
        cond: (c) => c.g.quests.status('side_palisade') === 'inactive',
        reply: (c) => `La empalizada tiene una brecha al noreste desde las lluvias de marzo. Si los Cuervos se enteran, entran como Pedro por su casa. Necesito seis troncos buenos. Hay una arboleda justo al otro lado de la brecha. ${c.g.inventory.has('axe') ? 'Veo que tienes hacha.' : 'Tu padre tenía un hacha en la choza, sobre la mesa.'} Los troncos pesan: agárralos y tráelos a rastras hasta el círculo de estacas, aquí delante. Te pagaré cuarenta maravedíes.`,
        effect: (c) => { c.g.quests.start('side_palisade'); },
      },
      {
        id: 'progress', text: '¿Cuántos troncos faltan?',
        cond: (c) => c.g.quests.stageId('side_palisade') === 'logs',
        reply: (c) => `Llevas ${c.g.woodDelivered()} de 6. Déjalos dentro del círculo de estacas.`,
      },
      rumor('sancho', [
        'El granero necesita tejado nuevo antes del invierno, pero nadie paga.',
        'Mendo dice que los Cuervos vigilan el camino del norte. Yo no salgo sin el hacha.',
      ]),
    ],
  },
  bartolome: {
    greet: (c) => afterRaid(c) ?? `${hello(c)} Si vienes a mirar, mira; si vienes a comprar, mejor.`,
    topics: [
      trade,
      {
        id: 'bandits', text: '¿Qué armas llevan los bandidos?',
        reply: 'Mazas, hachas de leñador, alguna espada robada. Pero el último que Mendo cazó llevaba una ballesta nueva, de taller. Eso no se roba en una granja: eso lo compra alguien con dinero.',
      },
      rumor('bartolome', [
        'El hierro de Vizcaya no llega desde que cortaron el camino real.',
        'Dicen que en Almenara hay un arcabucero. Ruido y humo, nada más. Dame una buena espada.',
      ]),
    ],
  },
  ines: {
    greet: (c) => afterRaid(c) ?? `${hello(c)} ¿Vino o algo que llevarse a la boca?`,
    topics: [
      trade,
      {
        id: 'room', text: 'Quiero una cama esta noche (5 mrv).',
        cond: (c) => c.g.time.hourFloat >= 19 || c.g.time.hourFloat < 5,
        reply: (c) => (c.g.inventory.coins >= 5 ? 'Arriba, la segunda puerta. Sábanas limpias... casi.' : 'Sin dinero no hay cama, Martín.'),
        effect: (c) => {
          if (c.g.inventory.coins < 5) return;
          c.g.inventory.coins -= 5;
          c.g.ui.closeDialogue();
          c.g.ui.fade(0.8, () => c.g.actions.rest(c.g.actions.hoursUntilDawn(), true));
        },
      },
      rumor('ines', [
        'Gil y tu padre bebían en esa mesa del rincón. Hablaban bajito, como conspiradores.',
        'Unos soldados del conde pararon aquí el mes pasado. Preguntaban por la choza de los Varga. No dije nada.',
        'Lucía dice que las caravanas de sal ya no pasan por el camino del norte.',
      ]),
    ],
  },
  lucia: {
    greet: (c) => afterRaid(c) ?? `${hello(c)} Mira sin miedo, que mirar es gratis.`,
    topics: [trade, rumor('lucia', [
      'Si vas al bosque, lleva antorchas. Tengo de sobra.',
      'Un mercader no volvió de Almenara hace dos semanas. Los caminos ya no son seguros.',
    ])],
  },
  mendo: {
    greet: (c) => afterRaid(c) ?? `${hello(c)} ${c.g.time.isNight ? 'Mala hora para pasear.' : 'Todo en orden, por ahora.'}`,
    topics: [
      {
        id: 'reward', text: 'Sobre la defensa del pueblo...',
        cond: (c) => c.g.flags.has('raid_reward_pending'),
        reply: 'Luchaste como uno de los nuestros. El concejo te paga esto, y quédate el escudo: te hará más falta que a mí.',
        effect: (c) => {
          c.g.flags.clear('raid_reward_pending');
          c.g.inventory.coins += 50;
          c.g.inventory.add('shield', 1);
          c.g.bus.emit('item:acquired', { itemId: 'shield', count: 1, source: 'reward' });
          c.g.bus.emit('notify', { text: 'Recompensa: 50 mrv y un escudo.', kind: 'quest' });
        },
      },
      {
        id: 'bandits', text: '¿Qué sabéis de Los Cuervos?',
        reply: 'Una cuadrilla de soldados licenciados. Acampan en el pinar del noreste. Si atacan, vendrán por el norte: el portón o, si no la han cerrado aún, la brecha. Si oyes la campana, coge un arma o enciérrate.',
        effect: (c) => c.g.discovered.add('bandit_camp'),
      },
      {
        id: 'help', text: '¿Cómo puedo ayudar a la guardia?',
        reply: 'Ten a mano un arco y sube a la torre si suena la campana. Y ayuda a Sancho con la empalizada: un muro sin hueco vale por tres hombres.',
      },
      rumor('mendo', [
        'Pedro dice haber visto fuegos en el pinar del noreste.',
        'El conde no manda soldados a protegernos, solo a cobrar.',
      ]),
    ],
  },
  pedro: {
    greet: (c) => afterRaid(c) ?? `${hello(c)} ${c.g.time.isNight ? 'Desde la torre se ve todo el camino.' : 'Me toca dormir, que esta noche vigilo.'}`,
    topics: [rumor('pedro', ['Anoche vi antorchas moviéndose por el camino del norte.', 'La campana de San Millán se oye hasta en el bosque.'])],
  },
  teresa: {
    greet: (c) => afterRaid(c) ?? `${hello(c)} No me entretengas mucho, que el trigo no se escarda solo.`,
    topics: [rumor('teresa', [
      'Los jabalíes y los lobos se comen lo que la lluvia deja.',
      'Tu madre, que en gloria esté, decía que Rodrigo hablaba en sueños de una torre y un árbol.',
    ])],
  },
  ferran: {
    greet: (c) => afterRaid(c) ?? `${hello(c)} ${c.g.vitals.health < 60 ? 'Tienes mala cara. Y mala sangre, por lo que veo.' : '¿Alguna dolencia?'}`,
    topics: [
      {
        id: 'heal', text: 'Curadme las heridas (12 mrv).',
        cond: (c) => c.g.vitals.health < c.g.vitals.maxHealth - 5 || c.g.vitals.bleeding > 0,
        reply: (c) => (c.g.inventory.coins >= 12 ? 'Vino en la herida, un emplasto de llantén y reposo. Listo.' : 'La medicina cuesta, Martín.'),
        effect: (c) => {
          if (c.g.inventory.coins < 12) return;
          c.g.inventory.coins -= 12;
          c.g.vitals.heal(100);
          c.g.vitals.bleeding = 0;
        },
      },
      rumor('ferran', ['Las heridas de flecha se infectan si no se limpian. Recuérdalo.', 'Las hierbas del bosque curan más que muchos boticarios.']),
    ],
  },
};
