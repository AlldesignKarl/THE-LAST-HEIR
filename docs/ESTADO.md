# Estado del vertical slice

Resumen honesto de lo que funciona, cómo se ha verificado y qué falta.

## Verificación

| Tipo | Cómo | Resultado |
|---|---|---|
| Tipos | `npm run typecheck` (TS estricto) | Sin errores |
| Unitarias | `npm test` (Vitest): terreno, transformaciones, inventario, necesidades, misiones, reputación, guardado, navegación | 27/27 |
| E2E | `npm run e2e`: el juego real en Chromium (WebGL por software) dirigido por `window.__game` | 21/21 |
| Build | `npm run build` | Correcto (JS ~3,7 MB, 1,3 MB gzip; incluye el WASM de Rapier) |

Escenarios E2E (todos juegan sobre los sistemas reales, sin simulaciones):
arranque · coger el hacha de la mesa · agarrar/transportar/lanzar · tabla suelta → carta · diálogo con Gil (botones reales) · cueva oscura con antorcha → zurrón · el cura miente · talar un árbol → troncos físicos → misión de la empalizada → reparación al alba · hambre/sed/frío · combate con daño localizado y bloqueo · ataque de bandidos completo (viaje desde el campamento, avistamiento, campana, guardias a sus puestos, vecinos a casa, retirada por moral, consecuencias) · ciervos que huyen y lobos nocturnos · rutinas por hora (el herrero va al yunque y martillea, el vigía sube a la torre, se encienden las antorchas) · caza con arco y despiece · asalto real con incendio apagado con cubos · comercio y precios por reputación · arcón y dormir hasta el alba · síntesis de todos los sonidos · muerte · guardado y carga tras recargar la página.

## Móvil y versión publicada

- **Controles táctiles** (`ui/TouchControls.ts`): joystick dinámico a la izquierda, arrastrar para mirar, botones de atacar (mantener = fuerte / tensar arco, arrastrando se apunta), bloquear, usar, saltar, esquivar, patada, agarrar, antorcha, cambio de arma, correr y agacharse (fijos), inventario, diario, mapa y pausa. Botón ✕ en las pantallas. Se activan solos en pantallas táctiles, con calidad baja por defecto. Prueba: `node e2e/touch.mjs <url>?debug` (emulación de móvil en horizontal).
- **Un solo archivo**: `node scripts/build-artifact.mjs` genera `artifact/the-last-heir.html` (JS, CSS y WASM en línea, ~3,7 MB) para publicarlo como página sin servidor.

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
| Detalle de suelo | 4 draw calls (rocas, arbustos, helechos, ramas) |

Los FPS medidos en este entorno (4–18) corresponden a renderizado **por software** (SwiftShader) y no son representativos; el overlay `F3` muestra las métricas en una máquina con GPU.

Optimizaciones activas: streaming de terreno por chunks con LOD y faldones, colliders solo cerca, malla lejana para el horizonte, LOD de simulación de NPCs (1/6/30 ticks), LOD de sombras de personajes, culling de emisores de partículas, pool de luces, batching estático, instanciado de vegetación/estacas/cultivos, física con cuerpos dormidos.

## Limitaciones conocidas (no ocultas)

- **Arte y audio son placeholders procedurales** (ver `ASSETS.md`). La calidad visual objetivo "AAA independiente" requiere arte real (fase 6).
- **Animación de personajes procedural** por poses sobre un esqueleto rígido; legible pero no natural. Preparado para `AnimationMixer` + glTF.
- **Voces**: los NPCs "hablan" con subtítulos; no hay voces grabadas.
- **Navegación** por grafo de visibilidad con muros finos: en esquinas cerradas un NPC puede rozar una pared visualmente.
- **Solo Robledo** está construido; el resto del valle (otros pueblos, río Arnós, Almenara, Peñaseca) es terreno y bosque. La misión principal llega a la **etapa 3 de 10** y su último objetivo (Valdeolmo) está marcado en el diario como contenido de la fase 3.
- **Sin caballos ni armas de pólvora** todavía (fase 4); la arquitectura de armas (fases, tipos de daño) ya contempla recarga lenta y dispersión.
- **Interiores**: la choza, la taberna y la iglesia son visitables; el resto de casas están cerradas (sus habitantes "entran" y las ventanas se iluminan).
- **Sin mando** ni reasignación de teclas en la UI (el sistema de acciones ya lo permite).

## Próximo paso recomendado

Fase 2 del roadmap: profundizar sistemas (cocina y fogatas colocables, durabilidad, habilidades con efectos visibles, huellas rastreables de todas las especies, incendios propagables, mejora de la casa a nivel 2) antes de ampliar el mapa.
