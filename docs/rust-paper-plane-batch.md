# Batched endpaper geometry

The remaining pastedown and reading-page geometry in `book-model.js` now comes from one `book_paper_planes` Rust call. The host allocates one bounded arena and installs owned typed arrays on Three.js geometry. Rust owns subdivision, joint positioning, shading, normals, UVs and local triangle indices for both planes. Dimensions, resolutions, material construction and rendering are unchanged.

The original Three.js position buffer rounds every vertex to Float32 before the joint/shading pass. The Rust implementation retains that intermediate rounding and preserves the same operation order. Differential tests compare all vertex, normal, UV, color and index bytes against the frozen original formulas for 182 physical-dimension/overview cases, plus memory growth, output ownership, arena release and invalid input. The existing page-block/leaf suite also passes: 20 tests across both suites.

A local Node microbenchmark (five warmed rounds, 5,000 pairs of planes each, including installation of the Three.js attributes) measured medians of 75.00 ms for the previous path and 33.20 ms for the Rust batch. This concerns only initial plane construction; it is not a device FPS, battery or whole-app performance measurement.

The small half-ellipse case-cap Shape path remains with Three.js triangulation. Moving that separately would require preserving host sine/cosine and Shape triangulation semantics; it is outside this bounded batch.
