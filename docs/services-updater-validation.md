# Shared updater validation · 2026-10-11

- Android 1.1.11 (code 24), channel A; web 1.7.122. Parallel Rust PDF/shelf improvements retained.
- Shared updater revision is pinned in `inhouse-updater.lock.json`; every copied file matches the canonical source.
- Build and native Android 15 checks pass: https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38152535152 . These include display/import/background playback regression checks, not a physical-device account test.
- Full local unit run: 3897 tests passed; one assertion expected the old APK filename. It now reads the configured builder version; all 9 cases in that suite pass. Shared updater unit cases (5), status-bar cases (10) and Android shell checks (13) pass.
- Production Vite/Rust build passes. Two tests in the built page verify exact channel A URL/hash handoff, same-channel GitHub fallback, optional reminder, native preference persistence, empty B and manual override.
- Updates never use generic GitHub latest. New changes go to A; B needs explicit user approval. Before B is promoted, its hosted web content must also be pinned, as explained in UPDATER.md.
