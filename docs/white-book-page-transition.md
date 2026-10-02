# White paper in the book animation — 1.7.6

The physical book uses white page stock. Its snapshot contains the actual current page on white paper, with the same layout as the reader. During the opening zoom the texture cross-fades to the selected reader theme; closing reverses the blend before replacing the bookmark and shutting the book. Original PDFs retain their unfiltered document pixels in the physical snapshot. The non-WebGL fallback follows the same blend.

Verification: 133 focused unit tests passed across book-model, page-theme-transition, page-snapshot, foliate-page-snapshot and pdf-page-snapshot. Three mobile-size real WebGL end-to-end cases passed: EPUB sepia, EPUB night and PDF night. The EPUB sepia sample changed from RGB 255/255/255 to 238/224/196 on opening and gradually back to 255/255/255 on closing. PNG crops and sampled frame JSON are retained locally in `.lighting.local/white-pages/`.

These checks used a dedicated preview at port 4182 and verified that its main JS and CSS matched the freshly built dist; the already-running server on port 4173 was serving an older artifact. Tests against that server were excluded from the results above. The production build, including the legacy PDF chunk compatibility step, passed.

After release, the EPUB sepia transition was also checked against the live 1.7.6 application: 1/1 real WebGL end-to-end case passed in 19.4 seconds. The live opening and closing captures and sampled frame colours are retained in `.lighting.local/white-pages-live/`.
