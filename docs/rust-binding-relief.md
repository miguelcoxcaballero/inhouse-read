# Native binding relief raster sampling

The generated 256 × 1024 spine RGBA bitmap is copied into the existing binding arena once. Rust samples its alpha channel in the original column-first mesh order, including the inverted vertical texture coordinate and exact raster-edge clamping. A detail binding therefore no longer calls its JavaScript bitmap sampler 37,345 times. Arbitrary caller-provided relief callbacks retain their previous observable call order and reentrancy behavior.

The mesh resolution, relief amplitude, vertex/index types and owned output buffers are unchanged. The raster shares the binding's temporary allocation and is released on success, rejection or an exception. No persistent native bitmap cache is introduced.

Validation: `npx vitest run tests/unit/binding-wasm.test.js --maxWorkers=1` passes 22 tests. Native-raster cases compare every position, normal, UV and index byte with the frozen pre-migration geometry at five resolutions, including the uint32 index boundary. Additional cases cover raster edges, allocation and kernel memory growth, output independence and rejected-kernel cleanup. Existing arbitrary-callback order, recursive-kernel and exception cleanup checks still pass.

`node scripts/benchmark-binding-relief.mjs` compares the previous JavaScript bitmap callback with native bulk sampling while both use the same Rust mesh generator. It includes allocations, the full bitmap copy, native calls and all owned output copies; it alternates 31 measured rounds after 30 warmups. One local Node 24.19 run measured median per-geometry times:

| Mesh | Previous callback | Native raster | Speed ratio |
| --- | ---: | ---: | ---: |
| Overview, 16 × 384 | 0.434 ms | 0.278 ms | 1.56× |
| Shelf, 32 × 96 | 0.199 ms | 0.151 ms | 1.32× |
| Detail, 96 × 384 | 2.266 ms | 1.378 ms | 1.64× |

These are CPU construction measurements on this machine, not whole-app frame rate or phone battery/temperature measurements. All geometry byte comparisons passed before timing. Browser/physical-device tests are not part of this isolated kernel change.
