# Follow-up rendering verification

October 22, 2026 — continuing the Legacy shop update.

Three concrete rendering issues were corrected:

1. Gentle movement no longer reactivates the book’s dust illumination after the book closes. The focused regression failed before the fix, then confirmed closed → open → closed stays at 0 → 0.12 → 0, with the shop lamps off.
2. The reflection camera reaches the new street sky. A test uses the bundled CubeCamera and PMREMGenerator with a no-op renderer, raycasts the actual sky sphere, and verifies its front sky point lies inside the capture frustum. This failed at the former 24-unit far plane and passes at 60. No GPU visual claim is made.
3. The OPEN/CLOSED door status has separate readable inward and outward faces. A mocked canvas exercises the browser’s CanvasTexture/PlaneGeometry construction path; the test verifies face normals, placement, lettering, batching preservation, and synchronized state changes.

Changed application modules use new cache keys. The author’s book and the shop-hour behavior are unchanged.

Validation: `node --test --test-reporter=spec scripts/*.test.mjs` — **146 passed; zero failed, skipped, or cancelled**. JavaScript syntax and whitespace checks also passed. Source audit found no incompatibility in the storefront’s shader injection with the bundled Three implementation; this is not a GPU compilation result.

Browser QA remains unverified. The supported preview status check still reports that `/tmp/sites-previewd/requests` is unavailable. No replacement browser/server infrastructure was started. Actual Chrome/Safari rendering, fullscreen behavior, and physical touch feel still require browser/device verification.
