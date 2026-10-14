import { reloadOnceAfterChunkFailure } from './chunk-recovery.js'

// Static tables built by a Rust core and handed over once as JSON. The page
// starts compiling the core before the app's modules arrive, so the wait is
// normally over when the first module reaches it; there is no JavaScript copy
// of the tables to fall back to. An unavailable core is reported the way a
// failed chunk is: one reload per minute, then the message.
const MESSAGE = 'No se pudo cargar la estantería. Comprueba la conexión e inténtalo de nuevo.';

function unavailable(cause) {
  reloadOnceAfterChunkFailure();
  try {
    const note = Object.assign(document.createElement('p'), { textContent: MESSAGE });
    note.setAttribute('role', 'alert');
    document.getElementById('bookshelf-root')?.replaceChildren(note);
  } catch { /* no document: the error below is all there is */ }
  return new Error(MESSAGE, { cause });
}

/** The loaded core exporting `exportName`, or an error the person can read. */
export async function requireCore(get, load, exportName) {
  const core = get() ?? await load().catch(() => null);
  if (typeof core?.[exportName] !== 'function') throw unavailable(new Error(`Rust core without ${exportName}`));
  return core;
}

/** Reads the JSON document `core[exportName]` writes: size first, then bytes. */
export function readTables(core, exportName) {
  const size = core[exportName](0, 0);
  const words = Math.ceil(size / 8);
  const pointer = size > 0 ? core.alloc_f64(words) : 0;
  if (!pointer) throw unavailable(new Error(`Rust ${exportName} unavailable`));
  try {
    if (core[exportName](pointer, words * 8) !== size) throw new Error(`Rust ${exportName} changed while reading`);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(core.memory.buffer, pointer, size)));
  } catch (error) { throw unavailable(error); }
  finally { core.free_f64(pointer, words); }
}

export function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** One small arena for scalar kernels, allocated once and kept: call sites on
 * the shelf's layout path must not allocate per call. `view()` is a fresh
 * Float64Array of it (memory growth detaches older ones). */
export function scratchArena(core, words = 16) {
  const pointer = core.alloc_f64(words);
  if (!pointer) throw unavailable(new Error('Rust scratch unavailable'));
  return { pointer, view: () => new Float64Array(core.memory.buffer, pointer, words) };
}
