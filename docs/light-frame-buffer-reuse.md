# Reuse lighting frame views

The shelf occlusion bridge keeps its Float64Array input and two output views
alongside its existing Rust arena. Views are refreshed when WASM memory grows,
both before packing and after the native kernel returns. Output is still copied
to the same shared Float32 shader uniforms.

The adapter previously constructed four typed-array views and one configuration
array on each render. Once the arena and memory buffer are stable, these five
allocations are avoided. Shelf shadow fitting also writes its configuration
directly into the existing native input view, avoiding two temporary arrays
when bounds are present.

This changes host buffer marshalling only: the Rust kernels, arithmetic,
shader code, shadow resolutions, samples, frame scheduling and render cadence
are unchanged. Validation: Vite production compilation. No device CPU, thermal
or battery improvement has been measured for this change.
