# StableGen preparation and current inference blocker

[StableGen](https://github.com/sakalond/StableGen) 0.3.1, pinned to upstream
commit `1d6e83fc966afc8b2c196c011b75ce7cdaa07c83`, was downloaded and registered
successfully in the isolated Blender 4.2.1 environment. Its actual
`bpy.ops.object.add_cameras` operator was run on the application's exported
car and pedestrian geometry. Each asset has six normal-weighted views with
individual aspect ratios, view prompts, conservative refine settings, and a
saved Blender job. The adjacent preparation JSON files record the executed
operation, original scene hash, actual cameras, and target surface selection.
`stablegen-prepared-jobs.zip` retains both executed Blender jobs and their
reports with the project. Extract it to a working folder before opening a job;
set the output folder and backend address in the addon preferences.

**AI generation has not run. No StableGen-generated textures have been added
to the live site.** There is no working ComfyUI backend in this workspace;
the documented localhost port 8188 refused connection. PyTorch and an NVIDIA
device/runtime are absent. The addon uses ComfyUI for diffusion; addon
registration and camera preparation do not substitute for that inference.

The prepared first targets are the burgundy car's painted body and the
pedestrian's skin/clothing. Glass, eyes, spectacle frames, wheels, metal trim,
the authored book, signs and existing text remain outside the selected
refinement surfaces. Original geometry, UVs, base physical-material values,
and world transforms are copied. Existing runtime microdetail image maps are
not copied into these preparation files and must be preserved when importing
approved generated albedo back into the application.

## Reproduce the concrete jobs

Obtain the pinned official addon and install its documented dependencies in an
isolated Blender Python package directory. This does not require installing
ComfyUI or downloading a model simply to prepare the scene.

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/sakalond/StableGen.git ../stablegen-source
git -C ../stablegen-source sparse-checkout set stablegen
git -C ../stablegen-source fetch origin 1d6e83fc966afc8b2c196c011b75ce7cdaa07c83
git -C ../stablegen-source checkout 1d6e83fc966afc8b2c196c011b75ce7cdaa07c83
node scripts/export-blenderproc-scene.mjs ../realism-scene-final-input

blender --background --factory-startup --python art/stablegen-prepare.py -- \
  --scene ../realism-scene-final-input/scene.json \
  --addon ../stablegen-source \
  --dependencies /absolute/path/to/isolated-blender-python-packages \
  --target car --output ../stablegen-prepared/car \
  --server 127.0.0.1:8188
```

Run again with `--target pedestrian --output ../stablegen-prepared/pedestrian`.
The script writes the corresponding `.blend` and preparation report. Its
source-scene selection matches the inspection placements produced by the
exporter; it fails if the actual target meshes are missing. Large exports and
temporary files remain outside the repository; the compact prepared jobs are
retained in the ZIP above.

The current workspace's Blender binary requires `LD_LIBRARY_PATH` set to its
bundled `lib` directory because `/proc/self/exe` is unavailable. Existing
BlenderProc dependencies are reused; only missing addon dependencies were
added to a separate `stablegen-python-packages` directory. User preferences
are not saved, and no connected device installation was changed.

## Complete generation when a backend is available

1. Supply a reachable ComfyUI server with a compatible checkpoint and the
   StableGen custom nodes. The upstream README recommends an NVIDIA GPU with
   at least 8 GB VRAM for usable SDXL inference; larger architectures need more.
2. Open the prepared `.blend` with the pinned addon enabled. In its preferences,
   set that server address and an output folder, refresh models, then select
   the installed checkpoint and matching Depth/Normal ControlNets. No model
   filename is invented in the preparation script.
3. Review the six generated camera views, selected surfaces and prompts. Run
   Refine with the saved 0.32 denoise value, then inspect all views for seams,
   duplicated features and painted lighting. Use PBR decomposition/delighting
   only if those backend nodes are actually available.
4. Bake approved results to standard UV textures, retaining the existing rig,
   silhouette, authored UV0 and lightmap UV2. Merge the approved surface maps
   into the live materials, retain their physical response, then repeat scene,
   shader, mobile-performance and day/night checks before publication.

The input jobs are ready for that step. A reachable inference backend is still
required before another StableGen-driven visual improvement can be claimed.
