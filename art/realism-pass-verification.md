# Shop and street realism pass

This pass changes the live scene, its bundled materials, and the rendering path.
The street now has recessed building interiors, masonry and paving detail,
curved awnings, individual leaves, glass, street furniture, more detailed vehicle
bodies and interiors, and articulated walking rigs. The interior receives
photographic surface normals while retaining its authored materials and lighting.

Seventeen locally bundled Poly Haven CC0 maps supply pigment, normal detail,
and roughness. Source URLs, conversions, sizes and hashes are recorded beside
the assets. The BlenderProc pipeline reconstructs the actual application meshes
and generates the static ground contact-occlusion map used by the live site.
That map excludes moving actors and sunlight, so traffic shadows and Indiana
daylight remain dynamic. See `blenderproc-workflow.md` for reproduction and the
render evidence under `blenderproc-review/`.

Live lighting uses local reflection probes, doorway daylight, astronomical sun
direction, and street lamps. HDR postprocessing adds restrained contact shading,
screen-space reflection rays and highlights. These reflection rays only see
the current depth buffer; this is not browser hardware ray tracing or path
tracing. Unsupported render targets or failed effects restore direct rendering.

Motion improvements include planted walking feet, wheel rotation, suspension,
and a frame-rate independent door hinge. Nearby visible vehicles refresh their
sun shadows each frame; distant traffic and hidden streets retain cached shadows.
The world clock and actor trajectories continue when the street is out of view,
avoiding a visible restart when the visitor turns back.

The gentler touch changes are included: twice the usable joystick travel, half
the maximum movement speed, half the touch-look sensitivity, and twice the
automatic turnaround duration. Input remains continuous between the centre
dead zone and maximum travel. The enlarged controller retains room for the
clock and shelf panel on short screens.

## Validation

- Final application suite: **181 passed, 0 failed**. Final native shader run:
  **57 distinct programs compiled and linked**, with no failures, on Mesa
  llvmpipe OpenGL ES 3.2. These runs include the revised actor geometry.
- `node --test scripts/*.test.mjs` exercises controls, time, closing choices,
  navigation, scene geometry, material provenance, shadow caching, reflection
  lifecycle and render fallback.
- `node scripts/validate-render-shaders.mjs` assembles the delivered scene's
  actual shader hooks with the bundled Three.js implementation, then compiles
  and links them using existing Mesa EGL/OpenGL ES libraries.
- BlenderProc 2.8.0 with Blender 4.2.1 LTS executes the Cycles bake and offline
  scene-review renders. These are not browser screenshots.
- The authored book JSON and oath remain byte-for-byte unchanged.

Browser/device visual review and frame-rate measurements are unverified because
the managed preview service was unavailable. Shader compilation and offline
renders do not establish mobile Safari or Chrome performance. The assets remain
constructed 3D models; no numerical percentage of photorealism is claimed.

## StableGen follow-up

The requested StableGen addon is prepared as a separate offline texturing step.
It requires a working ComfyUI inference backend. None was available in this
workspace or at the documented local endpoint on the connected computer, and
the connected remote GPU-job capability was unavailable. Its preparation files
must not be interpreted as generated textures: this publication includes no
StableGen AI texture output. Existing photographed materials and the executed
BlenderProc bake retain their own provenance.
