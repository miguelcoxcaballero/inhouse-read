// Test harness: the production module src/js/readers/neural-voice/supertonic-plan.js and the doorways to the Rust kernels that only the
// tests and the frozen references use (no production module imports them, so they left src).
export * from '../../../src/js/readers/neural-voice/supertonic-plan.js'
import { loadedRustVoiceUI as voice } from '../../../src/js/rust-voice-ui.js'
export const supertonicRuntimeConfig=(config,steps)=>voice().voice_host_supertonic_config(config,steps);
export const supertonicTextIds=(text,indexer)=>voice().voice_host_supertonic_ids(text,indexer);
export const supertonicLocalMarks=(marks,start,end)=>voice().voice_host_supertonic_local_marks(marks,start,end);
export const createSupertonicPcmJoin=sampleRate=>voice().voice_host_pcm_join(sampleRate);
export const supertonicStyleValid=(dims,data)=>Array.isArray(dims)&&Array.isArray(data)&&voice().voice_host_style_valid(dims,Float64Array.from(data,value=>typeof value==='number'?value:NaN));
export const createSupertonicState=()=>voice().voice_host_runtime_state();
