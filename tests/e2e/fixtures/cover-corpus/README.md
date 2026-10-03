# Canonical cover-analysis pixels

These twelve original test illustrations are rendered by `tests/e2e/helpers/cover-corpus.js`. They use the unmodified, licensed DejaVu 2.37 fonts in `../cover-fonts/`. No production book covers or external photographs are included.

The test loads these PNGs by default. Pinning fonts alone still permits different DirectWrite/FreeType antialiasing between Windows and Linux; PNGs make the input pixels identical. `sha256.json` records every file's digest. The initial corpus was generated with Playwright 1.63.0's bundled Chromium on Windows after every fixture `FontFace.load()` completed.

To regenerate deliberately, set `IHR_RELIEF_REGENERATE=1` and `IHR_RELIEF_EVIDENCE_DIR` to an ignored output directory, then run `tests/e2e/cover-relief.spec.mjs`. Review the generated `*-source.png`, `corpus-report.json`, render metrics and assertions before replacing these twelve files and updating their SHA-256 digests. Ordinary test runs never rewrite fixtures or fall back to system fonts.

The illustrations, fonts and regeneration code are only test inputs and are not imported by the application build.

## Colour-mask additions

The helper also builds exact three-colour bands (`#2350b5`, `#d4a93c`, `#fffaf0`), geometric antialiased circles, a JPEG quality-0.35 encode/decode of the bands, and one-/two-colour controls. Their masks are checked against independent region and OKLab-distance oracles, rather than the production detector. No system fonts are involved.

`16-cc0-flower-photo.jpg` is an unmodified real photograph by **Abinayasekar357**, *Flower photos*, taken 23 November 2022, uploaded 15 November 2023. The author dedicated it under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

- [Author's source and licence declaration](https://commons.wikimedia.org/w/index.php?title=File:Flower_photos.jpg&oldid=1108695349)
- [Original JPEG](https://upload.wikimedia.org/wikipedia/commons/4/44/Flower_photos.jpg)
- Dimensions: 1319 × 1265; 537,836 bytes.
- SHA-256: `452989d319305081b0add7890d06852b67e52c87cbe867663449b60f933009c6`.
- Wikimedia SHA-1, checked on download: `bdf2cafd9aba23f59390882cf1c45eabe502e10f`.

The original JPEG is retained; only the browser's bounded analysis raster is resized. This photograph tests continuous colour variation, JPEG compression, small surface details and antialiased boundaries. It is never shipped as an application asset.
