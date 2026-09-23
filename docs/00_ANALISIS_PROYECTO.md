# 00 · Análisis del proyecto (estado inicial)

Fecha del análisis: inicio del desarrollo.

## Qué había en el repositorio

| Elemento | Estado |
|---|---|
| Commits | Ninguno (repositorio recién creado, rama `claude/vigilant-ritchie-7n3t28`) |
| Código fuente | Ninguno |
| Motor / framework | Ninguno |
| Assets (modelos, texturas, audio) | Ninguno |
| Documentación | Ninguna |

**Conclusión:** proyecto en blanco. No hay ningún motor que respetar ni código que migrar; la elección de tecnología es nuestra.

## Restricciones reales del entorno de desarrollo

Se comprobaron antes de decidir nada:

| Recurso | Resultado | Consecuencia |
|---|---|---|
| Registro npm | Accesible | Se pueden usar librerías JS/TS |
| Descargas de GitHub Releases | Bloqueadas (HTTP 403) | No se pueden descargar binarios de Godot / Unity / Unreal |
| GPU | No hay; Chromium trae renderizado WebGL por software (SwiftShader) | Se puede renderizar y capturar imágenes, pero muy despacio |
| Chromium + Playwright | Preinstalados | Se pueden hacer pruebas end-to-end automatizadas de verdad |
| Node 22, Python 3.11 | Disponibles | Herramientas de build y test |
| CPU / RAM | 4 núcleos, 15 GB | Suficiente |

## Decisión de motor

Ver `docs/DECISIONES.md` (ADR-001). Resumen:

**TypeScript + Three.js (render) + Rapier 3D (física, WASM) + Vite (build).**

Motivo principal: es la única pila con la que puedo **construir y verificar** el juego en este entorno. Con Godot/Unity/Unreal no podría ni ejecutar el editor ni probar el resultado, así que estaría entregando código que no he visto funcionar, y eso va contra la regla fundamental del proyecto (no simular que algo funciona).

Esto **no** convierte el proyecto en "una web que simula un juego": es un juego 3D en tiempo real con bucle de juego, física de cuerpos rígidos, controlador de personaje, IA, guardado persistente, etc. El navegador es solo la plataforma de ejecución, igual que lo es un ejecutable nativo. Se puede empaquetar como aplicación de escritorio (Electron o Tauri) sin cambiar el código del juego (ver roadmap, fase 7).

## Limitaciones asumidas con honestidad

- **Sin assets artísticos externos**: todos los modelos (personas, animales, edificios, armas), las texturas y los sonidos se generan de forma procedural y son **placeholders identificados como tales** (`src/engine/placeholder/` y `docs/ASSETS.md`). La arquitectura permite sustituirlos por glTF / texturas PBR / muestras de audio sin tocar la lógica.
- **La calidad visual "AAA independiente" depende de arte real.** Con placeholders procedurales se prioriza iluminación, atmósfera y coherencia (ciclo día/noche, niebla, sombras, fuego) antes que el detalle geométrico.
- **Pruebas visuales lentas**: la GPU por software hace que las pruebas automáticas rindan a pocos FPS. El rendimiento real se mide con el overlay de rendimiento (`F3`) en una máquina con GPU.
