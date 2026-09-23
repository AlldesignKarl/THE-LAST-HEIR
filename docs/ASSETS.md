# Assets: placeholders y cómo sustituirlos

El proyecto **no incluye arte ni audio externos**. Todo lo visible y audible es procedural y está marcado como **PLACEHOLDER** en el código. La arquitectura aísla cada tipo de asset detrás de una biblioteca con ids estables, de modo que sustituirlo no afecta a la lógica del juego.

| Tipo | Placeholder actual | Punto único de sustitución | Sustituto previsto |
|---|---|---|---|
| Texturas | Pintadas en canvas con ruido periódico + normales por Sobel (`engine/placeholder/Textures.ts`) | `TextureLibrary.get(id)` | Texturas PBR (albedo, normal, roughness, AO) 1–2K |
| Materiales | `MeshStandardMaterial` por id (`Materials.ts`) | `MaterialLibrary.get(id)` | Mismos ids con mapas PBR |
| Objetos y mobiliario | Geometría primitiva fusionada (`Models.ts`) + forma física simplificada | `ModelLibrary.create(id)` → `{object, shape, mass}` | glTF por id; la forma física se mantiene en datos |
| Edificios | Constructor procedural (`world/Buildings.ts`) | `BuildingInstance` | Kits modulares glTF (muros, tejados, puertas) |
| Árboles | Cilindros + icosaedros desplazados, 2 LOD (`world/Vegetation.ts`) | `speciesGeometry()` | Modelos de árbol con LOD e impostores |
| Humanos | Rig jerárquico de primitivas con poses (`actors/HumanoidModel.ts`) | `HumanoidModel` (`setState`, `update`, `hitboxes`, manos) | `SkinnedMesh` + `AnimationMixer` con clips de mocap |
| Animales | Cuadrúpedo procedural (`actors/AnimalModel.ts`) | `AnimalModel` | Modelos rigueados de ciervo/lobo |
| Brazos 1.ª persona | Cilindros + esferas (`player/Viewmodel.ts`) | `Viewmodel` | Brazos rigueados con animaciones de ataque |
| Sonido | Síntesis WebAudio por id lógico (`audio/AudioEngine.ts`) | `AudioEngine.samples.set(id, buffer)` | Grabaciones (Foley, ambientes, campanas) |
| Fuentes | IM Fell English + EB Garamond (OFL, vía npm `@fontsource`) | CSS | — (definitivas) |

## Reglas

1. Ningún sistema de juego importa `engine/placeholder/*` directamente salvo a través de las bibliotecas.
2. Los ids (`'sword'`, `'step_grass'`, `'stoneWall'`...) son contrato: el sustituto usa el mismo id.
3. Las formas físicas (`Shape`) viven en datos, no en la malla, para que un modelo nuevo no altere la jugabilidad.
