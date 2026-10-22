# Legacy regression checklist

Prepared October 22, 2026 for the reported wall-object, card transparency, and
scrolling regressions. This is the acceptance checklist for the repair and the
earlier requirements that must remain intact.

The source audit started at `a4344729fe1c9c0363af92b8d21f355f684ba157`.
Checked source, previous test reports, and browser behavior are separate kinds
of evidence. A checked source-preservation item does not mean the corresponding
interaction has passed in a browser. No claim of zero possible regressions is
made.

## Repair verification completed

- [x] All six original object groups select from their real visible geometry,
  before and after visibility partitioning. All nineteen original bottle
  assemblies are covered; walls block selection of objects behind them.
- [x] All 26 discovery cards render their complete descriptions and expected
  destinations in the application logic tests. Middle-rack trails start open.
- [x] Original labels retain a discovery slot when nearer rack labels compete.
- [x] Card roots and their text/link surfaces have transparent backgrounds;
  the stylesheet contract checks later, more-specific, and media rules too.
- [x] Card and menu gaps receive native vertical scrolling input. Focused cards
  do not send arrow keys to room movement. Touch scrolling itself still needs
  the browser checks below.
- [x] All twenty miniatures and plaques fit eleven modeled phone/tablet/desktop
  layouts with the shipped enlarged controls, including 568 x 320 and 600 x 360
  landscape. The model uses long, expanded cards; it is not a browser measurement.
- [x] Changed-file JavaScript syntax and 38 relative asset/import references
  pass. Authored book hashes remain unchanged.
- [x] Final full suite: `node --test scripts/*.test.mjs` — **193 passed,
  zero failed, zero skipped**. This includes existing movement, two-thumb input,
  closing story, real-time/solar, storefront, rendering, collision and asset tests.
- [x] `git diff --check` is clean. No renderer/shader or authored book content
  was changed by this repair.

The acceptance checklist below is the remaining **live browser/manual signoff**,
including visual and touch aspects that automated logic and geometry checks
cannot establish. The managed preview service is unavailable in this session
(`sites-preview status`: missing `/tmp/sites-previewd/requests`). This prevented
live Chrome/Safari verification; it is not recorded as a passing check.

## Source preservation checked during this audit

- [x] All six original discovery groups still exist: maps, bottles, sounds, sky,
  paper, and time. Each has three links.
- [x] The original 18 link titles, descriptions, and destinations exactly match
  the catalog immediately before commit `9411d1f` added the twenty exhibits.
  The comparison uses the complete link tuples, not only a count.
- [x] The catalog contains twenty middle-rack exhibits, ten on each face, and
  58 total primary/related link entries across the 26 discovery groups.
- [x] Douglas's authored files match the previously recorded hashes below.
  The complete current manifest and oath were read as required by `AGENTS.md`.

| Authored file | SHA-256 |
| --- | --- |
| `dist/content/book.json` | `ceb2aeae0c89414099f8508e11caf42f0ea124ca01fde70c138ac7782def0591` |
| `dist/content/oath.txt` | `1460bd439dbe372c738c25c716bb858821c3fa6adde8ec545b27a10ac29d7193` |

Repeat the hash check after repairs. Do not alter the author's wording, invent
chapters or principles, or describe atmospheric discovery copy as the author's
doctrine. The entrance remains an ordinary shop; the book's identity is revealed
only when the visitor chooses it. Site asset paths remain relative, and the
existing published audience is preserved.

## Acceptance checklist for the repair

### Original wall objects and twenty middle-rack exhibits

- [ ] Each original group can be discovered and inspected through its visible
  marker and the Look around menu. A deliberate tap on its visible physical
  object opens the matching inspection, without selecting through an obstruction.
- [ ] Verify all six originals individually: **Maps, folded into maps**;
  **Cloudy bottles & specimens**; **A horn that almost remembers**;
  **A little world in brass rings**; **Unsorted papers**; and
  **Keys without their doors**.
- [ ] Every original inspection shows its full description and all three
  correctly named destinations. Each destination opens in a new tab while the
  visitor's shop position remains available.
- [ ] All twenty middle-rack objects and their physical plaques select the
  correct exhibit from the visible shelf face. First selection inspects; a
  deliberate selected-object or website action opens the correct destination.
- [ ] Previous, Next, Other side, and Look head-on work across both rack faces.
  End controls, focus, and route interruption have no dead ends.
- [ ] The rack's full description, opening question, trail, evidence description,
  and any related links remain readable. Additional details are discoverable and
  do not appear to end after one sentence.
- [ ] Original wall discoveries remain discoverable while nearby rack markers
  compete for limited screen space. Sparse labels do not make originals inert.
- [ ] Book selection still works at its table, and opaque intervening furniture
  does not permit selection of an object behind it.

### Transparent, readable, scrollable information

- [ ] Both original-object and rack cards allow the room to remain visible
  through the card, without a nearly opaque card-sized background or heavy blur.
  Text and controls remain readable against bright and dark scene regions.
- [ ] Long content scrolls to the last destination/action using touch, a wheel
  or trackpad, and keyboard navigation. Test gestures starting on text, links,
  controls, and blank space inside the card.
- [ ] Scrolling a card cannot turn the camera, move the player, dismiss the card,
  activate an underlying object, or accidentally open an external site.
- [ ] Arrow-key scrolling within a focused information region is separate from
  room movement. Tab focus reaches offscreen links and scrolls them into view.
- [ ] Close and Escape dismiss the information and restore useful exploration
  focus. Looking or walking deliberately in the exposed room still releases an
  inspection naturally.
- [ ] The Look around menu is also fully scrollable and usable in a short
  viewport. The simple/fallback view retains access to every discovery.

### Phone, tablet, desktop, and controls

- [ ] Verify portrait and landscape at 320 x 568, 390 x 844, 768 x 1024,
  1024 x 768, and 844 x 390, plus a desktop viewport. Include safe-area insets,
  browser bars, text zoom, and tablet use with a connected pointer.
- [ ] Cards, selected objects/labels, header, clock, footer text, sound control,
  and the enlarged stick remain readable and operable without overlap.
- [ ] The lower circular stick replaces arrows, moves continuously through
  360 degrees, has a stable center dead zone, and scales speed smoothly.
- [ ] Preserve twice the usable thumb travel: phone 60 px with a 180 px pad;
  tablet 72 px with a 204 px pad; short viewport 50 px with a 154 px pad.
- [ ] Preserve half the prior touch-walking speed: maximum 0.675 world units
  per second. Preserve touch-look sensitivity of 0.001 radians per pixel and
  frame-independent smoothing without drifting after release.
- [ ] Crossing the lower stick half requests one gentle 180-degree turn with
  jitter protection, taking 2.4 seconds, or 3.2 seconds in Gentle mode.
  Movement retains the heading captured at the start of the stick gesture.
- [ ] Two thumbs can move and look independently. Explicit looking wins over
  automatic turning. Release, cancellation, lost capture, visibility changes,
  and viewport changes clear the correct inputs.
- [ ] Keyboard navigation, crouching, walking collision, both aisles, both rack
  ends, and interrupted guided approaches remain functional. Room movement
  never takes over text inputs, the reader, forms, or browser shortcuts.

### Real time, closing story, storefront, and daylight

- [ ] Clock and date use actual `America/Indiana/Indianapolis` time, including
  daylight-saving changes, independently of the visitor's device timezone.
- [ ] At 7:59 PM the owner says exactly: "We are closing now. Anyone still back
  there?" The line is always captioned and is audible when sound is enabled.
- [ ] Leave is offered first. Hide is offered only after eight visible seconds
  of hesitation; background time does not count and the choice is never made
  for the visitor.
- [ ] Leaving travels through the glass shop door to the sidewalk. Glass
  windows on both sides reveal the city; the entrance is not a black void.
- [ ] Choosing Hide reaches the concealed crouching position before recording
  arrival. After closure and six seconds hidden, the visitor can continue
  exploring the darkened shop. Leaving during an approach cancels that approach.
- [ ] Shop lamps go off at 8 PM. Late entry, hidden-tab resume, reload, midnight,
  and the next opening do not bypass or trap the closing sequence.
- [ ] Cars, SUVs, city buses, school buses, garbage trucks, pedestrians,
  joggers, and dog walkers continue their varied street activity.
- [ ] Indianapolis sunrise, sunset, sun direction, exterior illumination, and
  street lamps reflect real seasonal time. Turning back toward the street does
  not restart actor routes or visibly recreate the world.

The existing implementation assumes a 9 AM opening because the user specified
only the 8 PM closing time. Preserve that established assumption in this repair.

### Graphics, performance, and the book

- [ ] Preserve interior/exterior photographic material detail, authored color,
  baked lightmaps, storefront geometry, reflection probes, sunlight, street
  lights, contact shading, actor animation, door motion, and rendering fallback.
- [ ] Preserve the executed BlenderProc static ground-occlusion bake and its
  asset provenance. Moving actors and sunlight remain dynamic.
- [ ] Frustum culling skips unseen rendering/animation work while preserving
  visible edge surfaces, shadow casters, nearest-surface picking, and continuity
  when the visitor turns. No visible popping or stale street state is accepted.
- [ ] The book opens and closes correctly, preserves the bookmark, supports
  page turns, contents, chapter selection, plain reading, Gentle mode, and
  sound/caption settings. Its authored files still match the hashes above.

## Evidence and checks still needed

| Evidence | Status and scope |
| --- | --- |
| Original catalog tuple comparison and authored hashes | Verified during this source audit; repeat after the repair. |
| Existing application test suite | Final repair run: 193 passed, zero failed, zero skipped. Baseline: 181 tests. The repair adds twelve checks and strengthens existing input and framing tests. |
| Shader compilation | Previous realism report records 57 programs compiled and linked on native Mesa EGL/OpenGL ES 3.2; this does not prove browser appearance or device performance. |
| Real geometry and routes | Tests cover all twenty shelf objects/plaques, all six original assemblies, nineteen original bottles, the book, collision routes, closing navigation, and frustum triangle preservation. Nearest-hit routing prevents selection through intervening furniture. |
| Card transparency and scrolling | Browser/manual verification pending. Prior extracted-logic tests did not establish computed styles, hit testing, content scrolling, or final layout. |
| Phone/tablet framing | Updated to 180/204/154 px sticks and maximum expanded card bounds; all twenty exhibits pass eleven modeled layouts. Actual browser bounds remain unverified. |
| Chrome/Safari and physical touch | Pending. Previous managed preview attempts failed because `/tmp/sites-previewd/requests` was unavailable; some earlier cloud contexts had WebGL disabled. Those conditions are not passing results. |
| Current repair suite, syntax, local references, whitespace | Passed: full 193-test suite; `node --check dist/app.js`; `node --check dist/curiosity-picking.js`; all 38 changed-file relative references; `git diff --check`; both authored hashes. |
| Saved/published revision and remote push | Release gate: package this exact checked source, save/deploy it, and verify GitHub main. The completion message supplies the resulting live URL and exact remote commit after success. |

The earlier framing fixtures in `scripts/room-shelf.test.mjs` still modeled
120/132/104 px sticks. Updating them exposed real portrait clipping. The repair
reserves more portrait space for the object, uses a compact header and a native
scroll card on short portrait screens, and uses side cards in landscape even
below 601 px wide. The full 180/204/154 px controls remain unchanged. Very short
viewports with unusually large combined safe-area insets, browser bars, or text
zoom still need live-device review.

Useful existing checks include `node --test --test-reporter=spec
scripts/*.test.mjs`, JavaScript syntax checks for changed modules, local asset
and import resolution, `git diff --check`, and authored-file SHA-256 checks.
Add focused tests that fail for the reported interaction defects; use browser
verification for scrolling, computed transparency, layout, and gestures.

## Existing platform and pipeline limits

- Browsers do not allow a website to force fullscreen on initial load without
  the required user gesture. The existing entry gesture requests supported
  fullscreen modes and supplies Home Screen/standalone guidance where needed.
  Verify graceful rejection and continued navigation; do not promise automatic
  removal of Chrome or Safari bars on every device.
- Current reflections use probes and screen-space rays; this is not live
  hardware ray tracing or path tracing. Offline ray-traced bakes and BlenderProc
  renders are separate evidence. No numerical percentage of realism is claimed.
- StableGen preparation exists, but no working ComfyUI inference backend was
  available for the previous pass. No StableGen AI textures were generated or
  included. Preserve this distinction until an actual inference job and asset
  review complete.
- Existing GitHub/Sites storage already holds this project. Moving it to a
  different service or large-project space is unnecessary unless an observed
  repository, file-size, or delivery limit requires it.

Historical detail is in `art/v8-verification.md`, `art/v9-verification.md`,
`art/v10-movement-verification.md`, `art/v11-touch-verification.md`,
`art/v12-shop-hours-verification.md`, `art/v14-gentler-controls-verification.md`,
and `art/realism-pass-verification.md`. Those records describe their own revision
and verification limits; they are not substitutes for accepting this repair.
