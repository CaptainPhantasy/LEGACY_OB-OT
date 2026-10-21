# Legacy visual upgrade — 21 October 2026

Implemented together in this revision:

- Seven surface families, 21 shared texture maps: wood, masonry, fabric, paper, leather, metal and glass. Original cover artwork and UVs are retained. Grain orientation follows the disconnected timbers inside the joined room geometry.
- Actual offline ray tracing: 128 ambient-occlusion rays and 64 diffuse-bounce rays per static vertex, plus secondary lamp visibility tests. 451,110 vertices, 59 static meshes, 86,613,120 primary samples. The 1,804,440-byte lighting asset contains contact shading and one bounce of warm reflected light.
- Live directional lantern shadows, a cool doorway fill, a reflection capture of the room, subtle linear-light bloom, and reduced screen overlays.
- Automatic rendering resolution adjustment based on elapsed frames. Static shadow maps are reused; book movement refreshes them.

## Verification evidence

- `node --check` passed for app.js and all new/changed room modules.
- `node scripts/room-look.test.mjs`: 6 tests passed, including 270-degree horizontal looking, ceiling/floor bounds, reset, touch movements, and floor clearance.
- Every surface image decoded successfully (21 images).
- Ray-trace source and output SHA-256 match `dist/assets/room-irradiance.json`; record counts and byte length match the binary.
- Bake was checked with the shipped GLTFLoader: all 59 static meshes matched, all six animated cover meshes remained outside the bake.
- Material processing was checked against all 65 GLB primitives: original position order, vertex counts and UV0 retained; 56 materials enhanced.
- Book chapter SHA-256 matches the existing author manifest. Original GLB, book text, social artwork and camera stops are unchanged.
- Shader integration reviewed against this project's vendored Three.js: linear intermediate buffers, single final tone/display conversion, material UV1, baked indirect-light hooks, physical-glass flag and material cloning.
- `git diff --check` passed. No files deleted or quarantined.

## Verification limit

The managed preview browser reports WebGL disabled, including for the original scene. Final live 3D appearance, shader compilation on a real browser GPU, and device frame rates could not be visually verified in that browser. A subsequent browser interaction also received an environment URL-policy denial; no alternate browser path was used.

The ray tracing is precomputed lighting, not live hardware ray tracing. Reflections are a room capture; moving shadows are conventional shadow maps. The original still-image fallback remains available.
