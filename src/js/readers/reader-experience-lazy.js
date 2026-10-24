import { normalizeReadingPreferences } from './reading-preferences.js'
import { reloadOnceAfterChunkFailure } from '../chunk-recovery.js'
import { getRustUI, requireRustUI } from '../rust-ui.js'
import { getRustShelf } from '../rust-shelf.js'

const STORAGE_KEY = 'inhouse-read-reading-preferences'

function storedPreferences() {
  try { return normalizeReadingPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) }
  catch { return normalizeReadingPreferences() }
}

// Observing an existing module never fetches it. A failed import/core must
// still be recoverable when neither module can supply a policy.
function policy(candidate) {
  if (candidate?.reader_lazy_load) return candidate
  const ui = getRustUI()
  if (ui?.reader_lazy_load) return ui
  const shelf = getRustShelf()
  return shelf?.reader_lazy_load ? shelf : null
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
  const state = { reader, options, experience:null, loading:null,
    idle:{panel:{open:false,close() {}},voice:{stop() {}}} }
  // The panel, voice session and lists are Rust components with no JavaScript
  // twin: the experience is only built once the core is in. The idle prefetch
  // never reloads the page for a slow download; opening a book does.
  const kit = {
    normalize:normalizeReadingPreferences, reload:reloadOnceAfterChunkFailure, ignore:() => null,
    begin:() => Promise.all([import('./reader-experience.js'), requireRustUI()]),
    loaded:parts => {
      const native = policy(parts[1])
      if (native) return native.reader_lazy_loaded(state, parts)
      const [{ReaderExperience},ui] = parts
      if (!ui) throw new Error('Rust UI is unavailable')
      return state.experience ||= new ReaderExperience(reader, options)
    },
    failure:reload => error => {
      const native = policy()
      if (native) return native.reader_lazy_failed(state, kit, reload, error)
      state.loading = null
      if (reload) reloadOnceAfterChunkFailure()
      throw error
    }
  }
  const load = (reload = true) => {
    const native = policy()
    return native ? native.reader_lazy_load(state, kit, reload)
      : state.loading ||= kit.begin().then(kit.loaded).catch(kit.failure(reload))
  }
  const get = name => {
    const native = policy()
    if (native) return native.reader_lazy_get(state, name, kit)
    if (name === 'loaded') return Boolean(state.experience)
    if (name === 'preferences') return state.experience ? state.experience.preferences : storedPreferences()
    return state.experience?.[name] ?? state.idle[name]
  }
  const dispatch = (name,args,optional = false) => {
    const native = policy()
    if (native) return native.reader_lazy_dispatch(state, name, args, optional)
    if (optional) return state.experience?.[name]?.(...args)
    return state.experience?.[name](...args)
  }
  return {
    ready: () => load(),
    prefetch() { const native=policy(); return native ? native.reader_lazy_prefetch(state,kit) : load(false).catch(kit.ignore) },
    get loaded() { return get('loaded') },
    reloadPreferences() {
      const native = policy()
      if (native) return native.reader_lazy_reload_preferences(state,kit)
      if (state.experience) state.experience.preferences = storedPreferences()
    },
    get preferences() { return get('preferences') },
    get panel() { return get('panel') },
    get voice() { return get('voice') },
    closeVoice() {
      const native=policy()
      if (native) return native.reader_lazy_close_voice(state)
      if (typeof state.experience?.closeVoice === 'function') state.experience.closeVoice()
      else state.experience?.voice?.stop?.()
    },
    reset() { dispatch('reset',[]) },
    relocate() { dispatch('relocate',[]) },
    step(direction) { return dispatch('step',[direction]) },
    jump(place, target) { return dispatch('jump',[place,target]) },
    refreshNames(bookId, fields) { dispatch('refreshNames',[bookId,fields],true) },
    async open(record) { return (await load()).open(record) }
  }
}
