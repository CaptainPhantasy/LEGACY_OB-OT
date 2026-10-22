# Natural movement verification

Prepared October 22, 2026, against the final version 9 exported room geometry.

## Changes

- Removed the horizontal look limit; visitors can turn repeatedly through full circles. The upright camera looks almost straight up or down without flipping.
- Added camera-relative walking, strafing, faster walking, crouching, keyboard turning, touch walking with simultaneous look, and click-to-walk on clear floor.
- Looking or walking away immediately releases object inspection and cancels an approach without requiring the close button. Neighboring objects remain selectable during an approach.
- Preserved the viewing direction when leaving a framed display. Pointer-driven navigation restores room keyboard focus while keyboard-driven interface navigation retains normal focus behavior.
- Added continuous body collision and guided route planning using the delivered scene geometry. The middle shelf, furniture, and walls remain solid; both aisles and shelf ends remain traversable.
- Kept mobile inspection controls compact and reserved their screen area when framing each miniature and plaque.
- Kept book reading, form inputs, browser shortcuts, reduced-motion behavior, and the static fallback separate from walking input.

## Verification

`node --test --test-reporter=spec scripts/room-*.test.mjs`: **52 passed, 0 failed**.

Syntax checks passed for the three changed runtime JavaScript modules. Changed-file whitespace checks passed.

An independent review checked all 32 guided destinations against the actual exported geometry. It tested 768 routes from 24 reachable manual positions using 588,002 dense collision samples, with no collision failures. Complete manual walks around both shelf ends passed in both directions. Continuous swept-circle checks fixed shallow corner crossings that sparse sampling missed.

Automated projection checks cover all 20 shelf miniatures and plaques at 320×568, 390×844, and 844×390, including the compact touch control. Existing selection tests raycast against the nearest real triangles from each head-on stop.

## Limits and preservation

The available cloud browser reported `GL_VENDOR=Disabled, GL_RENDERER=Disabled` and could not create a WebGL context. It displayed the fallback room. This is not live 3D/GPU validation or a measurement of the visitor's machine. The movement and framing results above are automated and geometry-based; the version 9 rendered stills remain the visual evidence for the unchanged scene assets.

No native scenes, exported 3D assets, lighting, textures, or Douglas-authored book content changed in this movement update.

Preserved SHA-256 values:

- `dist/content/oath.txt`: `1460bd439dbe372c738c25c716bb858821c3fa6adde8ec545b27a10ac29d7193`
- `dist/content/book.json`: `ceb2aeae0c89414099f8508e11caf42f0ea124ca01fde70c138ac7782def0591`
