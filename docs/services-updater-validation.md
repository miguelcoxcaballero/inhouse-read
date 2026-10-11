# Shared updater validation · Android 1.1.13 · 2026-10-11

- Explicitly requested B release, also included in A: Android 1.1.13, global versionCode 26. Original package `com.inhousesoftware.read` and permanent signing certificate retained (SHA-1 `c83a3b38b79e0e4a44a069222a8524e60115ce76`).
- Canonical updater 1.2.0 at `53c7b0a6d01bbbc7cee1663c5a5bbac145f896d8`, including the new download panel. All shared files pass the lock verifier.
- Public APK downloaded and verified: 78,532,469 bytes; SHA-256 `3b01272323158dd4d5c51a20374a9928b4e17a2b9a35b30b68d00056115ba2c5`. Its production loader and shared native installer are present; both channel catalogs reference these exact bytes.
- [Signed build and Android 15 checks](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38175283676) pass, including cold/warm/shared imports, reader layout/lifecycle, and background EPUB/PDF playback. Attempt 1 had an independently confirmed transient ADB transport disconnect; the unchanged full retry passed. No gate was removed.
- Local updater adapter (5 cases), native shell (13), display verifier (60), background verifier (24), and three built-page updater integration cases pass. The production CI unit job also passes. Existing unrelated reader/audio UI failures were reproduced in the pre-change run and are not reported as a green full UI suite.
- The deployed web updater was exercised on the actual public site: default B offer, exact URL/hash passed to the native adapter and visible 50% download progress. Catalog and native callbacks were simulated for that browser check. Existing channel consent, manual updates and 14-day deferral remain covered.
- Web 1.7.134 delivered the updater; concurrent web 1.7.135 source changes were preserved before publishing B. The Android shell continues to load the shared production website; B controls the APK catalog, not a separately pinned web deployment.

## Earlier validation: Android 1.1.11

- Android 1.1.11 (code 24), channel A; web 1.7.123. Parallel Rust PDF/shelf improvements retained.
- Shared updater revision is pinned in `inhouse-updater.lock.json`; every copied file matches the canonical source.
- Build and native Android 15 checks pass: https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38152535152 . These include display/import/background playback regression checks, not a physical-device account test.
- Full local unit run: 3897 tests passed; one assertion expected the old APK filename. It now reads the configured builder version; all 9 cases in that suite pass. Shared updater unit cases (5), status-bar cases (10) and Android shell checks (13) pass.
- Production Vite/Rust build passes. Two tests in the built page verify exact channel A URL/hash handoff, same-channel GitHub fallback, optional reminder, native preference persistence, empty B and manual override.
- Updates never use generic GitHub latest. New changes go to A; B needs explicit user approval. Before B is promoted, its hosted web content must also be pinned, as explained in UPDATER.md.

The Android download landing page reads and validates channel A using the canonical catalog validator. Three browser cases pass: current A link/size, failure fallback and return to the web app.
