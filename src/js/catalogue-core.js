import { getRustCore, loadRustCore } from './rust-core.js'
import { freezeDeep, readTables, requireCore, scratchArena } from './core-tables.js'

// The cabinets, the spine palette and the layout defaults of the shelf: tables
// of the app core (rust-core/src/catalogue.rs), awaited like the core itself.
export const core = await requireCore(getRustCore, loadRustCore, 'catalogue_json')
export const tables = readTables(core, 'catalogue_json')
export { freezeDeep }
const arena = scratchArena(core)
export const scratch = arena.view
export const scratchPointer = arena.pointer

/** One arena for a kernel call: `sizes` are f64 counts, `use(pointer, offsets)`
 * gets the base pointer and the offset (in f64) of each region. Views must be
 * rebuilt after a call, which may grow the memory. */
export function inArena(sizes, use) {
  const at = [];
  let length = 0;
  for (const size of sizes) { at.push(length); length += size; }
  const words = Math.max(length, 1), pointer = core.alloc_f64(words);
  if (!pointer) throw new RangeError('Shelf kernel: request too large');
  try { return use(pointer, at, length); } finally { core.free_f64(pointer, words); }
}
export const f64View = (pointer, at, size) => new Float64Array(core.memory.buffer, pointer + at * 8, size);
/** The UTF-16 units of `text` written at f64 offset `at`; returns how many. */
export function writeUnits(pointer, at, text) {
  const units = new Uint16Array(core.memory.buffer, pointer + at * 8, text.length);
  for (let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i);
  return text.length;
}
