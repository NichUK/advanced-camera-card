# Historical playback validation

Date: 2026-10-05. Implementation checkpoint; ordered dependency reviews and actual Clear codec acceptance remain open.

The rendered date picker selects an exact instant, performs bounded HA media browsing, resolves the covering clip and seeks the actual player to the corresponding offset. Missing coverage leaves no selected clip or playing video. Deferred older metadata cannot replace the latest selection. The mini timeline remains available while a query is pending.

Validation: 7,437 unit tests in 437 files pass; required logic coverage is 100% for statements, branches, functions and lines. Build, TypeScript and lint pass. The rendered browser suite passes 62 tests including existing Frigate timeline clustering and viewer carousel checks. The standalone Shinobi suite passes 43 tests. Its twenty cold and twenty warm runs measure date selection through decoded 3840x2160 video readiness at the correct 60-second offset: p95 410.4 ms cold, 535.2 ms warm (nearest-rank 19th of 20). Raw observations are in browser-timings.json.

Environment: Intel Core i7-1265U, Windows 11 Pro 10.0.26200, Node 24.14.0, Yarn 4.9.1, Vitest 4.1.10, Playwright 1.62.0, Chromium 151.0.7922.34, Europe/London display timezone. Vite serves a synthetic 120-second H.264 MP4 at 3840x2160 and 5 fps, without audio. Cold uses distinct media URLs and fresh cards; warm reuses the media URL with a fresh card. HA metadata and resolution payloads are synthetic; browser MP4 transport and decoding are real. This measures neither remote HA/NVR transport nor original Clear HEVC compatibility. Those acceptance gates remain SHI-10/11; physical iPhone evidence is still required.

Reproduce in PowerShell: set VITEST_BROWSER=chromium and run `corepack yarn@4.9.1 run test:browser tests/camera-manager/shinobi/history.browser.test.ts --reporter=json --outputFile=browser-results.json`. Performance observations are in the final assertion's meta.performance. See tests/browser/fixtures/README.md for reproducible media generation. No residential footage, credentials or production configuration changes are involved.
