/** Colour temperature of a lamp's light. Every option is a tint over the
 * lamp's own warm colours, equal to white at the default 2700 K, so a lamp
 * saved before this existed looks exactly as it did. Only colours (uniforms)
 * change, never a shader program. */

export const LAMP_KELVINS = Object.freeze([1800, 2200, 2700, 4000]);
export const DEFAULT_LAMP_KELVIN = 2700;
export const LAMP_KELVIN_MS = 300;

export const normalizeLampKelvin = value => LAMP_KELVINS.includes(Number(value)) ? Number(value) : DEFAULT_LAMP_KELVIN;

/** Linear sRGB of a black body, scaled to a largest channel of 1. Chromaticity
 * follows Kim et al.'s cubic fit of the Planckian locus (1667-25000 K). */
export function kelvinToLinearRgb(kelvin, out = [0, 0, 0]) {
  const t = Math.min(25000, Math.max(1667, Number(kelvin) || DEFAULT_LAMP_KELVIN));
  const x = t <= 4000
    ? -.2661239e9 / t ** 3 - .2343589e6 / t ** 2 + .8776956e3 / t + .179910
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + .2226347e3 / t + .240390;
  const y = t <= 2222 ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - .20219683
    : t <= 4000 ? -.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - .16748867
    : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - .37001483;
  const X = x / y, Z = (1 - x - y) / y;
  const r = Math.max(0, 3.2406 * X - 1.5372 - .4986 * Z);
  const g = Math.max(0, -.9689 * X + 1.8758 + .0415 * Z);
  const b = Math.max(0, .0557 * X - .2040 + 1.0570 * Z);
  const peak = Math.max(r, g, b) || 1;
  out[0] = r / peak; out[1] = g / peak; out[2] = b / peak;
  return out;
}

const reference = kelvinToLinearRgb(DEFAULT_LAMP_KELVIN);

/** Per-channel linear multipliers for a lamp's warm colours: 1 at 2700 K,
 * and the same luminance at every temperature so exposure does not jump. */
export function lampTint(kelvin, out = [1, 1, 1]) {
  const k = normalizeLampKelvin(kelvin);
  if (k === DEFAULT_LAMP_KELVIN) { out[0] = out[1] = out[2] = 1; return out; }
  kelvinToLinearRgb(k, out);
  for (let channel = 0; channel < 3; channel++) out[channel] /= reference[channel];
  const luminance = .2126 * out[0] + .7152 * out[1] + .0722 * out[2];
  for (let channel = 0; channel < 3; channel++) out[channel] /= luminance;
  return out;
}

/** Colour of the swatch shown beside a temperature, as CSS. */
export function kelvinSwatch(kelvin) {
  const encode = value => Math.round(255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055));
  const [r, g, b] = kelvinToLinearRgb(normalizeLampKelvin(kelvin));
  return `rgb(${encode(r)}, ${encode(g)}, ${encode(b)})`;
}

export const mixTint = (from, to, amount, out = [1, 1, 1]) => {
  for (let channel = 0; channel < 3; channel++) out[channel] = from[channel] + (to[channel] - from[channel]) * amount;
  return out;
};

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
      const t = state.duration ? Math.min(1, Math.max(0, (now - state.started) / state.duration)) : 1;
      const eased = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      mixTint(state.from, state.to, t >= 1 ? 1 : eased, state.value);
      return t < 1;
    }
  };
}

/** `color` (linear working space) times a tint. */
export function tintColor(color, tint) {
  if (tint) { color.r *= tint[0]; color.g *= tint[1]; color.b *= tint[2]; }
  return color;
}
