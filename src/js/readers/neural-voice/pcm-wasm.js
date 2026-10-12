// One bounded arena per fragment. It is released before playback and never
// held in the voice/look-ahead cache. Results own their transferable buffers.
export const PCM_MIN_SAMPLES = 4096;
export const PCM_MAX_SAMPLES = 4_194_304;

export function rustPrepareSpeech(core, pcm, sampleRate, model = '', timing = false) {
  if (!(pcm instanceof Float32Array) || !pcm.length || pcm.length > PCM_MAX_SAMPLES
    || !Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 384_000
    || typeof core?.pcm_prepare !== 'function' || !core.memory
    || typeof core.alloc_f64 !== 'function' || typeof core.free_f64 !== 'function'
    || pcm.buffer === core.memory.buffer) return null;
  const count = pcm.length, sampleSlots = Math.ceil(count / 2), length = sampleSlots + 4;
  let pointer = 0;
  try {
    pointer = core.alloc_f64(length);
    if (!pointer) return null;
    new Float32Array(core.memory.buffer, pointer, count).set(pcm);
    const metadata = pointer + sampleSlots * 8;
    if (core.pcm_prepare(pointer, metadata, count, sampleRate,
      model === 'no_NO-nvcc-medium' ? 1 : 0) !== 1) return null;
    // An export or another allocator may grow memory. Recreate every view.
    const [gain, from, to, faded] = new Float64Array(core.memory.buffer, metadata, 4);
    if (!Number.isFinite(gain) || gain < 0 || gain > 12 || !Number.isInteger(from)
      || !Number.isInteger(to) || from < 0 || to < from || to > count
      || !Number.isInteger(faded) || faded < 0 || faded > (to - from) / 2) return null;
    const speech = new Float32Array(core.memory.buffer, pointer + from * 4, to - from).slice();
    return timing ? {pcm:speech,from} : speech;
  } catch { return null; }
  finally { if (pointer) core.free_f64(pointer, length); }
}
