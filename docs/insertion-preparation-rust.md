# Insertion program preparation in Rust

The insertion preparation facade now delegates idle scheduling, cancellation checks,
prelink sequencing and material collection to `gpu_program_policy.rs`.
Three/WebGL objects remain host handles. No hidden geometry is rendered.

The continuation is a JavaScript promise with a bound static WASM export, so no
persistent Rust closure or spawned task retains a disposed scene. Uniform
reflection keeps its existing idle slices, readiness checks and deadline.

Material collection deliberately follows compilation and `onLinked`, since those
callbacks can change the scene. Materials and programs retain identity-based
Set deduplication; errors reject the returned promise.

Validation: Rust UI/shelf WASM compilation and Vite production build. No new
runtime performance measurement is claimed for this policy migration.
