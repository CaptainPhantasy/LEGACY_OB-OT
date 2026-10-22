# Gentler touch controls

October 22, 2026.

The joystick already accepts continuous fractional input, so there is no finite
speed-step count to double. Its usable center-to-rim thumb travel is now doubled
at each touch layout, preserving the existing thumb size and continuous input:

| Layout | Previous travel | Current travel | Current pad diameter |
| --- | --- | --- | --- |
| Phone | 30 px | 60 px | 180 px |
| Tablet | 36 px | 72 px | 204 px |
| Short viewport | 25 px | 50 px | 154 px |

At every normalized stick position, walking speed is half its previous value.
Full-rim walking is now 0.675 world units per second instead of 1.35. Combined
with doubled travel, a one-pixel radial adjustment in the active range changes
walking speed by one quarter of its former amount. The dead zone, circular
clamping, gesture heading anchor, and release cancellation remain intact.

Touch-look sensitivity is 0.001 radians per pixel, half the previous 0.002.
Automatic half-turns take 2.4 seconds (3.2 in Gentle mode), twice their previous
duration. Existing frame-independent smoothing and the bounded 100 ms release
settle remain responsive. Mouse and keyboard settings are unchanged.

The larger pad continues to use the reserved footer and touch-dock layout.
The shelf inspection panel retains at least 112 px of scrollable height on
short portrait screens. Runtime and stylesheet cache keys were refreshed.

Validation: `node --test --test-reporter=spec scripts/*.test.mjs` — 149 passed,
zero failures, cancellations, skips, or todos. New regressions exercise actual
walking displacement across 60 radius/direction combinations, fractional
near-center precision, CSS-derived travel for all three layouts, pixel-level
pointer response, turn timing, and release behavior. Syntax and whitespace
checks pass. The author's book manifest and oath hashes remain unchanged.

Live browser/device verification remains unavailable: the supported preview
supervisor reports that `/tmp/sites-previewd/requests` is missing. The checks
above do not establish physical touch feel or live layout appearance.
