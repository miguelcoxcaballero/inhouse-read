# Canonical cover-analysis pixels

These twelve original test illustrations are rendered by `tests/e2e/helpers/cover-corpus.js`. They use the unmodified, licensed DejaVu 2.37 fonts in `../cover-fonts/`. No production book covers or external photographs are included.

The test loads these PNGs by default. Pinning fonts alone still permits different DirectWrite/FreeType antialiasing between Windows and Linux; PNGs make the input pixels identical. `sha256.json` records every file's digest. The initial corpus was generated with Playwright 1.63.0's bundled Chromium on Windows after every fixture `FontFace.load()` completed.

To regenerate deliberately, set `IHR_RELIEF_REGENERATE=1` and `IHR_RELIEF_EVIDENCE_DIR` to an ignored output directory, then run `tests/e2e/cover-relief.spec.mjs`. Review the generated `*-source.png`, `corpus-report.json`, render metrics and assertions before replacing these twelve files and updating their SHA-256 digests. Ordinary test runs never rewrite fixtures or fall back to system fonts.

The illustrations, fonts and regeneration code are only test inputs and are not imported by the application build.
