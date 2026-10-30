// The voice module (`voice` feature, built as src/wasm/voice/inhouse_read_voice_ui): what the synthesis worker and the
// Android client run around the models. The voice kernels are the very sources of the raw voice core (rust-core, its
// `voice` domain), compiled into this module so the host code below calls them on Rust slices instead of laying every
// argument out in another module's memory. The raw voice core is still built from the same files; the tests compare both.
#[path = "../../rust-core/src/voice_math.rs"]
mod voice_math;
#[path = "../../rust-core/src/pcm.rs"]
mod pcm;
#[path = "../../rust-core/src/speech_tempo.rs"]
mod speech_tempo;
#[path = "../../rust-core/src/duration_marks.rs"]
mod duration_marks;
#[path = "../../rust-core/src/synth_flow.rs"]
mod synth_flow;
#[path = "../../rust-core/src/supertonic_text.rs"]
mod supertonic_text;
#[path = "../../rust-core/src/supertonic_runtime.rs"]
mod supertonic_runtime;
#[path = "../../rust-core/src/hebrew.rs"]
mod hebrew;
#[path = "../../rust-core/src/onnx_durations.rs"]
mod onnx_durations;
#[path = "../../rust-core/src/phonemizer_runtime.rs"]
mod phonemizer_runtime;
#[path = "../../rust-core/src/supertonic_catalog.rs"]
mod supertonic_catalog;
#[cfg(not(feature = "ui"))]
mod eager;
mod voice_kernels;
mod voice_phonemizer;
mod voice_supertonic;
mod voice_hebrew;
mod voice_worker;

/// The JavaScript side checks it before using the module.
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn voice_ui_abi_version() -> u32 { 1 }
