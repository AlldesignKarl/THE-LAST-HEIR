# Arquitectura técnica

## Pila
TypeScript 5.9 (strict) · Three.js 0.186 (WebGL2) · Rapier 3D 0.20 (WASM) · Vite 7 · Vitest · Playwright.

## Principios
1. **Lógica separada del render** cuando aporta: inventario, necesidades, agendas, misiones, reputación, economía, director de ataques y guardado son TS puro y se testean en Node.
2. **Datos declarativos** en `src/data/` (objetos, NPCs, diálogos, misiones, documentos, ubicaciones).
3. **Comunicación por eventos** (`EventBus` tipado). La UI y el audio escuchan; la lógica no conoce la UI.
4. **Composición en un único punto** (`Game.ts`): crea sistemas, inyecta dependencias, fija el orden de actualización.
5. **Coste acotado**: LOD de simulación, pools, streaming, culling, límite de luces.

## Estructura de carpetas

```
src/
  main.ts                 Arranque: carga fuentes, inicia Rapier, crea Game, menú
  game/Game.ts            Raíz de composición y bucle
  core/                   Infraestructura sin dependencias de juego
    EventBus.ts           Eventos tipados (GameEvents)
    GameLoop.ts           Paso fijo 30 Hz + render interpolado
    Input.ts              Teclado/ratón, pointer lock, acciones abstractas
    rng.ts, noise.ts, math.ts, Pool.ts
  engine/                 Servicios técnicos
    Renderer.ts           WebGLRenderer, tonemapping, sombras, resize
    Physics.ts            Mundo Rapier, grupos de colisión, consultas
    LightPool.ts          Pool de luces puntuales para fuentes de luz
    Particles.ts          Humo, chispas, sangre, polvo (pool)
    placeholder/          Texturas, materiales y modelos procedurales (PLACEHOLDERS)
  world/                  Mundo estático
    WorldLayout.ts        Datos del mapa: pueblos, caminos, río, POIs, zonas
    Heightfield.ts        heightAt(x,z) analítico (sin Three)
    Terrain.ts            Chunks con streaming, LOD y colliders
    Vegetation.ts         Árboles instanciados por chunk, talables
    Buildings.ts          Constructor procedural de edificios + colliders
    Settlement.ts         Construye un pueblo desde datos
    Cave.ts               Cueva (malla cerrada + collider trimesh)
    Water.ts              Río y agua bebible
    NavGraph.ts           Grafo de navegación + A*
  env/                    TimeOfDay, Sky, Weather, EnvironmentLighting
  player/                 Player, PlayerController, CameraRig, Viewmodel, Interaction, Carry
  items/                  ItemDefs (datos), Inventory, Equipment, WorldItems, Containers
  survival/               Needs
  combat/                 WeaponDefs, Damage, MeleeSystem, Projectiles, Hitboxes
  actors/                 Actor (salud/facción/hitboxes), HumanoidModel, AnimalModel
  ai/                     NPCManager, NPC, Schedule, Perception, Steering, CombatBrain
  animals/                AnimalManager, Animal
  social/                 Reputation, Crime, Dialogue
  quests/                 QuestSystem, Flags
  economy/                Economy, Trader
  events/                 EventDirector, RaidSystem
  audio/                  AudioEngine (procedural, ids lógicos), Ambience
  ui/                     UIManager, HUD, pantallas (inventario, diario, diálogo, comercio, mapa…)
  save/                   SaveSystem (versionado, slots, migraciones)
  debug/                  DebugAPI (consola y tests E2E), PerfOverlay
  data/                   items, npcs, dialogues, quests, documents, locations
tests/                    Vitest (lógica pura)
e2e/                      Playwright: arranca el juego real y ejecuta escenarios
docs/                     Documentación de diseño y técnica
```

## Bucle y orden de actualización (30 Hz fijo)

```
Input → TimeOfDay → Weather → PlayerController → Interaction/Carry
→ Combat (melee, proyectiles) → NPCManager (LOD) → AnimalManager
→ RaidSystem → EventDirector → Needs → Quests → Physics.step
→ (render) Streaming, Vegetation LOD, LightPool, Particles, Viewmodel, Audio, HUD
```

## Capas de colisión (Rapier InteractionGroups)

| Grupo | Uso |
|---|---|
| TERRAIN | Heightfields |
| STATIC | Edificios, rocas, troncos de árbol |
| PROP | Objetos dinámicos (barriles, cajas, objetos) |
| PLAYER | Cápsula del jugador |
| ACTOR | Cápsulas de NPCs/animales cercanos (kinemáticas) |
| PROJECTILE | Flechas (raycast por segmento, no cuerpo) |

## Presupuestos de rendimiento (objetivo con GPU media, 1080p, 60 FPS)

| Recurso | Presupuesto |
|---|---|
| Draw calls | < 300 pase principal, < 500 con sombras (medido: ~270 + ~190 en la plaza) |
| Luces puntuales activas | 8 (pool) |
| Sombras | 1 direccional (2048², sigue al jugador) |
| NPCs con IA completa | ≤ 12 simultáneos |
| Cuerpos dinámicos activos | ≤ 150 (el resto duermen) |
| Chunks de terreno cargados | radio 3 (7×7) en calidad media; más allá, malla lejana única |
| Personajes | 1 draw call cada uno (SkinnedMesh rígido, `engine/RigidSkin.ts`) |

## Guardado

`SaveSystem` pregunta a cada `Saveable` registrado (`id`, `serialize`, `deserialize`). Documento:

```json
{ "version": 1, "savedAt": "...", "playTime": 1234,
  "systems": { "time": {...}, "player": {...}, "inventory": {...}, "npcs": {...},
               "quests": {...}, "reputation": {...}, "world": {...}, "raids": {...}, ... } }
```

Persistencia del mundo: árboles talados (con fecha de rebrote), objetos recogidos y soltados, contenido de cofres, puertas, NPCs muertos, daños en edificios, historial de ataques, clima y hora.

## Pruebas

- `npm test`: tests unitarios de lógica (inventario, necesidades, agenda, misiones, reputación, economía, director de ataques, guardado, heightfield).
- `npm run e2e`: construye, sirve y abre el juego en Chromium real; usa `window.__game` (DebugAPI, solo con `?debug`) para ejecutar escenarios completos (misión, pista, ataque, guardado/carga), comprueba que no haya errores en consola y guarda capturas en `e2e/screenshots/`.
