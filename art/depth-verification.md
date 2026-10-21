# Legacy room: rendering verification

This is a live Three.js/WebGL scene. Cycles runs during asset production; the browser receives the resulting lighting map and geometry. It does not perform hardware ray tracing.

## What the delivery preserves

| Layer | Native Blender scene | Browser delivery |
| --- | --- | --- |
| Geometry | Existing dimensional masonry, boards, leather repairs and page layers; added small book-edge bevels | Actual exported geometry, with separate moving cover |
| Materials | Varied roughness, small surface relief, paper subsurface response | Authored color and normal maps, repeating roughness and bump maps; dry wood remains dry |
| Lighting | Cycles area lights, warm fixtures, cooler entrance fill, indirect transport | 4096² diffuse direct + indirect bake at 1,024 samples, live specular reflections, moving-cover shadow and reveal light |
| Atmosphere | Scattering volume | Existing browser fog and animated dust |
| Camera | AgX, physical depth of field for photographic stills | AgX tone mapping; responsive interactive camera and existing comfort settings |

Native procedural materials, subsurface scattering, volume and camera depth of field are not claimed to survive glTF export. Photographic native stills are not browser screenshots.

## Defects found through inspection

- The old coarse vertex-occlusion approach could paint large dark triangles. The new static lighting uses a unique UV atlas instead.
- The first atlas had overlapping and collapsed positive-area regions. Repair preserved geometry and original texture coordinates; the corrected atlas had zero interior overlap and no collapsed positive-area face.
- Inspection of the clean exported scene caught missing material color factors and inward-facing closed book/page components. Native camera renders had hidden the winding defect. Export factors are now explicit. The repair reversed 3,175 inward closed components (137,730 faces), retained 2,206 correctly oriented components and left 334 open/nonmanifold components untouched. It verified unchanged vertex positions, every face's material and corner UV correspondence, and the hinge transform; the atlas still had zero overlap.
- Final tests against the actual browser asset caught 1,562 small repaired triangles outside tile 1001. The runtime correctly refused that lighting atlas. The authoring gate now checks every UV loop before rasterization or export; repairs must preserve the existing atlas detail and receive a fresh bake. The targeted repair kept 986,345 valid UV loops exactly unchanged and placed the affected triangles in separate 24-pixel tiles; atlas occupancy increased from 69.97% to 71.09%, with zero overlaps or invalid loops.
- A saved Blender image without a user was being discarded on reload. The final float lighting image receives a retained reference and is packed into the editable native file.
- Scaling an 8-bit sRGB image to accommodate bright fixtures discarded dim illumination. The shipped RGBA lightmap uses square-root RGBM instead: `(RGB * alpha)² * 1024`. The full-range encoding has no clipped or non-finite channels. A measured shadow value of 0.0054 survives as 0.00537665 instead of becoming black.

## Verification record

Native entrance, table and close-up stills were rendered with Blender 4.5.7 Cycles on Apple M4 Metal, with an adaptive ceiling of 1024 samples, and visually inspected. The exported-scene review reloads the delivered glTF into an empty Blender scene and reconstructs the browser's baked diffuse calculation. It covers entrance, table, close-up and open-cover views.

The final encoded-lighting entrance, table, close-up and open-cover images were all visually inspected. The shelf colors, cover repairs and paper layers survive export; the broad false-black patches caught in the first export are absent. Live reflections are excluded from these diagnostic images.

Delivery uses standard glTF plus five binary parts of at most 8 MiB. Splitting changes only storage references: every bufferView's bytes and the scene/material definitions are verified unchanged. The original editable scene remains in the repository; the large generated native checkpoint, float EXR and source GLB are retained on the rendering device at the paths recorded in `room-depth-report.json`.

A conservative edge-clearance pass checked all 1,562 allocated triangles. Its 25 near-margin flags were refined with exact triangle distances: minimum separation was 11.194 pixels, exceeding the 8-pixel requirement. All other 1,537 allocations passed the conservative mask proof.

The final lightmap was losslessly compressed from 26,414,411 to 23,939,052 bytes. Independent Blender PNG decoding verified exact equality of all RGBA values; compression changes no lighting or alpha data.

All eight final delivered-asset tests passed: real binary parts and material factors; original UV and dry-timber preservation; static/dynamic lighting separation; atomic rejection of bad atlases; actual shipped UV bounds; raw RGBM decoding; range validation; and dark/bright encoding precision. The seven camera and prior-artifact regression checks had also passed with unchanged source. All delivery hashes match the manifest, and the protected source scene and chapter hashes remain unchanged.

Browser GPU shader compilation, interactive frame rate and the user's particular graphics driver could not be tested: the supported managed preview service was unavailable. Native stills and clean-export stills are evidence for geometry, texture and lighting transfer, not a substitute claim for those browser checks.

The original source scene and Chapter One are preserved. The protected chapter SHA-256 is `1460bd439dbe372c738c25c716bb858821c3fa6adde8ec545b27a10ac29d7193`.
