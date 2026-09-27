# Estado del vertical slice

Resumen honesto de lo que funciona, cómo se ha verificado y qué falta.

## Verificación

| Tipo | Cómo | Resultado |
|---|---|---|
| Tipos | `npm run typecheck` (TS estricto) | Sin errores |
| Unitarias | `npm test` (Vitest): terreno, transformaciones, inventario, necesidades, misiones, reputación, guardado, navegación, trazado del pueblo y la costa, multijugador | 31/31 |
| E2E | `npm run e2e`: el juego real en Chromium (WebGL por software) dirigido por `window.__game` | 26/26 |
| E2E multijugador | `node e2e/mp.mjs <url>`: dos jugadores en dos pestañas | 23/23 |
| Build | `npm run build` | Correcto (JS ~3,7 MB, 1,3 MB gzip; incluye el WASM de Rapier) |

Escenarios E2E (todos juegan sobre los sistemas reales, sin simulaciones):
arranque · coger el hacha de la mesa · agarrar/transportar/lanzar · tabla suelta → carta · diálogo con Gil (botones reales) · cueva oscura con antorcha → zurrón · el cura miente · talar un árbol → troncos físicos → misión de la empalizada → reparación al alba · hambre/sed/frío · combate con daño localizado y bloqueo · ataque de bandidos completo (viaje desde el campamento, avistamiento, campana, guardias a sus puestos, vecinos a casa, retirada por moral, consecuencias) · ciervos que huyen y lobos nocturnos · rutinas por hora (el herrero va al yunque y martillea, el vigía sube a la torre, se encienden las antorchas) · caza con arco y despiece · asalto real con incendio apagado con cubos · comercio y precios por reputación · arcón y dormir hasta el alba · síntesis de todos los sonidos · muerte · guardado y carga tras recargar la página.

## Móvil y versión publicada

- **Controles táctiles** (`ui/TouchControls.ts`): joystick dinámico a la izquierda, arrastrar para mirar, botones de atacar (mantener = fuerte / tensar arco, arrastrando se apunta), bloquear, usar, saltar, esquivar, patada, agarrar, antorcha, cambio de arma, correr y agacharse (fijos), inventario, diario, mapa y pausa. Botón ✕ en las pantallas. Se activan solos en pantallas táctiles, con calidad baja por defecto. Prueba: `node e2e/touch.mjs <url>?debug` (emulación de móvil en horizontal).
- **Un solo archivo**: `node scripts/build-artifact.mjs` genera `artifact/the-last-heir.html` (JS, CSS y WASM en línea, ~3,7 MB) para publicarlo como página sin servidor.

## Multijugador (hasta 5 por servidor)

Implementado sobre las capacidades de la página publicada en claude.ai (`src/net/Net.ts`, `src/net/Multiplayer.ts`, `src/ui/MultiplayerUI.ts`):

- **Servidor** = mundo compartido con id propio. Menú «Jugar con amigos»: crear servidor, unirse con enlace/código, «Tus servidores». Enlace de invitación `…/artifact/<id>#s-<servidor>` con botón de copiar en la pausa.
- **Tiempo real**: sala con nombre por servidor (`room.join`). Cada jugador publica su presencia ~10 veces/s (posición, mirada, animación, herramienta, antorcha, barca) y en ella una cola numerada de acciones (talar y picar) y el chat. Los demás aplican las acciones de forma idempotente; tras un corte se sigue por el último número aplicado.
- **Límite de 5**: al entrar se cuentan los conectados a la sala; con 5 se rechaza con un aviso.
- **Persistencia**: `worlds/<servidor>` (construcciones, árboles talados, rocas, barcas, hora, tiempo, miembros) lo escribe un único «guardián» (el jugador con permiso de escritura de menor id de conexión) 2 s después de cada cambio y cada 30 s. La partida personal va a `data/users/<usuario>/w_<servidor>` (privado) y a una copia local; al entrar se usa la más reciente.
- **Hora y tiempo** los marca el dueño del servidor si está conectado; si no, el de menor id.
- Otros jugadores se ven como personas con su herramienta, antorcha (con luz real), nombre encima y animación; se les ve remar.
- **Permisos** (los pone la plataforma): quien tiene la página compartida como «Puede interactuar» (colaborador) juega y guarda; los invitados de fuera de la organización con acceso de solo lectura pueden jugar y verse, pero no escribir la base de datos: su partida se guarda en su navegador y el mundo lo guarda otro jugador con permiso.
- **Prueba**: `node e2e/mp.mjs <url>` abre dos jugadores en dos pestañas con el transporte local (`?mplocal`): invitación por enlace, servidor lleno con 5, verse y moverse, construir/desmontar, talar, picar, chat, hora común, mundo guardado, volver a entrar con inventario y mundo, «Tus servidores», enlace en la pausa.

**Lo que no se sincroniza** (cada cliente lo simula por su cuenta): vecinos y sus rutinas, animales, asaltos de bandidos, objetos sueltos en el suelo (troncos, tablones, flechas), el contenido de los arcones y la historia/misiones de cada jugador. Los otros jugadores no chocan físicamente contigo ni se puede combatir entre jugadores. La parcela es una sola y se comparte en cada servidor. Fuera de claude.ai (archivo local) el multijugador no está disponible y el menú lo dice.

## Puertas, objetos y materiales

- Las puertas sin llave se abren al caminar contra ellas (además de con E/Usar); la de la choza empieza abierta. Las cerradas con llave siguen cerradas.
- Las herramientas y armas largas que se sueltan o están colocadas sobre muebles reposan tumbadas por su cara ancha (hoja plana), salvo las que cuelgan de un astillero.
- Madera (suelos, mesas, puentes): veta fina y larga, tono por tabla, desgaste de paso, suciedad en juntas, clavos. Enlucido de cal con humedad desde el suelo y desconchones pequeños; zarzo con barro y paja casi continuo, con grietas finas; mampostería con piedras de varios tamaños, junta rehundida y líquenes. Dentro de casa la luz rebotada es cálida.

## Vecinos, heridas y cuerpos

- **Vecinos con vida propia**: cada uno tiene su postura de reposo (brazos cruzados, manos a la espalda, mano en la cadera…), su ritmo, carga el peso en una pierna, mira alrededor, se gira hacia quien tiene cerca y da paseos cortos alrededor de su sitio antes de volver.
- **Heridas por zonas** (golpes del jugador con armas de filo o punta a personas; `combat/Wounds.ts`): cabeza → decapitación (con cuchillo en golpe ligero, degüello); brazo → se cercena, cae de rodillas apretándose el muñón y se desangra vivo unos 25–30 s; pierna → se cercena y cae; torso → cae herido de muerte. El miembro cortado es un cuerpo físico con la ropa y la piel de esa persona (rueda, se agarra), el muñón gotea y crece un charco que se amolda al suelo. Rematar a un herido lo mata. Las armas contundentes siguen con el daño normal.
- **Esconder cuerpos** (`social/Bodies.ts`): los cuerpos (y los moribundos) se cargan al hombro con R (animación de agacharse y echárselo encima) y se dejan en el suelo con otra animación, buscando un hueco donde quepan tendidos sin atravesar paredes, muebles ni el suelo. Si nadie te ve (testigo o la víctima en pie para contarlo), el crimen queda pendiente y **no baja la reputación**; solo se castiga si un vecino o guardia llega a ver el cuerpo (distancia según la luz y línea de vista real) o si al dormir quedó cerca de donde vive y trabaja la gente. **Dentro de una casa** solo lo descubre quien entra en ella (su dueño, quien trabaja allí): en tu choza, o en la casa de alguien que ya no vive, nadie lo encuentra; desde fuera no se ve a través de las paredes (sí por una puerta abierta). En agua honda el cuerpo flota unos segundos y se hunde poco a poco; hundido ya no se encuentra. La posición del cuerpo, los miembros cortados y el crimen pendiente se guardan.

## Remates, animaciones y heridas

- **Remate por la espalda** (`combat/Takedown.ts`, tecla **G** / botón «Remate» en móvil, solo aparece cuando se puede): acercándote por detrás a alguien que no está peleando, huyendo ni hablando contigo. Con cuchillo, espada, hacha o lanza: le sujetas la frente y le degüellas (chorro arterial, se lleva las manos al cuello, cae de rodillas y muere). Con las manos vacías: le rompes el cuello de un giro seco (crujido; la cabeza queda girada). La víctima queda sujeta sin IA ni colisión durante la animación. Las consecuencias son las de cualquier asesinato: testigos que corren a contarlo o crimen pendiente si nadie lo ve.
- **Animaciones en primera persona** (`player/Viewmodel.ts`, fotogramas clave para cada mano): recoger y guardar en el zurrón, comer (se ve la comida en la mano y los bocados), beber del odre, degollar y romper el cuello.
- **Golpe mortal**: un instante a cámara lenta y sacudida. **Talar**: astillas que saltan, el filo se clava un instante en la madera. **Muertes**: caen de espaldas o se les doblan las rodillas y caen de bruces.
- **Heridas más realistas**: el corte tiene carne desgarrada irregular, borde de piel empapado, hueso que asoma y goterones (en el cuello, también la tráquea); la cabeza cortada tiene cara (nariz, orejas, párpados caídos, boca entreabierta). Los muñones manan a borbotones al ritmo del corazón, cada vez más débil, y los cortes salpican manchas de sangre en el suelo.

## Mundo vivo

- **29 vecinos** (10 nuevos: los Pardo, Simón el cestero, Martín el leñador, los Ibáñez pastor y tejedora, el guardia Íñigo, Vasco el pescador, Beatriz la moza de la taberna y Ramiro el buhonero), cada uno con casa, oficio, horario y conversación (oficio, rumores, comercio si vende). Cuando varios van al mismo sitio se colocan en corro en vez de amontonarse.
- **Prado cercado con 7 ovejas** de Lope (pastan en rebaño, se asustan y corren dentro de la cerca; matarlas a la vista de alguien es delito; se despiezan con cuchillo), abrevadero y almiares.
- **Rincones nuevos**: carbonera humeante con la tienda del carbonero, refugio de cazador con lumbre, pieles y flechas, casa en ruinas con huesos y un arcón chamuscado, tres cruceros de piedra en los caminos, espantapájaros en los campos, colmenas, carro del buhonero en la plaza, lavadero en el arroyo.
- **Suelo**: juncos y eneas en las orillas del arroyo, cantos rodados en el cauce, tocones y corros de setas en el bosque.
- **Arroyo**: orillas irregulares con talud suave (sin escalón), ribazo donde el llano queda más bajo que el agua (antes el agua "flotaba"), lecho de grava y cantos bajo el agua; el agua casi no tiene color propio: refleja el cielo y las orillas (Fresnel), deja ver el fondo en lo somero, se oscurece en las pozas, la corriente va más rápida en el centro y hay espuma solo en los rápidos.
- **Día de 30 minutos reales** (antes 40).

## Accesos, puertas y objetos soltados

- **Escalones de piedra** delante de la entrada de toda casa o cobertizo cuyo suelo quede alto respecto al terreno (casas en ladera, barrio del puerto): peldaños de ≤ 18 cm con colisión que bajan hasta tocar el suelo (hasta 26 en las laderas más fuertes). En cobertizos abiertos, a lo ancho del frente. 23 edificios los tienen.
- Las puertas se abren **hacia el lado contrario de quien entra** (antes se abrían siempre hacia fuera y desviaban al jugador en el umbral).
- Soltar un objeto desde el inventario lo deja delante de la pared (no al otro lado) y alineado con la mirada; y si algo acaba bajo el suelo o el terreno (colisión atravesada), vuelve a su último sitio válido.
- La resolución dinámica viene activada solo en móviles/tabletas y no baja del 70 % (en PC se veía borroso).

## Barca y rendimiento

- La barca se dibuja interpolada entre pasos de la simulación (antes se movía a 30 pasos/s y la cámara no: temblaba al remar).
- Calidad baja (móviles): sin MSAA, terreno lejano y mar con menos polígonos, la mitad de matas de cereal (ahora más ligeras en todas las calidades) y personas dibujadas hasta 85 m. Medido en el bosque: de ~984 000 a ~640 000 triángulos.
- **Resolución dinámica** (Opciones; activada por defecto en móviles): si la imagen baja de ~26 FPS la resolución interna baja en pasos hasta el 70 %, y se recupera cuando sobra.

## Calidad visual (placeholders mejorados)

Texturas generadas en GPU a 512–1024 px; terreno con mezcla por altura, normales de detalle, anti-repetición, suelo de bosque, roca triplanar, nieve en cumbres y charcos con lluvia; árboles con follaje de tarjetas y viento; hierba con variantes (espigas, seca, flores); rocas, arbustos, helechos y ramas caídas; edificios con entramado, marcos, contraventanas, cumbreras, tablas de remate y oclusión horneada; personas con rostro, pelo, tocados y tejidos; armas con perfiles biselados (lanza y maza con modelo propio); iluminación del cielo (IBL) regenerada según hora y nubes.

## Rendimiento

Medido en la vista más densa del pueblo (plaza, 11:00, calidad media):

| Métrica | Valor |
|---|---|
| Draw calls | ≈420–440 en total (pase principal + sombras; medido en `e2e/scenes.mjs`) |
| Triángulos | ≈520–590 k (árboles con follaje de tarjetas) |
| Luces dinámicas | 8 (pool) para decenas de fuentes |
| Personajes | 1 draw call cada uno (SkinnedMesh rígido) |
| Mobiliario estático | fusionado por material y celda de 48 m |
| Árboles | ~6 draw calls para miles de árboles (instanciado + 2 LOD) |
| Hierba | 1 draw call, hasta 16 000 matas alrededor de la cámara |
| Detalle de suelo | 7 draw calls (rocas, arbustos, helechos, ramas, juncos, tocones, setas) |

Los FPS medidos en este entorno (4–18) corresponden a renderizado **por software** (SwiftShader) y no son representativos; el overlay `F3` muestra las métricas en una máquina con GPU.

Optimizaciones activas: streaming de terreno por chunks con LOD y faldones, colliders solo cerca, malla lejana para el horizonte, LOD de simulación de NPCs (1/6/30 ticks), LOD de sombras de personajes, culling de emisores de partículas, pool de luces, batching estático, instanciado de vegetación/estacas/cultivos, física con cuerpos dormidos.

## Limitaciones conocidas (no ocultas)

- **Arte y audio son placeholders procedurales** (ver `ASSETS.md`). La calidad visual objetivo "AAA independiente" requiere arte real (fase 6).
- **Animación de personajes procedural** por poses sobre un esqueleto rígido; legible pero no natural. Preparado para `AnimationMixer` + glTF.
- **Voces**: los NPCs "hablan" con subtítulos; no hay voces grabadas.
- **Navegación** por grafo de visibilidad con muros finos: en esquinas cerradas un NPC puede rozar una pared visualmente.
- **Solo Robledo** (con barrio del puerto, arrabal sur y 29 vecinos), la costa y tres islas están construidos; el resto del valle (otros pueblos, río Arnós, Almenara, Peñaseca) es terreno y bosque. La misión principal llega a la **etapa 3 de 10** y su último objetivo (Valdeolmo) está marcado en el diario como contenido de la fase 3.
- **Sin caballos ni armas de pólvora** todavía (fase 4); la arquitectura de armas (fases, tipos de daño) ya contempla recarga lenta y dispersión.
- **Interiores**: todas las casas son visitables y están amuebladas (camas, mesa con comida, arcón con cosas, barriles, hogar encendido cuando hay alguien); de noche las casas ocupadas se cierran con llave.
- **Sin mando** ni reasignación de teclas en la UI (el sistema de acciones ya lo permite).

## Próximo paso recomendado

Fase 2 del roadmap: profundizar sistemas (cocina y fogatas colocables, durabilidad, habilidades con efectos visibles, huellas rastreables de todas las especies, incendios propagables, mejora de la casa a nivel 2) antes de ampliar el mapa.
