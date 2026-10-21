# Black artifact correction — 21 October 2026

## Confirmed defect

Version 5 applied contact occlusion at mesh vertices to a room with very large triangles. Actual plaster wall triangles cover 26.07 square metres and have corner visibility values ranging from 0.3255 to 0.8667. Interpolating these three corner values spreads corner darkness across broad triangular wall areas. Ceiling triangles reach 51.35 square metres. Increasing ray counts at the same three positions does not repair the missing surface samples.

## Correction

- Disable the unsuitable vertex occlusion by default and explicitly in the app. Preserve its data and keep additive warm bounce light.
- Restore broad point illumination at all four lantern positions. Retain one controlled shadow light at the back table with gentler shadow strength and surface offset.
- Return to direct antialiased rendering. Preserve the added HDR/MSAA/bloom finish in `art/rendering.quarantine/room-finish-v5.js`, outside published assets.
- Keep the detailed surface textures, room reflections, atmospheric dust, clearer overlays, camera movement, book content and social artwork.

## Evidence

`node scripts/room-lighting.test.mjs` passed. The test loads the actual shipped room with its own GLTFLoader, reproduces a wall triangle larger than 20 square metres with corner AO variation over 0.5, executes the real lighting shader hook, and verifies that incoming ambient light is unchanged at the triangle corners and centre under the corrected default. It checks all 59 static meshes and preserves the moving book materials.

`node scripts/room-look.test.mjs`: 6 camera tests passed. JavaScript syntax checks and `git diff --check` passed. There are no remaining RoomFinish imports or calls in the live application.

## Limit and quarantine log

The code-level defect and correction are verified. Final appearance on the user's GPU remains unverified: the available preview browser previously disabled WebGL, and no connected local Browser control tool is exposed in this session. The repair does not claim GPU visual verification.

Quarantined: version 5 full-screen HDR/MSAA/bloom source in `art/rendering.quarantine/room-finish-v5.js`. No user files deleted.
