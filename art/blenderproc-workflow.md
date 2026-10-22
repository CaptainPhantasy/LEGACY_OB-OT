# BlenderProc scene review and contact-occlusion bake

The offline pipeline uses [DLR-RM/BlenderProc](https://github.com/DLR-RM/BlenderProc), Blender 4.2.1 LTS, and Cycles CPU ray tracing. The exported meshes, actor rigs, texture maps, material groups, and transforms come from the shipped Three.js scene. It creates a static ground contact-occlusion texture consumed by the website, plus separate render evidence for review. It does not replace or modify the authored book.

The browser still renders interactively with WebGL. The offline review images are Cycles renders, not browser screenshots, and lighting/transparency response differs between the engines. The AO asset contains neither moving actors nor a fixed sun shadow; time-dependent lighting remains live.

Daylight review uses Blender's Nishita atmospheric sky at the exported sun direction. The sky's sun disc is disabled so the exported directional light supplies direct sun only once. Runtime point and spot intensities use a 4π power normalization in Cycles; spot direction, cone angle, and penumbra remain as exported. This is a renderer calibration rather than measured absolute lamp photometry. The runtime's ambient/hemisphere approximations are omitted because Cycles computes sky illumination and reflected bounce. Night review uses the actual street-lamp powers and switches the indoor practical lights off. The interior inspection camera uses +2 exposure stops to reveal dim surfaces; no fixture power or geometry is changed for that view. Exterior views use zero exposure compensation.

## Reproduce

Run from the repository root with Node 24 or later. Keep the large JSON exports and temporary render files outside the repository.

```sh
python -m venv --system-site-packages ../blenderproc-env
../blenderproc-env/bin/pip install blenderproc==2.8.0
export PIP_CONSTRAINT="$PWD/art/blenderproc-constraints.txt"
node scripts/export-blenderproc-scene.mjs ../realism-scene-input
node scripts/export-blenderproc-scene.mjs ../realism-scene-full-input --include-room

../blenderproc-env/bin/blenderproc run \
  --blender-install-path ../blender-runtime \
  --temp-dir ../blenderproc-temp --keep-temp-dir \
  art/blenderproc-realism.py \
  --scene ../realism-scene-input/scene.json \
  --output ../blenderproc-review-work --mode ao --samples 32

../blenderproc-env/bin/blenderproc run \
  --blender-install-path ../blender-runtime \
  --temp-dir ../blenderproc-temp --keep-temp-dir \
  art/blenderproc-realism.py \
  --scene ../realism-scene-full-input/scene.json \
  --output ../blenderproc-review-work --mode review --samples 48
```

BlenderProc downloads Blender into the requested folder on first use. In this restricted Linux workspace, Blender's `$ORIGIN` library lookup cannot resolve `/proc/self/exe`; setting `LD_LIBRARY_PATH` to the downloaded `blender-4.2.1-linux-x64/lib` folder fixes that local runtime lookup. No global packages or external device were changed.

The first dependency bootstrap also left mixed SciPy files after an automatic downgrade. The isolated Blender Python package folder was repaired using NumPy 1.26.4 and SciPy 1.13.1. The supplied constraints pin those versions during a fresh setup, avoiding that intermediate upgrade/downgrade. These versions are compatible with the BlenderProc 2.8 dependency set. That repair belongs only to the offline tool environment, not website deployment.

## Output contract

`dist/assets/street-surfaces/ground-ao.webp` is a lossless, linear grayscale 2048×512 contact-occlusion map. Its footprint is x −40…40 and z 7.5…23.5 in runtime coordinates. Image row zero is the near-shop edge (z 7.5), and image columns increase with x. A two-pixel white border keeps clamped samples outside the footprint neutral. The runtime assigns this texture only to upward-facing asphalt/concrete surfaces below 0.4m.

Static geometry casts the occlusion. Camera-visible receivers are copies of the actual qualifying ground triangles, shifted upward by 0.4mm to avoid coincident self-hits. The bounded 1.1m occlusion distance captures local contact shading without painting a permanent directional shadow. The adjacent `ground-ao-source.json` records hashes, tool versions, sample count, receiver membership, bounds, and orientation.

Compact review images and provenance are retained under `art/blenderproc-review/`; full PNG intermediates and exported scene JSON stay outside the repository.
