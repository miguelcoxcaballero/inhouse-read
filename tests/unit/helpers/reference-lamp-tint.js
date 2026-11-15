// Frozen: the tint transition, mix and colour tint as src/js/lamp-kelvin.js had them (over the decor core)
// before the studio's transition moved to rust-ui/src/studio_tint.rs. The frozen originals of other
// modules and the differential tests use them; the app no longer does.
import { core, scratch, scratchPointer } from '../../../src/js/decor-catalogue.js';
import { LAMP_KELVIN_MS, lampTint, normalizeLampKelvin } from '../../../src/js/lamp-kelvin.js';

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
