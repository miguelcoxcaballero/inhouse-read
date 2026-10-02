// window.phonemizeMany(count, { rebuildEvery }) phonemizes `count` DISTINCT 180-character Spanish fragments in a worker through
// the real createPhonemizer() (the wrapper the synthesis worker uses) and the real piper_phonemize WebAssembly.
// Resolves with {ok, failed:{at, error}|null, ids:[number of ids of each call], repeats:[...], builds}.
const worker = new Worker(new URL('./neural-phonemizer-worker.js', import.meta.url), { type: 'module' })
let seq = 0
const call = message => new Promise((resolve, reject) => {
  const id = ++seq
  const on = ({ data }) => { if (data.id !== id) return; worker.removeEventListener('message', on); data.error ? reject(new Error(data.error)) : resolve(data) }
  worker.addEventListener('message', on)
  worker.postMessage({ ...message, id })
})
window.phonemizeMany = (count, options = {}) => call({ type: 'many', count, base: new URL(`${import.meta.env.BASE_URL}neural-voice/phon/`, location.origin).href, ...options })
