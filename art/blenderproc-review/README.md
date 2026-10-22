# Offline scene inspection

These images are Cycles renders made through BlenderProc from the actual exported runtime geometry and surface maps. They are **not live-browser screenshots**. Actor inspection positions are fixed for these images; the website keeps its normal traffic and walking schedules.

- `street-from-door-day.webp`: eye-height view toward the opposite block, with the exported sun direction and Nishita sky.
- `vehicle-and-pedestrian-day.webp`: close inspection of the actual vehicle and pedestrian meshes, pavement, and recessed storefronts.
- `shop-interior-day.webp`: the actual shop and fixtures, with +2 camera exposure stops for inspecting dim surfaces.
- `street-from-door-night.webp`: street lamps and the runtime materials' night emission levels; indoor practical lights are off.

Exterior views use zero exposure compensation. All use 48 Cycles samples and AgX. Geometry remains simplified in places, particularly people; these renders establish the implemented geometry and lighting behavior, not a claim that every asset is photographic.

`provenance-review.json` records the producing tool versions, source and pipeline hashes, per-image exposure, and hashes of the original PNGs and compact WebPs. The original PNGs and scene JSON exports are retained outside the source repository. `provenance-ao.json` records the separate static contact-occlusion bake delivered to the website.
