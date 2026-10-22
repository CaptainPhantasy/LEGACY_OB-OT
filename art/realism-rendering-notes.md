# Live rendering pass

The renderer keeps the existing baked indirect light, physically based materials,
and room/street reflection probes. A bounded postprocessing chain adds moving
surface contact and visible-world reflections:

1. Render the scene once into a linear half-float HDR target with 24-bit depth.
2. Evaluate stable view-space ambient/contact occlusion at reduced resolution.
3. March reflection rays through the visible depth buffer for suitable smooth
   metal, clearcoat, and low-roughness surfaces. Refine crossings with four binary
   steps and fade screen edges. A missed ray preserves the original probe shading.
4. Depth-aware upsampling/compositing, restrained bright-highlight bloom and
   contrast-directed edge smoothing, then the existing AgX/exposure and sRGB
   output conversion exactly once.

Opaque material response occupies the beauty target's otherwise unused alpha.
Hooks preserve the previous lightmap, haze and reflection shader hooks and their
program keys. During the beauty pass only, glass, dust and other transparent
materials retain their ordinary RGB blending while preserving destination alpha.
Their blending settings are restored before any following render/probe pass.

The camera's actual inverse projection matrix is used, including shelf inspection
view offsets. Background pixels and far sky do not acquire contact shading.
The bilateral filter rejects large depth discontinuities to limit dark halos and
reflection spill. Rough surfaces reject reflections from adjacent smooth objects.

| Quality | Maximum HDR pixels | Effect resolution | AO samples | Reflection ray steps |
| --- | --- | --- | --- | --- |
| High | 2,600,000 | 50% per axis | 12 | 24 |
| Balanced | 1,500,000 | 45% per axis | 8 | 16 |
| Low | 1,000,000 | 40% per axis | 6 | Disabled |

Phones/tablets start at Balanced. Sustained slow frames can select Low. No
temporary history textures accumulate, so camera turns do not leave temporal
ghost trails. Unsupported HDR targets, incomplete framebuffers, shader errors,
and runtime pass failures restore the original material hooks and render directly
with the scene's ordinary lighting and reflection probes.

This is **screen-space ray tracing for reflections**, not hardware ray tracing,
path tracing, a replacement global-illumination bake, or a photorealism score. It
cannot reflect offscreen or occluded geometry. Normal direction is reconstructed
from depth, so its reflection rays do not capture fine normal-map microstructure;
the underlying PBR lighting and probes still do. Ambient occlusion is deliberately
restrained because the interior already contains baked contact lighting.

Nine automated checks cover buffer budgets, real Three projection reconstruction,
shader-hook composition, transparent RGB/alpha state, rendering order/state
restoration, adaptive quality and direct-render fallback. One check compares post
shader helper names with the delivered Three prefix; it prevents a duplicate
`luminance` definition that would otherwise make the composite fail compilation.

`node scripts/validate-render-shaders.mjs` additionally loads the delivered room
geometry and material settings, applies the surface/lightmap/probe/haze/metadata
hooks, and uses the bundled Three shader assembler. It compiles and links 57
unique HDR, restored direct-render, and post-effect program variants through the
existing surfaceless EGL ES3 driver. All 57 passed with Mesa llvmpipe (LLVM 20.1.2),
OpenGL ES 3.2 Mesa 25.2.8. No browser, window, server, new dependencies or network
are used. Image transport supplies dimensions instead of decoding pixels.

This checks actual GLSL compilation and linking on that software driver; it does
not establish frame rate, inspect rendered pixels, or replace browser/device
review. The managed browser preview service was unavailable. Run the validator
again after material hooks or the bundled Three version change.

Primary API references, checked against the bundled implementation:

- https://threejs.org/docs/pages/RenderTarget.html
- https://threejs.org/docs/pages/DepthTexture.html
- https://threejs.org/docs/pages/WebGLRenderer.html
- https://threejs.org/examples/webgl_postprocessing_ssr.html
