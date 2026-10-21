# Legacy room: rendering verification

This is a live Three.js/WebGL scene. Cycles runs during asset production; the browser receives the resulting lighting map and geometry. It does not perform hardware ray tracing.

## What the delivery preserves

| Layer | Native Blender scene | Browser delivery |
| --- | --- | --- |
| Geometry | Existing dimensional masonry, boards, leather repairs and page layers; added small book-edge bevels | Actual exported geometry, with separate moving cover |
| Materials | Varied roughness, small surface relief, paper subsurface response | Authored color and normal maps, repeating roughness and bump maps; dry wood remains dry |
| Lighting | Cycles area lights, warm fixtures, cooler entrance fill, indirect transport | 4096² diffuse direct + indirect bake, live specular reflections, moving-cover shadow and reveal light |
| Atmosphere | Scattering volume | Existing browser fog and animated dust |
| Camera | AgX, physical depth of field for photographic stills | AgX tone mapping; responsive interactive camera and existing comfort settings |

Native procedural materials, subsurface scattering, volume and camera depth of field are not claimed to survive glTF export. Photographic native stills are not browser screenshots.

## Defects found through inspection

- The old coarse vertex-occlusion approach could paint large dark triangles. The new static lighting uses a unique UV atlas instead.
- The first atlas had overlapping and collapsed positive-area regions. Repair preserved geometry and original texture coordinates; the corrected atlas had zero interior overlap and no collapsed positive-area face.
- Inspection of the clean exported scene caught missing material color factors and inward-facing closed book/page components. Native camera renders had hidden the winding defect. Export factors are now explicit, and closed-component orientation is checked before accepting the replacement bake.
- A saved Blender image without a user was being discarded on reload. The final float lighting image receives a retained reference and is packed into the editable native file.

## Verification record

Native entrance, table and close-up stills were rendered with Blender 4.5.7 Cycles on Apple M4 Metal, with an adaptive ceiling of 1024 samples, and visually inspected. The exported-scene review reloads the delivered glTF into an empty Blender scene and reconstructs the browser's baked diffuse calculation. It covers entrance, table, close-up and open-cover views.

Final exported-image acceptance, asset tests and publication are recorded below after completion.

Browser GPU shader compilation, interactive frame rate and the user's particular graphics driver could not be tested: the supported managed preview service was unavailable. Native stills and clean-export stills are evidence for geometry, texture and lighting transfer, not a substitute claim for those browser checks.

The original source scene and Chapter One are preserved. The protected chapter SHA-256 is `1460bd439dbe372c738c25c716bb858821c3fa6adde8ec545b27a10ac29d7193`.
