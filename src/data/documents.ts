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
};
