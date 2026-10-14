import { normalizeReadingPreferences } from './reading-preferences.js'
import { reloadOnceAfterChunkFailure } from '../chunk-recovery.js'
import { requireRustUI } from '../rust-ui.js'

const STORAGE_KEY = 'inhouse-read-reading-preferences'

function storedPreferences() {
  try { return normalizeReadingPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) }
  catch { return normalizeReadingPreferences() }
}

/**
 * ReaderExperience (reading panel, voice, search, neural picker: ~110 KB) is only
 * needed once a book is open, so the shelf starts without it. This stand-in has
 * the same surface the app uses: until the chunk is in, there is no panel, voice
 * or reading position to act on, so those calls do nothing; open() waits for it,
 * and the app awaits ready() before it shows the reader, so a book never opens
 * without its controls. The chunk is prefetched once the shelf has settled.
 */
export function createLazyReaderExperience(reader, options) {
  let experience = null, loading = null
  const idlePanel = { open:false, close() {} }
  const idleVoice = { stop() {} }
  // The panel, voice session and lists are Rust components with no JavaScript
  // twin: the experience is only built once the core is in. The idle prefetch
  // never reloads the page for a slow download; opening a book does.
  const load = ({ reload = true } = {}) => loading ||= Promise.all([import('./reader-experience.js'), requireRustUI()]).then(([{ ReaderExperience }, ui]) => {
    if (!ui) throw new Error('Rust UI is unavailable')
    experience ||= new ReaderExperience(reader, options)
    return experience
  }).catch(error => { loading = null; if (reload) reloadOnceAfterChunkFailure(); throw error })
  return {
    ready: () => load(),
    prefetch() { return load({ reload:false }).catch(() => null) },
    get loaded() { return Boolean(experience) },
    reloadPreferences() { if (experience) experience.preferences = storedPreferences() },
    get preferences() { return experience ? experience.preferences : storedPreferences() },
    get panel() { return experience?.panel ?? idlePanel },
    get voice() { return experience?.voice ?? idleVoice },
    closeVoice() { if (typeof experience?.closeVoice === 'function') experience.closeVoice(); else experience?.voice?.stop?.() },
    reset() { experience?.reset() },
    relocate() { experience?.relocate() },
    step(direction) { return experience?.step(direction) },
    jump(place, target) { return experience?.jump(place, target) },
    refreshNames(bookId, fields) { experience?.refreshNames?.(bookId, fields) },
    async open(record) { return (await load()).open(record) }
  }
}
