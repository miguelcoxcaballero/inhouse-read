# Opening-clause planning in Rust

The first narration fragment's clause boundary is now selected in
`speech_plan.rs`. Rust scans punctuation, consumes ECMAScript whitespace and
applies the original 24–90 UTF-16-unit opening limit and 24-unit minimum tail.
The browser supplies Unicode script classification for Han, Hiragana and
Katakana. Surrogate pairs retain their original offsets.

Production calls `speech_pipeline_native`, which uses the normalized text
already owned by the Rust planner. It does not copy a substring back into WASM
or build a JavaScript list of all regex matches. The existing `speech_pipeline`
and `speech_plan` callback APIs remain compatible.

Validation: 146 tests passed across opening-clause differential cases, complete
pipeline equivalence, speech text, fragment planning and 1.3/2.3-million-unit
texts. The opening tests include 4,000 generated sliced paragraphs, exact length
limits, unusual whitespace, CJK, emoji and unpaired surrogates.

The initial standalone native-call prototype measured slower for short Latin
text because of argument copying and dispatch. The integrated production path
avoids that extra call. A local Node/WASM comparison of the complete pipeline
(nine alternating rounds, 100 warmups and 500 calls per round) measured median
microseconds of 5.40→4.89 for Latin, 6.11→6.46 for CJK, and 5.11→4.82 without an
eligible cut. These short timings include noise and do not establish a general
app speedup; this batch removes duplicated policy and temporary match arrays.

## First complete visible sentence

`speech_first_complete` selects the first sentence beginning at or after the
visible offset, including the previous physical page's prefix. It returns one
native offset, so the host no longer constructs and then discards a complete
JavaScript graph of fragments and sentence objects. It reads sentence boundaries
directly, without generating a fragment plan for this query. Normalization is
shared with the existing plan and normalized-text APIs. Prefix string conversion,
browser case folding and the fallback raw string length preserve host semantics.

All 157 related tests pass, including 1,050 comparisons of the previous
complete-plan selection with varied prefixes, offsets and footnote options.
Rust and Vite production builds pass. A local seven-round alternating Node/WASM
comparison (10 warmups, 100 measured calls per round) gave median microseconds:
540 characters 24.78→20.57; 5,400 characters 154.91→146.34; 54,000 characters
1,524.30→1,415.23. The text-analysis cost remains; these are function timings,
not total audiobook startup measurements.
