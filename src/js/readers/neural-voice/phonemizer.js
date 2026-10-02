// Text -> Piper phoneme ids, with the piper_phonemize WebAssembly build (the piper-phonemize C++ program compiled with
// Emscripten; it embeds espeak-ng). The glue (piper_phonemize.mjs), the wasm and the trimmed espeak-ng data live in
// public/neural-voice/phon/ (see the README there). This is a small wrapper over that Emscripten module: it runs inside the
// synthesis worker and nothing here touches the DOM.

/**
 * @param {{base:string, importModule?:(url:string)=>Promise<{default:Function}>}} options
 *   base: absolute URL (ending in '/') of the folder holding piper_phonemize.{mjs,wasm,data}.
 * @returns {Promise<{phonemize:(text:string, espeakVoice:string)=>number[], destroy:()=>void}>}
 */
export async function createPhonemizer({ base, importModule = url => import(/* @vite-ignore */ url) }) {
  const { default: factory } = await importModule(base + 'piper_phonemize.mjs')
  let line = null, errors = []
  const module = await factory({
    // The program prints one JSON object per call: {"phoneme_ids":[...], ...}
    print: text => { line = text },
    printErr: text => { errors.push(text) },
    // The glue asks for 'piper_phonemize.wasm' and 'piper_phonemize.data': both come from our own folder (never a CDN).
    locateFile: name => base + name
  })
  return {
    /** Phoneme ids for `text` spoken with the espeak-ng voice of the Piper config (config.espeak.voice). Several '^...$' sentences come back concatenated. */
    phonemize(text, espeakVoice) {
      line = null; errors = []
      module.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data'])
      let result = null
      try { if (line != null) result = JSON.parse(line) } catch { /* reported below */ }
      if (!result) throw new Error(`phonemizer gave no output${errors.length ? ': ' + errors.join(' ') : ''}`)
      return result.phoneme_ids || []
    },
    destroy() { try { module.PThread?.terminateAllThreads?.() } catch { /* single threaded: nothing to stop */ } }
  }
}
