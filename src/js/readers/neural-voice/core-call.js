// Calls into a raw-ABI Rust core (no imports, memory owned by the host): the arguments go into a fresh arena of `slots`
// eight-byte cells, `run(pointer)` calls the export and reads the result through views made AFTER the call (the memory may
// have grown), and the arena is always released, whatever happens inside.
export function withArena(core, slots, run) {
  const pointer = core.alloc_f64(slots)
  if (!pointer) throw new Error('Rust core: no memory for the call')
  try { return run(pointer) } finally { core.free_f64(pointer, slots) }
}

/** Writes the UTF-16 code units of `text` at `pointer` (two-byte aligned). */
export function putText(core, pointer, text) {
  const units = new Uint16Array(core.memory.buffer, pointer, text.length)
  for (let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i)
}
