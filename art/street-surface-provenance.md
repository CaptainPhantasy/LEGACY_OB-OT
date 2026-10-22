# Street and interior surface sources

October 22, 2026. These are relightable photographic texture sets, not generated
street renders or pre-painted illumination.

The source assets are published by [Poly Haven](https://polyhaven.com/), whose
[asset license](https://polyhaven.com/license) is CC0. Runtime copies are bundled
locally so the visitor does not depend on a third-party texture server.

| Family | Source asset | Runtime maps |
| --- | --- | --- |
| Brick | [Red Bricks 04](https://polyhaven.com/a/red_bricks_04) | Diffuse, OpenGL normal, roughness |
| Asphalt | [Asphalt 02](https://polyhaven.com/a/asphalt_02) | Diffuse, OpenGL normal, roughness |
| Concrete | [Concrete Floor](https://polyhaven.com/a/concrete_floor) | Diffuse, OpenGL normal, roughness |
| Plaster | [Plastered Wall 05](https://polyhaven.com/a/plastered_wall_05) | Diffuse, OpenGL normal, roughness |
| Timber | [Wood Table Worn](https://polyhaven.com/a/wood_table_worn) | Diffuse, OpenGL normal, roughness |
| Leather | [Brown Leather](https://polyhaven.com/a/brown_leather) | OpenGL normal, roughness |

All maps are 1024 × 1024. JPEG source maps were converted to WebP without
resizing or changing their channels, at quality 94 for normals and 90 for color
and roughness. `dist/assets/street-surfaces/sources.json` records exact source
URLs, source hashes, delivered hashes, byte counts, and conversion settings.

The exterior assigns material-scale UV1 after static pieces are batched.
Authored UV0 is preserved for signs and vehicle details; glass and labels are
excluded. Brick uses the source's 2.5-metre span, asphalt and concrete use a
3-metre span. Anisotropy is capped at 8. Pigment maps use sRGB, while normals and
roughness remain linear data. Cloth and metal retain the existing original
procedural microdetail instead of receiving a photographic masonry texture.

The interior uses the new photographic normal detail on un-authored timber,
leather and mineral normals, preserving the book's original crack normal map,
all authored pigment maps, dry timber roughness, and UV2 baked lighting. Existing
local height maps remain the fallback if an additional normal cannot load.

These maps add surface shading detail. They do not by themselves create new
silhouette geometry, displacement tessellation, or ray-traced rendering.

## Ground occlusion integration

`applyStreetGroundAO` accepts the separately generated static-street bake at
`assets/street-surfaces/ground-ao.webp`. That bake is produced by the BlenderProc
pipeline from the runtime scene, and is not a Poly Haven asset. The application
must enable this load only once the bake is bundled.

The rectangular bake covers world x −40 to 40 and z 7.5 to 23.5. Image row zero
corresponds to z 7.5; the bottom row corresponds to z 23.5. World-space UV2 is
`((x + 40) / 80, (23.5 - z) / 16)` with the normal TextureLoader vertical flip.
Two pure-white border pixels and clamp wrapping leave the surrounding street
unoccluded. Coordinates beyond the bake remain linear so large road triangles
can interpolate correctly through the block. Ground-facing vertices below
y 0.4 receive the projection; vertical sides sample the white border. Existing
UV0, UV1, authored UV2, and lightmaps are preserved. Ground material variants
avoid applying this bake to walls that share their source material.
