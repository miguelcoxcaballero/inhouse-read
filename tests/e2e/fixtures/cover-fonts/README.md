# Cover-analysis fixture fonts

These five unmodified TrueType files come from the official [DejaVu Fonts 2.37 release](https://github.com/dejavu-fonts/dejavu-fonts/releases/tag/version_2_37), archive `dejavu-fonts-ttf-2.37.zip`.

Archive SHA-256: `7576310b219e04159d35ff61dd4a4ec4cdba4f35c00e002a136f00e96a908b0a`.

| File | SHA-256 |
| --- | --- |
| DejaVuSans.ttf | `7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954` |
| DejaVuSans-Bold.ttf | `e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724` |
| DejaVuSerif.ttf | `42d1edeb7952f31b1f96d767ed7030b08a39e0c372b0071641518864e2bffb51` |
| DejaVuSerif-Bold.ttf | `c47b5527bcdc8dcf9ea8c77054454c5a884beaca2f44851a2a823ee639cbf07f` |
| DejaVuSerif-Italic.ttf | `2e39b1d50f90b933b00c7bb54a96afd3f86419b3d717c7cf202e36f2d4973e47` |

The original distribution's full `LICENSE` is included. DejaVu changes are public domain; the Bitstream Vera and applicable Arev notices permit redistribution with those notices preserved. See the [upstream licence](https://dejavu-fonts.github.io/License.html).

Only `tests/e2e/helpers/cover-corpus.js` loads these fonts, under isolated fixture family names, and waits for all five `FontFace.load()` promises before drawing the corpus. They are not installed into the operating system or imported into the production application. A missing file fails the fixture instead of silently substituting a system font.
