# Roadmap de desarrollo

Regla: cada fase termina con pruebas (unitarias + E2E), revisión de rendimiento y sin errores conocidos abiertos.

## Fase 0 · Fundamentos ✅/⏳ (ver estado al final)
- Análisis, GDD, arquitectura, riesgos.
- Scaffold: Vite + TS estricto + Vitest + E2E con Playwright.

## Fase 1 · Vertical slice (objetivo actual)
Una zona completamente jugable alrededor de Robledo:

| Bloque | Contenido |
|---|---|
| Núcleo | Bucle fijo, input, render, física, bus de eventos, guardado |
| Mundo | Terreno por chunks (streaming+LOD), parte de Robledo (plaza, herrería, taberna, iglesia, casas, empalizada, torre), casa del jugador, camino, bosque, arroyo, cueva pequeña, campamento de bandidos |
| Entorno | Día/noche con iluminación real (sol, luna, antorchas, ventanas, hogueras), clima básico (despejado/nublado/niebla/lluvia) |
| Jugador | Movimiento FPS con física, stamina, necesidades, inventario, agarrar/transportar/lanzar/guardar, puertas y cofres |
| Combate | Espada, hacha (también tala), arco; ligero/fuerte/bloqueo/esquiva; hitboxes localizadas |
| NPCs | 9 habitantes con agenda, casa, oficio, diálogo; comerciante; guardias |
| Fauna | Ciervos (huyen) y lobos (manada nocturna) |
| Misión | "Madera para la empalizada" (carpintero) |
| Historia | Etapas 1–2 (+ inicio de la 3): carta oculta → Gil → Cueva del Cuervo → zurrón de Rodrigo → el cura miente |
| Defensa | Ataque de bandidos que viajan desde su campamento, alarma, guardias a sus puestos, aldeanos a casa, retirada por moral, consecuencias persistentes |
| Audio | Ambiente día/noche, pasos, combate, alarma (procedural) |

## Fase 2 · Profundidad de sistemas
- Cocina completa, fogatas colocables, odres, temperatura por ropa.
- Armaduras y escudos con durabilidad; lanza, maza, daga.
- Habilidades con uso (combate, caza, supervivencia, comercio).
- Huellas rastreables; jabalí, zorro, ganado, perros.
- Incendios propagables y extinción con cubos.
- Mejora de la casa nivel 2.

## Fase 3 · Mundo ampliado
- Valdeolmo (molino), Hontanar (cazadores/leñadores), río Arnós con puentes.
- Viajeros y patrullas en caminos; eventos de camino (emboscada, caravana, herido).
- Tormenta con rayos, viento que afecta a la vegetación.

## Fase 4 · Almenara y economía completa
- Villa comercial, precios regionales, conflicto entre pueblos.
- Caballos (comprar, montar, stamina, establo).
- Armas de pólvora raras (arcabuz, pistola de mecha).
- Casa nivel 3, alojamiento en posadas.

## Fase 5 · Historia completa
- Etapas 4–10 del Arca de Olmedo, Olmedilla, Peñaseca, catacumbas con trampas, final con decisión y mundo post-final.

## Fase 6 · Arte y audio reales
- Sustituir placeholders por modelos glTF con esqueleto y animaciones, texturas PBR, muestras de audio grabadas.
- Post-procesado (SSAO, bloom sutil), niebla volumétrica por froxels si el rendimiento lo permite.

## Fase 7 · Plataforma
- Empaquetado escritorio (Electron o Tauri), guardado a fichero, opciones gráficas, mando.
