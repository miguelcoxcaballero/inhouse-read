// Adapted from Supertone's MIT-licensed web/helper.js inference recipe.
// Copyright (c) 2025 Supertone Inc. See /licenses/supertonic-sdk-MIT.txt.
// The model weights have the separate OpenRAIL-M licence.
import { speedUpSpeech } from './synth-flow.js';
import { loadedRustVoiceUI as voice } from '../../rust-voice-ui.js';
import { supertonicNoise } from './supertonic-plan.js';
import { yieldToMessages as yieldTask } from './task-yield.js';
// The languages and profiles it accepts are the voice module's own (rust-core supertonic_catalog.rs).
const KIT={noise:supertonicNoise,speedUp:speedUpSpeech,always:()=>true,noop:()=>{}};
// Six steps preserved the tested Dutch/Spanish/English intelligibility at
// <1 RTF in the recorded single-thread desktop WASM benchmark, unlike FP32/8.
export const SUPERTONIC_STEPS = 6;

/** `<es>text.</es>` for the model, or '' when nothing speakable is left. The cleanup is Rust (rust-core supertonic_text.rs, through
 * the voice module); the compatibility decomposition of Unicode is the browser's. */
export const normalizeSupertonicText=(text,lang)=>voice().voice_supertonic_normalize(text,lang,KIT);

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
