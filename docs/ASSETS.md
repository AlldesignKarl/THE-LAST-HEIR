# Assets: placeholders y cómo sustituirlos

El proyecto **no incluye arte ni audio externos**. Todo lo visible y audible es procedural y está marcado como **PLACEHOLDER** en el código. La arquitectura aísla cada tipo de asset detrás de una biblioteca con ids estables, de modo que sustituirlo no afecta a la lógica del juego.

| Tipo | Placeholder actual | Punto único de sustitución | Sustituto previsto |
|---|---|---|---|
| Texturas | Pintadas **en GPU** con shaders de ruido periódico/Voronoi (albedo + altura → normales por Sobel), 512–1024 px según calidad (`engine/placeholder/TextureGen.ts`); respaldo en CPU (`Textures.ts`) | `TextureLibrary.get(id)` | Texturas PBR (albedo, normal, roughness, AO) 1–2K |
| Follaje | Atlas con alfa dibujados en Canvas 2D: racimos de roble, ramas de pino, arbusto, helecho, matas de hierba (`FoliageTextures.ts`, `Grass.ts`) | `oakFoliage()`… / `foliageMaterial()` | Atlas fotográficos de hojas |
| Materiales | `MeshStandardMaterial` por id (`Materials.ts`) | `MaterialLibrary.get(id)` | Mismos ids con mapas PBR |
| Objetos y mobiliario | Geometría primitiva fusionada (`Models.ts`) + forma física simplificada | `ModelLibrary.create(id)` → `{object, shape, mass}` | glTF por id; la forma física se mantiene en datos |
| Edificios | Constructor procedural (`world/Buildings.ts`) | `BuildingInstance` | Kits modulares glTF (muros, tejados, puertas) |
| Árboles | Tronco y ramas por curvas + copa de ~100 tarjetas de hojas con alphaTest, normales volumétricas y AO por vértice; LOD lejana con tarjetas grandes (`world/TreeModels.ts`) | `speciesGeometry()` / `speciesMaterials()` | Modelos de árbol (SpeedTree o similar) con LOD e impostores |
| Detalle de suelo | Rocas, arbustos, helechos, ramas caídas instanciados (`world/GroundScatter.ts`) | `GroundScatter` | Mallas escaneadas |
| Humanos | Rig jerárquico de primitivas (torso torneado, cara con nariz/orejas/ojos/cejas, pelo, tocas, capacete, calzado) con detalle de tejido/piel/cuero en shader (`actors/HumanoidModel.ts`, `engine/RigidSkin.ts`) | `HumanoidModel` (`setState`, `update`, `hitboxes`, manos) | `SkinnedMesh` + `AnimationMixer` con clips de mocap |
| Animales | Cuadrúpedo procedural (`actors/AnimalModel.ts`) | `AnimalModel` | Modelos rigueados de ciervo/lobo |
| Brazos 1.ª persona | Cilindros + esferas (`player/Viewmodel.ts`) | `Viewmodel` | Brazos rigueados con animaciones de ataque |
| Sonido | Síntesis WebAudio por id lógico (`audio/AudioEngine.ts`) | `AudioEngine.samples.set(id, buffer)` | Grabaciones (Foley, ambientes, campanas) |
| Fuentes | IM Fell English + EB Garamond (OFL, vía npm `@fontsource`; Google Fonts en la versión de un solo archivo) | CSS | — (definitivas) |

> Se intentó descargar texturas CC0 (Poly Haven) para sustituir los placeholders, pero la red de este entorno no permite acceder a esos servidores. La sustitución queda preparada por id.

## Reglas

1. Ningún sistema de juego importa `engine/placeholder/*` directamente salvo a través de las bibliotecas.
2. Los ids (`'sword'`, `'step_grass'`, `'stoneWall'`...) son contrato: el sustituto usa el mismo id.
3. Las formas físicas (`Shape`) viven en datos, no en la malla, para que un modelo nuevo no altere la jugabilidad.
