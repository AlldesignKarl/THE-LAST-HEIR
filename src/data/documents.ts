/**
 * Documentos legibles (cartas, diarios, mapas). Forman parte de la
 * narrativa del Arca de Olmedo (ver docs/GDD.md §3).
 */
export interface DocumentDef {
  id: string;
  title: string;
  /** Párrafos. */
  body: string[];
  signature?: string;
  style: 'letter' | 'journal' | 'map' | 'official';
}

export const DOCUMENTS: Record<string, DocumentDef> = {
  letter_rodrigo: {
    id: 'letter_rodrigo',
    title: 'Carta lacrada',
    style: 'letter',
    body: [
      'Martín, hijo:',
      'Si lees esto es que no he vuelto, y que has tenido el buen juicio de no creerte todo lo que se dice de mí en la taberna.',
      'No fui solo tratante de lana. Antes de eso llevé la Compañía de Varga por media Castilla, y antes aún tuve otro nombre que no puedo escribir aquí. Lo que busqué toda mi vida no es oro, aunque habrá quien lo llame así. Es lo único que nos pertenecía y nos quitaron.',
      'No lo guardé en un solo sitio. Lo repartí para que nadie pudiera juntarlo de un golpe: ni los hombres del conde, ni la codicia de un hijo impaciente.',
      'Empieza donde el cuervo guarda la oscuridad, en la peña del bosque, pasado el arroyo. Lleva luz: allí dentro la noche no acaba nunca. Gil el cazador sabe llegar, y es el único de Robledo en quien confío.',
      'Y no enseñes a nadie lo que encuentres. A nadie.',
    ],
    signature: 'R.',
  },
  journal_page_1: {
    id: 'journal_page_1',
    title: 'Página arrancada de un diario',
    style: 'journal',
    body: [
      '...catorce de octubre. He escondido aquí la primera parte del mapa. Si me siguen, que encuentren solo huesos y humedad.',
      'La ficha es la clave: la torre y el olmo. Quien la reconozca sabrá quién soy, y por eso debo dársela a pocos. El cura de Robledo la reconoció; lo vi en su cara, aunque juró que no. Ese hombre sabe más de lo que confiesa. Estaba en Peñaseca el año que cayeron los Olmedo.',
      'La segunda parte está con el molinero de Valdeolmo, o lo estaba. Le pagué para que la guardara sin preguntar. Hay que llegar antes que los Cuervos: el capitán del conde les paga por vigilar los caminos, y ahora sé que no buscan caravanas.',
      '(El resto de la página está ilegible por la humedad.)',
    ],
    signature: 'R. V.',
  },
  map_fragment_1: {
    id: 'map_fragment_1',
    title: 'Fragmento de mapa (I de IV)',
    style: 'map',
    body: [
      'Un cuarto de un mapa del valle a tinta parda. Se reconocen el arroyo, la peña del Cuervo y, al este, un molino dibujado con cuidado junto al río.',
      'Una cruz pequeña junto al molino. Al margen, con otra tinta: «Valdeolmo — la rueda que no gira».',
      'Los bordes rasgados encajarían con otros tres trozos.',
    ],
  },
  payment_order: {
    id: 'payment_order',
    title: 'Orden de pago',
    style: 'official',
    body: [
      'Páguese al portador, capitán de la cuadrilla llamada de Los Cuervos, la suma de trescientos maravedíes por los servicios acordados en el camino de Robledo.',
      'Téngase especial cuidado con cualquiera que pregunte por Rodrigo Varga o por su casa. Tráiganse sus papeles intactos.',
      'Dado en el castillo de Ubeda.',
    ],
    signature: 'Por mandado del conde, su mayordomo — sello de cera negra',
  },
  chapel_slab: {
    id: 'chapel_slab',
    title: 'Losa de la ermita',
    style: 'official',
    body: [
      'Bajo el polvo y los excrementos de gaviota, una losa labrada: una torre y, a su lado, un olmo. Las mismas figuras de la ficha de tu padre.',
      'Alrededor, en letra gótica gastada: «AQVI VELA LA CASA DE OLMEDO · LA OTRA MITAD DUERME DONDE LA PEÑA SE BEBE EL MAR».',
      'Alguien ha raspado hace poco el musgo de las letras. Hay marcas de cuchillo recientes en el borde, como si hubieran intentado levantarla.',
    ],
  },
  wreck_log: {
    id: 'wreck_log',
    title: 'Cuaderno del maestre (empapado)',
    style: 'journal',
    body: [
      '...salimos de Almenara con plata del conde para pagar a la guarnición de Peñaseca. El piloto decía que el levante no...',
      '...perdimos el timón frente al islote. Los hombres quieren abandonar la coca. Yo me quedo con la caja...',
      'La última línea está escrita con otra mano: «La caja ya no está. R. V.»',
    ],
  },
  penon_note: {
    id: 'penon_note',
    title: 'Nota envuelta en hule',
    style: 'letter',
    body: [
      'A quien la halle, y ojalá sea Martín:',
      'Tu padre y yo trajimos aquí la mitad de lo que buscaba. La otra la dejó en tierra, en sitio que solo él conoce. Dejo con esta nota la llave; sin la otra mitad no abre nada.',
      'Si el cura pregunta por mí, dile que me llevó el mar. No es mentira del todo.',
    ],
    signature: 'Lope, marinero de Robledo',
  },
};
