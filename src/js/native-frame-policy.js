import { loadedRustCore } from './rust-core.js';

const WORDS = 118, FRAME = 16, PLACEMENT = 64, OUTPUT = 94;
// Number.isFinite/Integer reject strings and null; typed arrays alone coerce
// them. Keep that browser-value boundary explicit before numeric validation.
const number = value => typeof value === 'number' ? value : NaN;

/** One small arena per retained framebuffer cache, reused across zoom frames.
 * Rust owns geometric validation and the entire composition plan; the host
 * keeps WebGL objects and checks texture/context/generation ownership. */
export function createNativeFramePolicy() {
  const core = loadedRustCore(), pointer = core.alloc_f64(WORDS);
  if (!pointer) throw new RangeError('No se pudo reservar el plan del framebuffer');
  let released = false, values, dimensions, outputs;
  const view = () => {
    if (values?.buffer !== core.memory.buffer) {
      values = new Float64Array(core.memory.buffer, pointer, WORDS);
      dimensions = values.subarray(OUTPUT, OUTPUT + 2);
      outputs = Array.from({ length:4 }, (_, count) => values.subarray(OUTPUT, OUTPUT + count * 8));
    }
    return values;
  };
  function pack(frame, context, maxTextureSize, at = 0) {
    if (!frame || released) return false;
    const values = view();
    values[at] = number(frame.width); values[at + 1] = number(frame.height); values[at + 2] = number(frame.ratio);
    values[at + 3] = number(frame.x ?? 0); values[at + 4] = number(frame.y ?? 0);
    values[at + 5] = frame.physical === true ? 1 : frame.physical === undefined ? 0 : NaN;
    if (frame.physical === true) {
      values[at + 6] = number(frame.pixelWidth); values[at + 7] = number(frame.pixelHeight);
      values[at + 9] = number(context?.drawingBufferWidth); values[at + 10] = number(context?.drawingBufferHeight);
      values[at + 11] = number(maxTextureSize);
    }
    return true;
  }
  const run = (mode, count = 0) => !released && core.native_frame_plan(pointer, mode, count) === 1;
  return {
    exact(frame, context, maxTextureSize) { return pack(frame, context, maxTextureSize) && run(0); },
    capture(frame, context, maxTextureSize, canvas) {
      if (!pack(frame, context, maxTextureSize)) return null;
      const values = view();
      values[12] = number(frame.sourceX === undefined ? 0 : frame.sourceX);
      values[13] = number(frame.sourceY === undefined ? 0 : frame.sourceY);
      values[14] = number(canvas.width); values[15] = number(canvas.height);
      if (!run(1)) return null;
      view(); return dimensions;
    },
    compose(frame, layers, context, maxTextureSize) {
      if (!pack(frame, context, maxTextureSize) || !Array.isArray(layers) || layers.length > 3) return null;
      for (let index = 0; index < layers.length; index++) {
        const layer = layers[index];
        if (!pack(layer?.frame, context, maxTextureSize, FRAME * (index + 1))) return null;
        const values = view(), at = PLACEMENT + index * 10, clip = layer.clip;
        values[at] = number(layer.x ?? layer.frame.x); values[at + 1] = number(layer.y ?? layer.frame.y);
        values[at + 2] = number(layer.scale ?? 1); values[at + 3] = clip ? 1 : 0;
        if (clip) { values[at + 4] = number(clip.left); values[at + 5] = number(clip.top); values[at + 6] = number(clip.right); values[at + 7] = number(clip.bottom); }
      }
      if (!run(2, layers.length)) return null;
      view(); return outputs[layers.length];
    },
    dispose() { if (!released) { released = true; core.free_f64(pointer, WORDS); } }
  };
}
