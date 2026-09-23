# Registro de decisiones técnicas (ADR)

## ADR-001 · Motor: TypeScript + Three.js + Rapier + Vite

**Contexto.** Repositorio vacío. Entorno sin GPU, sin acceso a binarios de motores comerciales, con npm y Chromium disponibles.

**Opciones valoradas**

| Opción | Pros | Contras en este proyecto |
|---|---|---|
| Unreal 5 | Calidad visual máxima | No se puede instalar ni probar aquí. Blueprints/C++ sin poder compilar = código no verificado |
| Unity | Ecosistema enorme | Igual: sin editor, sin build, sin verificación |
| Godot 4 | Libre, escenas en texto | Binario no descargable (GitHub bloqueado); sin probarlo, sería código a ciegas |
| **Three.js + Rapier (TS)** | Se ejecuta y se prueba aquí; física real (Rapier = motor Rust); tipado estricto; empaquetable a escritorio | Hay que construir a mano sistemas que otros motores traen (animación, navmesh, editor). Techo visual inferior a Unreal |

**Decisión.** Three.js 0.186 (render WebGL2), Rapier 0.20 (física y controlador de personaje), TypeScript 5.9 estricto, Vite 7, Vitest para tests unitarios, Playwright para tests E2E.

**Consecuencias.** Todo sistema se puede probar de forma automática. La lógica de juego se escribe desacoplada del render cuando es posible, para poder testearla en Node sin WebGL.

## ADR-002 · Arquitectura de "sistemas" + bus de eventos, sin ECS completo

Un ECS puro añade complejidad sin beneficio real para ~100 entidades activas. Se usa:

- **Sistemas** (clases con `update(dt)`) registrados en `Game`, que se ejecutan en orden fijo.
- **EventBus tipado** para comunicación desacoplada (misiones, reputación, audio y UI escuchan eventos del mundo; nadie llama directamente a la UI desde la lógica).
- **Datos del juego declarativos** (`src/data/`): objetos, NPCs, diálogos, misiones y documentos son datos, no código.

## ADR-003 · Simulación a paso fijo

La física y la lógica van a **30 Hz fijos** (acumulador). El render interpola y corre a la frecuencia del monitor. Motivos: determinismo, física estable, IA barata.

## ADR-004 · Terreno analítico + chunks con streaming

La altura del terreno es una **función determinista** `heightAt(x, z)` (ruido + rasgos modelados: explanadas de pueblos, caminos excavados, cauce del río, montañas). Ventajas:
- La IA consulta la altura sin raycasts.
- Mallas visuales y colliders (heightfield de Rapier) se generan por chunk bajo demanda y se descargan al alejarse (**streaming**), con **LOD** por distancia y faldones para ocultar grietas.

## ADR-005 · NPCs con LOD de simulación

- **Cerca (< 60 m)**: IA completa cada tick, animación completa, percepción.
- **Media (60–160 m)**: IA a 5 Hz, animación simplificada.
- **Lejos (> 160 m)**: simulación abstracta a 1 Hz (avanzan por su ruta de la agenda, sin malla visible ni física).
- Entrar en una casa = el NPC queda "dentro" (oculto) y la ventana se ilumina de noche. Así la gente vive su rutina aunque el jugador no mire, con coste casi nulo.

## ADR-006 · Luces dinámicas con pool

Puede haber decenas de antorchas/hogueras, pero WebGL penaliza cada luz dinámica. Se usa un **pool fijo de luces puntuales** (8) asignadas cada pocos frames a las fuentes de luz más cercanas/relevantes a la cámara; el resto se ven con halo emisivo. Resultado: noche oscura de verdad con islas de luz, a coste constante.

## ADR-007 · Audio procedural con arquitectura para muestras reales

No hay samples. `AudioEngine` genera en WebAudio: viento, pájaros, grillos, agua, fuego, pasos por superficie, choque metálico, cuerda de arco, campana de alarma, lluvia y truenos. Cada sonido se pide por **id lógico** (`sfx.sword_clash`), así que sustituirlo por un fichero `.ogg` es cambiar una entrada de tabla.

## ADR-008 · Guardado en localStorage versionado

Cada sistema implementa `Saveable` (`serialize()` / `deserialize()`). El `SaveSystem` compone un documento JSON versionado con migraciones. Slots: autoguardado + 3 manuales. En la versión escritorio se cambia el backend a fichero sin tocar los sistemas.

## ADR-009 · Interacción física

Los objetos del mundo son cuerpos rígidos de Rapier. El jugador puede **agarrar y transportar** (el objeto sigue un punto delante de la cámara mediante velocidad, choca con el entorno), **soltar**, **lanzar** y **empujar** (el controlador de personaje aplica impulsos). Guardar en el inventario lleva una animación de mano que alcanza el objeto; nada "desaparece" sin transición.

## ADR-010 · Idioma

Código e identificadores en inglés (convención de la industria). Textos del juego, documentación y comentarios en español.
