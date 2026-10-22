# Smooth touch controls verification

Prepared October 22, 2026.

## Delivered behavior

- Replaced the four touch arrows with a circular movement stick at the lower left of phone and tablet screens, including tablets with a connected mouse or trackpad.
- Continuous 360-degree movement with a small resting zone and gradual walking speed toward the rim.
- Crossing into the lower half requests one eased 180-degree turn. Returning above the center requests the original heading. A buffer around the dividing line prevents repeated turns from finger jitter.
- Movement keeps the heading captured when the stick was grabbed, so the camera turn does not curve the walking path.
- Touch looking uses 0.002 radians per pixel instead of the mouse's unchanged 0.0045, with time-based smoothing. Ordinary lifts complete only the requested movement in a bounded 100 ms settle, preserving quick swipes without adding momentum.
- Two fingers control movement and looking independently. Deliberate looking takes priority over automatic turning. Release, cancellation, lost capture, app interruption, and viewport changes clear the appropriate input.
- The stick remains clear of shelf information; short phone cards scroll to preserve room above them. Existing keyboard movement, object selection, collisions, book content, and room assets are preserved.

## Verified

- `node --test --test-reporter=spec scripts/room-*.test.mjs`: **78 passed, 0 failed**.
- Tests exercise the app's actual input handlers as well as the camera, movement, and stick modules.
- Both finger-release orders, unrelated pointers, quick swipes between frames, cancellation, hidden-page reset, halfway crossing, no repeated spins, and stable walking during turning pass.
- Camera smoothing and swipe completion agree at 30, 60, and 120 frames per second.
- All 20 shelf objects and plaques fit clear of the controller and card at 320×568, 390×844, 768×1024, 1024×768, and 844×390 using the delivered geometry and configured layout dimensions.
- Runtime syntax, unique HTML IDs, control references, and changed-file whitespace checks pass.

## Verification limit

Browser Use connected to the host browser. The managed preview service was unavailable: `sites-preview start` and `status` reported a missing `/tmp/sites-previewd/requests` mailbox. The browser could not load `http://terminal.local:4173/`. No live browser rendering, actual touchscreen, or subjective movement-comfort test was completed in this session. Layout verification above is geometry-based, not a screenshot or physical-device claim.

## Content preservation

- `dist/content/oath.txt`: SHA-256 `1460bd439dbe372c738c25c716bb858821c3fa6adde8ec545b27a10ac29d7193`.
- `dist/content/book.json`: SHA-256 `ceb2aeae0c89414099f8508e11caf42f0ea124ca01fde70c138ac7782def0591`.

The two incomplete, untracked checkout-download fragments were moved outside the Site into `checkout-downloads.quarantine`; neither is included in the published files.
