// A book's pseudo-random stream is native in the shelf module (rust-ui/src/spine_surface.rs, Stream): nothing
// in src reads it value by value. Tests read it through the module's own doorways, the seed as it is taken
// and 64 (state, value) pairs per call, and paint a cloth or a field on it exactly as a spine and a case do.
import { rustShelf } from './rust-shelf-ready.js'
import { replayCloth } from '../../../src/js/spine-surface.js'

/** `random()` like the original's seededRandom, with the raw state readable and writable. */
export function shelfStream(seed) {
  let state = rustShelf.spine_random_seed(seed), batch = null, cursor = 0
  const next = () => {
    if (!batch || cursor === batch.length) { batch = rustShelf.spine_random_batch(state); cursor = 0 }
    state = batch[cursor++]; return batch[cursor++]
  }
  return Object.assign(next, { get: () => state, set: value => { state = value; batch = null; cursor = 0 } })
}

/** The cloth of production on `random` (a shelfStream): the original's paintCloth(c, width, random, options). */
export function shelfCloth(c, designWidth, random, { threads = true, metal = false } = {}, replay = replayCloth) {
  // A thumbnail's caller paints no cloth at all (spine_surface and the cloth case test `thumb` first).
  if (!threads) return
  random.set(rustShelf.spine_cloth_seeded(replay, c, designWidth, random.get(), metal))
}

/** The field of production on `random`: the original's paintField(c, width, height, random, options). */
export function shelfField(c, width, height, random, options) {
  const [state, ok, error] = rustShelf.paint_field_seeded(c, width, height, random.get(), options)
  random.set(state); if (!ok) throw error
}
