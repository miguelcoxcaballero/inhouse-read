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
