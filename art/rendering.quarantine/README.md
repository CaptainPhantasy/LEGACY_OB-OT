# Version 5 effects withdrawn from the live renderer

The full-screen HDR/MSAA/bloom finish is preserved in `room-finish-v5.js` for later device testing. It is outside `dist` and is not imported or published. The room now uses the same direct antialiased rendering path as version 4.

The baked occlusion data is retained, but its darkening is disabled. Some room walls use triangles spanning 26 square metres, with only three lighting samples; corner contact shading was therefore interpolated into false broad triangular patches. More rays at those same corners do not solve the missing surface samples. Warm additive bounce remains active.

The three enclosed-lantern shadow projectors are replaced with the prior broad point lights and one controlled back-table shadow source. Original textures, new surface detail, reflections and author text remain.

No user files were deleted.
