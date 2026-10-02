# White paper in the book animation — 1.7.6

The physical book uses white page stock. Its snapshot contains the actual current page on white paper, with the same layout as the reader. During the opening zoom the texture cross-fades to the selected reader theme; closing reverses the blend before replacing the bookmark and shutting the book. Original PDFs retain their unfiltered document pixels in the physical snapshot. The non-WebGL fallback follows the same blend.

Verification: 133 focused unit tests passed across book-model, page-theme-transition, page-snapshot, foliate-page-snapshot and pdf-page-snapshot. Three mobile-size real WebGL end-to-end cases passed: EPUB sepia, EPUB night and PDF night. The EPUB sepia sample changed from RGB 255/255/255 to 238/224/196 on opening and gradually back to 255/255/255 on closing. PNG crops and sampled frame JSON are retained locally in `.lighting.local/white-pages/`.

These checks used a dedicated preview at port 4182 and verified that its main JS and CSS matched the freshly built dist; the already-running server on port 4173 was serving an older artifact. Tests against that server were excluded from the results above. The production build, including the legacy PDF chunk compatibility step, passed.

After release, the EPUB sepia transition was also checked against the live 1.7.6 application: 1/1 real WebGL end-to-end case passed in 19.4 seconds. The live opening and closing captures and sampled frame colours are retained in `.lighting.local/white-pages-live/`.

## Prepared-page handoff — 1.7.8

The live 1.7.7 check passed EPUB night and sepia but exposed one stale PDF state: its first `opening` sample still reported `pageTheme:1`, with the cover completely closed and no page pixels visible. Every subsequent visible hinge/bookmark sample was white. An interrupted idle preparation had installed the snapshot without drawing, and reuse skipped the draw. Opening now draws that prepared white pose before announcing its phase; it retains the existing textures.

A deterministic unit regression reproduces the interrupted preparation. All 20 focused unit tests and all nine real WebGL transition cases passed after the correction, without skips, retries or unobserved-frame annotations. The permanent end-to-end file is now `tests/e2e/book-page-theme.spec.mjs`, retaining every previous case. Evidence is stored locally in `.animation.local/white-handoff-evidence/`, with `.animation.local/white-handoff.json` and the matching served-build record `.animation.local/white-handoff-artifact.json`.

The live 1.7.8 deployment passed all three production checks: PDF night, EPUB night and EPUB sepia, in 57.6 seconds with zero skips, failures or retries. Captured opening and closing frames show the current page on white paper, its transition to the selected theme and its return to white before closing. The first prepared opening pose also reports the white blend correctly. PNG crops, sampled frame colours and the Playwright report are in `.animation.local/final-live-evidence/white-178/`; the log is `final-live-white-178.log`. The production entry and all 20 reachable hashed JS/CSS files were fetched and compared byte for byte with the published `gh-pages` artifact for source commit `e310cb75fe2b7cd8e295c1049cf5fba085f96268`.
