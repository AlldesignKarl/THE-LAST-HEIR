# THE LAST HEIR · Game Design Document (resumido)

## 1. Visión

Supervivencia, exploración, combate y defensa de aldeas **en primera persona**, en un valle ficticio de la Península hacia **1490–1520** (fin de la Edad Media / principio de la Moderna). Sin fantasía: ni magia, ni monstruos, ni armas modernas. El mundo sigue vivo aunque el jugador no haga misiones.

**Pilares**
1. **Un mundo que existe sin ti**: gente con nombre, casa, oficio y horario.
2. **El peso de las cosas**: combate lento y caro en stamina, objetos físicos, noche peligrosa.
3. **El pueblo es tuyo si lo defiendes**: los ataques son eventos reales con consecuencias persistentes.
4. **Un misterio familiar** que se reconstruye pieza a pieza por todo el mapa.

## 2. Ambientación: el Valle de Arnós

Valle fronterizo gobernado de facto por el **conde Beltrán de Ubeda**, que se hizo con él hace 31 años cuando la **Casa de Olmedo** fue acusada de traición y exterminada. Desde entonces: impuestos altos, soldados del conde en los caminos, y bandidos (antiguos soldados licenciados) en los bosques del norte.

### Mapa (tamaño medio, ~2 × 2 km, denso)

| Lugar | Función | Estado |
|---|---|---|
| **Robledo** (pueblo principal) | Casa del jugador. Plaza, herrería, taberna *El Jabalí Cojo*, iglesia de San Millán, mercado, granero, establos, campos, empalizada parcial, torre de vigilancia | Vertical slice (parcial) |
| **Valdeolmo** | Agrícola, pequeño, molino de agua en el río | Fase 3 |
| **Hontanar** | Aldea de cazadores y leñadores en el bosque del oeste | Fase 3 |
| **Almenara** | Villa comercial en el cruce del camino real, mercado grande, juez del rey | Fase 4 |
| **Olmedilla** | Semiabandonada al pie de las ruinas del castillo de **Peñaseca** (antigua sede Olmedo) | Fase 5 |
| Bosque de Robledo | Caza, madera, lobos de noche | Slice |
| **Cueva del Cuervo** | Primera pista del tesoro | Slice |
| Campamento de **Los Cuervos** (bandidos) | Origen de los ataques a Robledo | Slice |
| Río Arnós, puentes, sierra del norte, minas, criptas, torres en ruinas, granjas aisladas | Exploración | Fases 3–5 |

## 3. Historia principal: el Arca de Olmedo

**El secreto.** El padre del jugador, conocido como **Rodrigo Varga** (antiguo capitán de mercenarios y luego tratante de lana), era en realidad **Rodrigo de Olmedo**, último hijo superviviente de la casa exterminada. Durante años buscó el **Arca de Olmedo**, escondida por su abuelo antes de la caída. El Arca no es "oro enterrado": contiene
- el **privilegio rodado** con sello real que otorga el valle a los Olmedo,
- las **cartas que prueban que la acusación de traición fue falsificada** por Beltrán de Ubeda con ayuda de un clérigo,
- el anillo-sello de la casa y la plata del linaje.

Rodrigo encontró las pistas, las repartió por el valle para que nadie pudiera reunirlas de golpe, y desapareció hace siete años perseguido por los hombres del conde. El jugador (**Martín**) es **el último heredero**.

**Etapas (10)**
1. **Descubrir que existe** — carta escondida bajo la tabla suelta de la choza. *(slice)*
2. **Primera pista** — la Cueva del Cuervo: el zurrón de Rodrigo con el 1.er fragmento de mapa y una ficha con un emblema. *(slice)*
3. **Investigar al familiar** — Gil el cazador (amigo de Rodrigo) cuenta su pasado de mercenario; el padre Anselmo **miente** sobre el emblema. *(slice: inicio)*
4. **Otros lugares** — registros de la iglesia (robables de noche), la granja de los Merino, el molino de Valdeolmo.
5. **Mapas** — 4 fragmentos: cueva, molino, campamento de bandidos, torre en ruinas.
6. **NPCs** — la vieja criada de los Olmedo en Olmedilla; un mercader de Almenara que compró lana a Rodrigo.
7. **Objetos antiguos** — el anillo roto, la llave de bronce de la cripta.
8. **La conspiración** — el padre Anselmo fue quien redactó la falsa acusación; el capitán del conde vigila Olmedilla.
9. **La zona final** — las catacumbas bajo Peñaseca, con trampas y los hombres del conde.
10. **El tesoro** — el Arca. Decisión final: llevar el privilegio al juez real de Almenara (justicia, el valle cambia: impuestos, patrullas, reputaciones) o quedarse la plata y callar. El mundo sigue jugable después.

## 4. Sistemas

### 4.1 Tiempo y día/noche
- 1 día de juego = **40 min reales** (configurable). Reloj visible solo en el diario.
- Día: NPCs trabajan, tiendas abiertas, patrullas, ciervos. Noche: casi todos en casa, guardia nocturna, lobos, más bandidos, oscuridad real fuera de las zonas iluminadas (antorchas, hogueras, ventanas).

### 4.2 Supervivencia (moderada)
| Necesidad | Baja en | Efecto al bajar |
|---|---|---|
| Hambre | ~1,5 días | < 25 %: stamina máx. reducida; 0: pierde salud lentamente |
| Sed | ~1 día | < 25 %: stamina se recupera más lento; 0: pierde salud |
| Temperatura | Según noche, lluvia, altitud, cueva, ropa, fuego | Frío: stamina lenta; helado: pierde salud |
| Stamina | Correr, atacar, bloquear, esquivar, tensar arco | Sin stamina no se ataca ni se esprinta |
| Salud | Daño | Se regenera despacio solo con hambre y sed > 50 % |

Acciones: comer, beber (río, pozo, odre), cocinar (hogar o fogata), dormir (cama: salta hasta la mañana, autoguarda), descansar (esperar 1 h), encender fuego, recoger recursos.

### 4.3 Inventario
- Límite por **peso** (30 kg base). Pilas por tipo.
- Equipo: mano derecha (arma/herramienta), mano izquierda (escudo **o** antorcha), cabeza, torso. Arco/lanza a dos manos (no permiten antorcha).
- Accesos rápidos 1–4.
- Objetos del mundo = cuerpos físicos: **agarrar/transportar/soltar/lanzar/empujar**; guardarlos tiene animación de mano.
- Propiedad: coger algo ajeno a la vista de alguien es **robo**.

### 4.4 Combate
- Ataque ligero (clic), ataque fuerte (mantener clic), bloqueo (clic derecho), esquiva (C + dirección), patada (F) para romper guardias.
- Fases de ataque: preparación → golpe activo → recuperación. Durante el golpe activo se barre el filo contra **hitboxes** (cabeza ×2, torso ×1, extremidades ×0,6 y ralentiza).
- Bloquear frontal consume stamina según el golpe; si se agota, **aturdimiento**.
- Armadura reduce según tipo de daño (corte / contundente / perforante).
- Peso: balanceo de cámara, inercia del arma, "hit-stop" breve en impactos, sacudida.
- Arco: tensar consume stamina; flecha con gravedad; se pueden recuperar.
- **Armas de pólvora** (fase 4): arcabuz y pistola de mecha; muy raras, recarga ~12 s en varios pasos, humo denso, retroceso, dispersión alta, munición escasa.

### 4.5 NPCs
Cada NPC: nombre, oficio, casa, lugar de trabajo, **agenda** propia, relaciones, inventario, diálogo y facción. Estados: rutina, conversación, huida, refugio, combate, muerto (persistente).

### 4.6 Reputación
- Independiente por pueblo, −100..100. Niveles: Hostil, Desconfiado, Neutral, De confianza, Honrado.
- Sube: ayudar, misiones, comerciar, defender. Baja: robar, agredir, matar ganado, fallar misiones, ayudar a enemigos.
- Efectos: precios, información (algunos NPCs solo hablan con gente de confianza), comerciantes que no te venden, guardias hostiles.

### 4.7 Misiones
Tipos: historia, secundarias, tareas del pueblo, defensa, exploración, caza, comercio, búsqueda, rescate, escolta. Definidas como datos con objetivos: hablar, recoger, entregar, ir a, leer, matar tipo, evento.

### 4.8 Economía
Moneda: **maravedí (mrv)**. Precios orientativos: pan 3, manzana 1, odre 6, flecha 2, hacha 45, arco 70, espada 160, piel de ciervo 14, carne cruda 4, madera 2. Venta al comerciante 40–60 % del valor según reputación. Comerciantes con dinero y stock limitados que se reponen cada mañana.

### 4.9 Defensa de la aldea (sistema clave)
1. El **director de eventos** decide un ataque (probabilidad diaria creciente, más de noche/niebla, cooldown).
2. Los atacantes **aparecen en su campamento** (lejos y fuera de vista) y **viajan** por el mundo hasta un punto de reunión.
3. Exploran y se acercan. Cuando el vigía (o cualquier guardia) los ve: **campana de alarma** y aviso "¡ENEMIGOS AL NORTE!" (dirección real).
4. Guardias cogen armas y van a sus puestos (entradas). Aldeanos corren a casa y cierran. El jugador decide qué hacer: torre, puerta, calle, primera línea, arco, apagar incendios.
5. Atacantes: combaten, intentan **incendiar/saquear** edificios.
6. **Moral**: si pierden al cabecilla o la mitad del grupo, **se retiran** a su campamento.
7. **Consecuencias persistentes**: éxito → reputación, recompensa, precios; fracaso → edificios dañados (reparación con madera), NPCs muertos (para siempre), comerciante ausente varios días, misiones que cambian.

### 4.10 Fauna
Ciervo (huye), jabalí (ataca si se siente amenazado), lobo (manada nocturna, caza), zorro, ganado (vaca, oveja, cabra, gallina), perro, caballo. Caza: huellas, carne, piel. Matar ganado ajeno = delito.

### 4.11 Clima
Despejado, nublado, niebla, lluvia, tormenta; transiciones graduales. Lluvia: menos visibilidad, barro, frío, otro ambiente sonoro. Niebla: menor visión para todos (IA incluida), más peligro.

### 4.12 Casa del jugador
Nivel 1 choza (cama, arcón, hogar) → Nivel 2 casa de madera (más almacenamiento, mesa de trabajo) → Nivel 3 casa grande con taller. Mejoras con dinero + materiales, encargadas al carpintero. Sistema secundario.

### 4.13 Caballos (fase 4)
Comprar/encontrar, montar, stamina propia, establo. Sin viaje rápido.

### 4.14 Interfaz
HUD mínimo que aparece solo cuando hace falta (barras al cambiar, necesidades solo si bajas). Inventario, diario, mapa de pergamino con lo descubierto, diálogo, comercio, lector de documentos.

## 5. Controles (teclado/ratón)

| Acción | Tecla |
|---|---|
| Mover / correr / agachar / saltar | WASD / Shift / Ctrl / Espacio |
| Interactuar / guardar objeto | E |
| Agarrar / soltar objeto físico | R (mantener para transportar) |
| Lanzar objeto transportado | Clic izq. mientras transportas |
| Ataque ligero / fuerte | Clic izq. / mantener clic izq. |
| Bloquear / apuntar | Clic der. |
| Esquivar | C + dirección |
| Patada | F |
| Antorcha (mano izq.) | T |
| Armas rápidas | 1–4 |
| Inventario / Diario / Mapa | Tab o I / J / M |
| Pausa, guardar/cargar | Esc |
| Rendimiento | F3 |
