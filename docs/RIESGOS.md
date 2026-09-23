# Riesgos técnicos

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | **Calidad visual limitada sin assets reales** | Alta | Alto | Priorizar iluminación/atmósfera; pipeline preparado para glTF/PBR (fase 6); placeholders identificados |
| R2 | **Animación de personajes** sin esqueletos ni mocap | Alta | Medio | Rig procedural jerárquico con poses interpoladas; interfaz `HumanoidModel` sustituible por `SkinnedMesh` + `AnimationMixer` |
| R3 | **Coste de luces dinámicas** de noche | Media | Alto | Pool de 8 luces + halos emisivos (ADR-006) |
| R4 | **Rendimiento con muchos NPCs** | Media | Alto | LOD de simulación (ADR-005), IA a baja frecuencia lejos |
| R5 | **Navegación** sin navmesh | Media | Medio | Grafo de waypoints manual por pueblo + dirección directa con evitación; los caminos se autogeneran desde `WorldLayout`. Navmesh (recast) en fase 3 si hace falta |
| R6 | **Física inestable** (objetos atravesando, jitter) | Media | Medio | Paso fijo, CCD en objetos lanzados y flechas por raycast, colliders simples |
| R7 | **Grietas entre chunks de distinto LOD** | Media | Bajo | Faldones (skirts) en cada chunk |
| R8 | **Guardados incompatibles** entre versiones | Media | Alto | Documento versionado + migraciones + tests de ida y vuelta |
| R9 | **Pruebas visuales lentas** (sin GPU en CI) | Alta | Bajo | Lógica testeada en Node; E2E con pocos frames y escenarios dirigidos por DebugAPI |
| R10 | **Pointer lock / audio** requieren gesto del usuario | Alta | Bajo | Menú inicial con clic; el audio arranca en ese gesto |
| R11 | **Alcance** (el diseño completo es enorme) | Alta | Alto | Vertical slice primero; roadmap por fases; nada simulado |
| R12 | **Combate que "no pesa"** sin animaciones de calidad | Media | Alto | Fases de ataque con compromiso, inercia del arma, hit-stop, sacudida, coste de stamina, IA que castiga |
