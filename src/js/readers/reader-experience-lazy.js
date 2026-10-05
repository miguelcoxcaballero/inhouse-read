import { normalizeReadingPreferences } from './reading-preferences.js'

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
  const load = () => loading ||= import('./reader-experience.js').then(({ ReaderExperience }) => {
    experience ||= new ReaderExperience(reader, options)
    return experience
  }).catch(error => { loading = null; throw error })
  return {
    ready: load,
    prefetch() { return load().catch(() => null) },
    get loaded() { return Boolean(experience) },
    get preferences() { return experience ? experience.preferences : storedPreferences() },
    get panel() { return experience?.panel ?? idlePanel },
    get voice() { return experience?.voice ?? idleVoice },
    closeVoice() { if (typeof experience?.closeVoice === 'function') experience.closeVoice(); else experience?.voice?.stop?.() },
    reset() { experience?.reset() },
    relocate() { experience?.relocate() },
    step(direction) { return experience?.step(direction) },
    jump(place, target) { return experience?.jump(place, target) },
    async open(record) { return (await load()).open(record) }
  }
}
