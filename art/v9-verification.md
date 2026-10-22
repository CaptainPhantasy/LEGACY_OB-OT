# Twenty rabbit-hole exhibits — v9

Prepared on 2026-10-22. Final delivery verification is recorded below.

## Display and navigation

- The owner's exact 20 starting URLs and object pairings occupy five bays and two levels on each shelf face: entries 1–10 west, entries 11–20 east.
- Every model has measured bounds, a physical plaque, one matching primary URL, a head-on camera stop, an opening question, an optional trail, and an evidence description. The first click inspects an object; the selected object or its website label opens the destination in a new tab.
- Previous, Next, Other side and Look head-on controls preserve access along both aisles and around the shelf ends. Route checks cover all 32 × 32 destination pairs and interrupted movement.
- Selected views retain one website label. Discovery markers are capped at two on phones and three on larger screens. Actual object and plaque bounds fit within four conservative viewport bands, including a 320 × 568 phone and landscape layout.
- All 18 original room links remain unchanged. The 22 previous shelf destinations remain represented by two primary URLs and 20 optional deeper trails. There are 58 link entries and 55 distinct destinations in total. The link-check scope is in `rabbit-hole-link-checks-v9.md`.

## Geometry and lighting

- The 20 assemblies have disjoint display bounds and measured shelf contact. The wall bottles and their supports remain intact. Beveled forms include radio controls, cipher rings, articulated robot legs, raised disc symbols, clock gears, the clear vortex bottle, and telescope feet.
- Final still inspection found five older floating upper-shelf book piles. Exactly 45 connected components / 2,520 vertices were lowered to a measured 0.500 mm clearance. All UVs, topology, materials, unrelated geometry, the hero book and lighting are unchanged by that repair. See `upper-book-grounding-report.json`.
- Both static lightmaps use 4K atlases and Cycles at a 1,024-sample ceiling. The new shelf atlas has zero overlapping interior texels, no invalid UV coordinates, and approximately 318 major-wood texels per metre at the tenth percentile.
- Six broad 3,400 K area sources make the display faces readable. Six steady, non-shadow runtime spotlights supply approximate live specular highlights. The lightmap shader replaces diffuse illumination, avoiding a second diffuse-light contribution. The runtime spot shape is not an exact reconstruction of Blender's area emitters.
- Neutral silver and steel retain their authored colors. Clear display glass retains physical transmission. The RGBM_SQRT atlas decoder and separate room/shelf lightmap assignments remain in place.

## Final delivery checks

- All 36 automated checks passed with zero skipped or failed tests. They include all route pairs and interruption handling, actual app selection behavior, sparse labels, four viewport bands, and nearest-triangle raycasts through the delivered geometry for all 20 objects and all 20 plaques. The original book remains the nearest selectable surface at its reading stop.
- The final 28 export-review stills, seven native material close-ups, and one 1,024-sample entrance render were visually inspected. Final lighting and the five repaired background book piles are included in these images. Per-image SHA-256 hashes and inspection scope are recorded in `room-depth-report.json`.
- Both 4,096 × 4,096 lightmap PNGs match their manifests. The room atlas is 23,992,170 bytes, SHA-256 `d24459327fcacbcbe2b2d42d6545e3b6f66374ecb2193f263591bb875085464e`. The shelf atlas is 16,363,562 bytes, SHA-256 `2c87308b86586bbea435cc64868077a66a214d3b6c38511e30f5ce4279648cc6`.
- The final glTF JSON SHA-256 is `7ac4d841b460d66d3e971917d7bbc934cc341c4529095a6699488e04059af936`. Its ten external binary chunks are each at most 8 MiB. Both atlas manifests retain the export hashes for delivery verification.
- Source is pushed before packaging through the Sites workflow helper. The saved version and production deployment bind the archive to that exact final source commit; public audience settings are preserved.

## Verification limits

The managed Sites preview service was unavailable because its `sites-previewd` mailbox was missing. Geometry, routes, image data, actual exported triangle selection, runtime code paths and rendered stills are checked separately. No live browser GPU, animation smoothness or device-performance result is claimed. Export-review images show baked diffuse illumination and transmission; additional native views inspect metallic materials with physical lighting. These are not browser screenshots.

The author's content remains unchanged. The oath SHA-256 is `1460bd439dbe372c738c25c716bb858821c3fa6adde8ec545b27a10ac29d7193`; the book manifest SHA-256 is `ceb2aeae0c89414099f8508e11caf42f0ea124ca01fde70c138ac7782def0591`.

## Reproduction

From the retained v8 native scene, run `build-rabbit-hole-shelf.py`, the pipeline's `atlas-shelf` stage with 4K shelf resolution, `add-shelf-face-fill.py`, and `ground-upper-book-stacks.py`. The builder includes the final disc-symbol placement and black steel case; `seat-phaistos-glyphs.py` and `material-black-steel-case.py` record bounded migrations of intermediate checkpoints and are not needed after a fresh build. Then run `build-room-depth.py` stages `bake`, `review`, `preview`, and `beauty`, always selecting `--native-file art/room-rabbit-holes.blend`. Inspect the outputs before marking their report flags. `stage-rabbit-hole-assets.py` validates and stages portable assets in bounded commits; native blend files and intermediate EXR files stay outside the delivered website.
