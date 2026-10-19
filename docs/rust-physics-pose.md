# Native physical pose composition

The retained physics frame now composes each object's visible position and lean immediately after the existing solver step. It also selects the book's Euler rotation order and computes the physics movement and projection-quality flags. The shelf host applies the returned position/rotation/scale with Three and continues its normal rendering and live synchronization flow.

This is one native batch over retained buffers; there is no new WASM call per object. The existing 37-number state ends with the final physical position/rotation/scale, and the reusable host scratch buffer receives three additional values: whether a book uses ZYX, whether its physical motion is active, and its projection flags. A retained three-number metadata slot per object carries the decoration collision-stamp input and those outputs. Nothing is allocated for this metadata during an ordinary frame.

The arithmetic keeps the original f64 order, including the different lamp origin and the zero lean comparison. Three still constructs quaternions and matrices using the host's trigonometry. Decorations retain their implicit Euler order; books explicitly select XYZ or ZYX exactly as before. Ceiling lights and decorations without a collision stamp keep the original animation pose. The live room conversion consumes the same final Three pose as before, with no protocol or coordinate-format change.

Validation compares the original host composition with the native result over 300 frames for each combination of frontal/isometric and normal/reduced motion. It checks exact physical output bytes, every meaningful state value, movement/quality flags, Euler order, quaternion components and all matrix elements. The scenarios include deliberate pushing, release, landing/preview animation, reader origin reservation, same-length reordering, removal, plants, standing lamps and ceiling lights. Memory-growth and ownership cases remain included. All 100 cases across the six physics, sound, sync, quality and retained-frame suites passed.

The frame benchmark now includes final pose composition and checks those outputs as well. Its timings compare the complete original bridge with the combined retained-frame/native-pose path; they must not be presented as an isolated speedup caused by pose composition alone.

The Chromium/SwiftShader isometric reader-return test also passed: selecting/dismissing a book, two reader open/close cycles and a reload retained the exact saved shelf layout without page errors. No physical-phone thermal measurement was made.

A final local run of the combined benchmark measured 0.296 → 0.282 ms at 24 objects, 0.424 → 0.354 ms at 96, and 1.350 → 1.068 ms at 240 (1.05×, 1.20× and 1.26×). Other agents were active on the machine, so these are indicative CPU observations, not a guaranteed frame-rate improvement. Every physics result and checked final-pose field matched exactly.
