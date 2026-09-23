# The Last Heir

Juego de supervivencia, exploración, combate y defensa de aldeas en primera persona, ambientado en un valle ficticio de la Península hacia 1497. Sin fantasía: aldeas, bosques, cuevas, bandidos, lobos y un misterio familiar — el Arca de Olmedo.

> Estado: **vertical slice jugable** (Fase 1 del [roadmap](docs/ROADMAP.md)). Modelos, texturas y sonidos son **placeholders procedurales** ([docs/ASSETS.md](docs/ASSETS.md)).

## Ejecutar

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build de producción en dist/
npm test           # tests unitarios (Vitest)
npm run e2e        # pruebas E2E en Chromium real (levanta su propio servidor; o GAME_URL=...)
```

Versión de un solo archivo (para publicar sin servidor, p. ej. en móvil): `node scripts/build-artifact.mjs` → `artifact/the-last-heir.html`.

Parámetros de URL: `?quality=low|medium|high`, `?debug` (expone `window.__game` para pruebas).

## Qué hay en el vertical slice

- **Robledo** (parte del pueblo principal): iglesia con campanario, taberna, herrería, carpintería, establo, granero, casas, mercado, pozo, empalizada con portón y una brecha, torre de vigilancia con escalera. Interiores en la choza del jugador, taberna e iglesia.
- **10 habitantes** con nombre, oficio, casa, agenda propia, diálogos (algunos mienten), comercio y reacciones. Los guardias patrullan, el vigía sube a la torre de noche.
- **Bosque, arroyo con puente, prado de ciervos, guarida de lobos, Cueva del Cuervo** (oscura: necesitas antorcha) y el **campamento de Los Cuervos**.
- **Día/noche** real: sol, luna, estrellas, antorchas que el pueblo enciende al anochecer, ventanas iluminadas según quién está en casa, hogueras. **Clima**: despejado, nublado, niebla, lluvia y tormenta, con efecto en visibilidad, frío y sonido.
- **Supervivencia moderada**: salud, stamina, hambre, sed, calor corporal. Comer, beber (pozo, arroyo, odre), cocinar, dormir, encender fuego.
- **Interacción física**: todo objeto del mundo es un cuerpo rígido. Se coge (con animación de mano), se agarra y transporta, se suelta, se lanza y se empuja. Robar a la vista tiene consecuencias.
- **Combate**: espada, hacha (también tala árboles), arco, cuchillo, maza, lanza, escudo. Ataque ligero/fuerte, bloqueo, esquiva, patada, daño localizado (cabeza, torso, extremidades), armadura, stamina, hit-stop y flechas físicas recuperables.
- **Fauna**: ciervos que pastan, se alertan y huyen (y dejan huellas); lobos en manada de noche que temen el fuego. Despiece con cuchillo.
- **Misiones**: historia principal (etapas 1–3 del Arca), «Madera para la empalizada», «Pieles para el invierno» y la defensa del pueblo.
- **Ataques de bandidos**: salen de su campamento, se reúnen, se acercan, entran por la brecha o fuerzan el portón, incendian y saquean, y huyen si caen su cabecilla o la mitad. Campana de alarma, guardias a sus puestos, vecinos a casa. Consecuencias persistentes (casas dañadas, vecinos muertos, comerciante ausente, reputación, recompensas, reparaciones al alba).
- **Reputación, economía** (maravedíes, precios según confianza, stock limitado que se repone), **habilidades por uso**, **guardado** persistente (autoguardado + 3 ranuras).

## Controles

**Móvil/tableta**: joystick con el pulgar izquierdo, arrastrar a la derecha para mirar y botones en pantalla (se activan solos en pantallas táctiles).

**Teclado y ratón**: WASD mover · Shift correr · Ctrl agacharse · Espacio saltar · E usar/coger · R agarrar/soltar · Clic ataque (mantener: fuerte / tensar arco) · Clic der. bloquear · C esquivar · F patada · T antorcha · 1–4 armas · Tab inventario · J diario · M mapa · Esc pausa · F3 rendimiento.

## Documentación

- [Análisis inicial](docs/00_ANALISIS_PROYECTO.md) · [GDD](docs/GDD.md) · [Arquitectura](docs/ARQUITECTURA.md) · [Decisiones](docs/DECISIONES.md) · [Roadmap](docs/ROADMAP.md) · [Riesgos](docs/RIESGOS.md) · [Assets](docs/ASSETS.md) · [Estado del slice](docs/ESTADO.md)
