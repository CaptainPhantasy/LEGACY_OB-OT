# Shop hours, city entrance, and mobile controls verification

Verified October 22, 2026. Existing Legacy project and public audience preserved.

## Implemented behavior

- Real clock in America/Indiana/Indianapolis, including daylight-saving changes. Warning at 19:59; shop lamps switch off at 20:00. Reopening is 09:00, an explicit implementation assumption because no opening hour was supplied.
- The exact closing call is spoken from the front corner when sound is enabled and always captioned. The synthesized local MP3 decodes completely: 2.544 seconds, mono, 24 kHz, 40,704 bytes.
- Leaving is offered first. Hiding appears after eight visible seconds of hesitation; background time does not count. Hiding moves to a proven concealed space behind the reading table, confirms arrival, then permits dark exploration after closure and six seconds in the hiding place. Leaving never chooses hiding automatically.
- Confirmed hiding persists across reload and midnight until the next opening. New after-hours arrivals stay outside. Entry that crosses the closing instant returns to the sidewalk, including a backgrounded entry.
- The entrance is a glass door with sidelights, an open/closed sign, continuous threshold pavement, and a surrounding city block. Cars, SUVs, city buses, school buses, garbage trucks, pedestrians, joggers, and dog walkers use eleven bounded actor pools and deterministic absolute-time motion.
- Indianapolis solar position and sunrise/sunset drive the sky, exterior illumination, and street lights. Solar calculations are local, with NOAA equations checked against USNO summer/winter fixtures. See shop-time-sources.md.
- Camera-frustum partitions preserve source triangles, UVs, materials, picking, and offscreen shadow casters. Street animation and dust work skip unseen regions, and street positions resume from current time without resetting their routes.
- Mobile/tablet circular movement and smooth touch look are retained. Responsive footer grid separates the clock, closing status, and sound control. Landscape inspection cards sit beside the scene.
- Fullscreen is requested synchronously on the entry gesture, with standard and Safari-prefixed support, rejection handling, and Home Screen standalone metadata. Browsers do not permit forced fullscreen on initial page load; this is a platform limitation, not a feature the site can bypass.

## Checks passed

Command: `node --test --test-reporter=spec scripts/*.test.mjs`

**143 tests passed, zero failed, skipped, or cancelled.**

Coverage includes:

- Real glTF collision routes from every authored stop and all twenty display inspections to the hiding place and doorway; return routes also remain clear.
- Twelve head/shoulder rays from front corners, doorway, and the voice position confirm the hiding place is occluded by opaque room geometry.
- A swept 0.22 m body clears the open door and frame all the way to the sidewalk. The same closed door blocks that route.
- Glazing replaces only 216 old entrance trim/plaster triangles, preserving floor, ceiling, vertex data, and baked UV attributes.
- Original-room visibility fixture preserves all 879,812 triangles and every nearest shelf-plaque hit. Its submitted room triangles fall from 846,784 inward to 147,874 outward, approximately 83 percent; this is a geometry-submission measurement, not an FPS claim.
- Storefront budget: 179 meshes, 34,724 triangles, eleven actor pools. No additional shadow maps or repeated reflection captures.
- Clock boundaries, winter/summer daylight-saving offsets, midnight, morning reset, both DST transition dates, and host timezone independence.
- Exact warning, hesitation order, audio gating, cancelled approaches, duplicate exit clicks, persisted hiding, 8 PM entry races, hidden tabs, and simple/reduced-motion behavior.
- Real app frame integration dims room materials and lights while exterior time continues correctly.
- All twenty objects/plaques and focused labels remain within calculated visible space across eight phone/tablet/desktop/notch layouts. Clock/footer, joystick, and card bounds remain separated.
- Existing simultaneous two-thumb movement/look, cancellation, half-turn threshold, settling, book behavior, material/lightmap, and navigation regressions.
- JavaScript syntax, static local import/asset resolution, and git whitespace checks passed.

## Content preservation

The author’s book files are unchanged:

- oath.txt SHA-256: 1460bd439dbe372c738c25c716bb858821c3fa6adde8ec545b27a10ac29d7193
- book.json SHA-256: ceb2aeae0c89414099f8508e11caf42f0ea124ca01fde70c138ac7782def0591

## Remaining verification limitation

The managed browser preview command failed because `/tmp/sites-previewd/requests` is unavailable. No alternate browser/server was started. Chrome/Safari rendering, real-device touch feel, fullscreen behavior, and final city visuals have therefore **not** been visually verified. Automated checks operate on real exported geometry and extracted application logic; they do not replace device testing.
