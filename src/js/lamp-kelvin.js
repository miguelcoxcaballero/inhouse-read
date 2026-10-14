import { core, tables, scratch, scratchPointer } from './decor-catalogue.js';

/** Colour temperature of a lamp's light. Every option is a tint over the
 * lamp's own warm colours, equal to white at the default 2700 K, so a lamp
 * saved before this existed looks exactly as it did. Only colours (uniforms)
 * change, never a shader program. The colour maths is the Rust core's; the
 * host supplies the powers (`**` rounds differently on every libm). */

export const LAMP_KELVINS = Object.freeze([...tables.lampKelvins]);
export const DEFAULT_LAMP_KELVIN = tables.constants.defaultLampKelvin;
export const LAMP_KELVIN_MS = tables.constants.lampKelvinMs;

export const normalizeLampKelvin = value => LAMP_KELVINS.includes(Number(value)) ? Number(value) : DEFAULT_LAMP_KELVIN;

/** Linear sRGB of a black body, scaled to a largest channel of 1. Chromaticity
 * follows Kim et al.'s cubic fit of the Planckian locus (1667-25000 K). */
export function kelvinToLinearRgb(kelvin, out = [0, 0, 0]) {
  const t = core.kelvin_clamp(Number(kelvin));
  const x = core.kelvin_chroma_x(t, t ** 3, t ** 2);
  core.kelvin_linear_rgb(t, x, x ** 3, x ** 2, scratchPointer);
  const rgb = scratch();
  out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2];
  return out;
}

const reference = kelvinToLinearRgb(DEFAULT_LAMP_KELVIN);
const tints = new Map(LAMP_KELVINS.map(kelvin => {
  const rgb = kelvinToLinearRgb(kelvin), words = scratch();
  words.set(rgb, 0); words.set(reference, 4);
  core.lamp_tint_finish(scratchPointer, scratchPointer + 32);
  return [kelvin, kelvin === DEFAULT_LAMP_KELVIN ? [1, 1, 1] : [words[0], words[1], words[2]]];
}));

/** Per-channel linear multipliers for a lamp's warm colours: 1 at 2700 K,
 * and the same luminance at every temperature so exposure does not jump. */
export function lampTint(kelvin, out = [1, 1, 1]) {
  const [r, g, b] = tints.get(normalizeLampKelvin(kelvin));
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}

const swatches = new Map(LAMP_KELVINS.map(kelvin => {
  const encode = value => core.srgb_encode(value, value ** (1 / 2.4));
  const [r, g, b] = kelvinToLinearRgb(kelvin);
  return [kelvin, `rgb(${encode(r)}, ${encode(g)}, ${encode(b)})`];
}));
/** Colour of the swatch shown beside a temperature, as CSS. */
export const kelvinSwatch = kelvin => swatches.get(normalizeLampKelvin(kelvin));

export function mixTint(from, to, amount, out = [1, 1, 1]) {
  const words = scratch();
  words.set(from, 0); words.set(to, 4);
  core.tint_mix(scratchPointer, scratchPointer + 32, amount, scratchPointer + 64);
  out[0] = words[8]; out[1] = words[9]; out[2] = words[10];
  return out;
}

/** A change of temperature in flight: tint(now) eases from where it was. */
export function createTintTransition(kelvin) {
  const state = { kelvin:normalizeLampKelvin(kelvin), from:lampTint(kelvin), to:lampTint(kelvin), value:lampTint(kelvin), started:0, duration:0 };
  return {
    state,
    set(next, now, animate) {
      const target = normalizeLampKelvin(next);
      if (target === state.kelvin) return false;
      state.kelvin = target; state.from = [...state.value]; state.to = lampTint(target);
      state.started = now; state.duration = animate ? LAMP_KELVIN_MS : 0;
      if (!animate) state.value = [...state.to];
      return true;
    },
    moving: () => state.value[0] !== state.to[0] || state.value[1] !== state.to[1] || state.value[2] !== state.to[2],
    /** Advances to `now`; true while still moving. */
    advance(now) {
      if (!this.moving()) return false;
      const moment = core.tint_moment(now, state.started, state.duration);
      mixTint(state.from, state.to, core.tint_ease(moment), state.value);
      return moment < 1;
    }
  };
}

/** `color` (linear working space) times a tint. */
export function tintColor(color, tint) {
  if (tint) { color.r *= tint[0]; color.g *= tint[1]; color.b *= tint[2]; }
  return color;
}
