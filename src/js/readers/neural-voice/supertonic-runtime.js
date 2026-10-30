// Adapted from Supertone's MIT-licensed web/helper.js inference recipe.
// Copyright (c) 2025 Supertone Inc. See /licenses/supertonic-sdk-MIT.txt.
// The model weights have the separate OpenRAIL-M licence.
import { SUPERTONIC_LANGUAGES, SUPERTONIC_STYLES, SUPERTONIC_LEGACY_STYLES } from './supertonic-catalog.js';
import { speedUpSpeech } from './synth-flow.js';
import { loadedRustVoiceUI as voice } from '../../rust-voice-ui.js';
import { supertonicNoise } from './supertonic-plan.js';
import { yieldToMessages as yieldTask } from './task-yield.js';
const KIT={languages:SUPERTONIC_LANGUAGES,styles:SUPERTONIC_STYLES,legacy:SUPERTONIC_LEGACY_STYLES,noise:supertonicNoise,speedUp:speedUpSpeech,always:()=>true,noop:()=>{}};
// Six steps preserved the tested Dutch/Spanish/English intelligibility at
// <1 RTF in the recorded single-thread desktop WASM benchmark, unlike FP32/8.
export const SUPERTONIC_STEPS = 6;

/**
 * Never squeeze the model's latent below its normal predicted duration.
 * Faster playback is applied to complete speech, with pitch-preserving tempo
 * processing, after inference. A percentage margin still lost words at 2x.
 */
export const supertonicSeconds=(predicted,rate)=>voice().voice_host_supertonic_seconds(+predicted,rate);
/** `<es>text.</es>` for the model, or '' when nothing speakable is left. The cleanup is Rust (rust-core supertonic_text.rs, through
 * the voice module); the compatibility decomposition of Unicode is the browser's. */
export const normalizeSupertonicText=(text,lang)=>voice().voice_supertonic_normalize(text,lang,KIT);

/** Small chunks bound latent/audio memory. Upstream recommends <=300 chars
 * (120 for Korean/Japanese); the reader usually already supplies one sentence. */
export const supertonicTextChunks=(text,lang)=>voice().voice_host_supertonic_chunks(String(text||''),['ko','ja'].includes(lang)?120:300);

/** ONNX Runtime is injected by the existing synthesis worker. Four sessions,
 * one active utterance; no engine/download/UI dependency enters this module. The sessions, the chunks, the inference
 * steps, the boundaries and the join are the voice module (rust-ui/src/voice_supertonic.rs); `kit` hands it the catalogue,
 * the random noise with the browser's Math.log/Math.cos and the tempo. */
export function createSupertonicRuntime(options) {
  try {
    const {ort,buffers,config,indexer,styles,steps=SUPERTONIC_STEPS,random=Math.random,yieldToMessages=yieldTask}=options===undefined?{}:options;
    return voice().voice_supertonic_create({ort,buffers,config,indexer,styles,steps,random,yieldToMessages},KIT);
  } catch(error){return Promise.reject(error);}
}
