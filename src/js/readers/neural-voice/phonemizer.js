// Text -> Piper phoneme ids, with the piper_phonemize WebAssembly build (the piper-phonemize C++ program compiled with
// Emscripten; it embeds espeak-ng). The glue (piper_phonemize.mjs), the wasm and the trimmed espeak-ng data live in
// public/neural-voice/phon/ (see the README there). This is a small wrapper over that Emscripten module: it runs inside the
// synthesis worker and nothing here touches the DOM.
//
// One Emscripten module has a fixed 17 MB heap that every callMain() erodes (it is a command-line program run again and
// again, and it never gives everything back): after ~75-155 calls (fewer for longer texts) it fails for good and, called
// on, takes the whole renderer down. So the module is replaced by a fresh one every REBUILD_EVERY calls (well under the
// 74-call minimum measured with 180-character fragments; building one takes ~100 ms) and when a call throws, in which case
// that text is tried once more on the fresh module.

/** Calls after which the module is replaced (measured: the worst case, 180-character texts, breaks at 74). */
export const REBUILD_EVERY = 40

/**
 * @param {{base:string, importModule?:(url:string)=>Promise<{default:Function}>, rebuildEvery?:number}} options
 *   base: absolute URL (ending in '/') of the folder holding piper_phonemize.{mjs,wasm,data}.
 * @returns {Promise<{phonemize:(text:string, espeakVoice:string)=>Promise<number[]>, destroy:()=>void}>}
 */
export async function createPhonemizer({ base, importModule = url => import(/* @vite-ignore */ url), rebuildEvery = REBUILD_EVERY }) {
  const { default: factory } = await importModule(base + 'piper_phonemize.mjs')
  let line = null, errors = [], module = null, calls = 0
  const build = async () => {
    line = null; errors = []; calls = 0
    module = null // the old one is dropped (and collected) before the new one is allocated
    module = await factory({
      // The program prints one JSON object per call: {"phoneme_ids":[...], ...}
      print: text => { line = text },
      printErr: text => { errors.push(text) },
      // The glue asks for 'piper_phonemize.wasm' and 'piper_phonemize.data': both come from our own folder (never a CDN).
      locateFile: name => base + name
    })
  }
  await build()
  const run = (text, espeakVoice) => {
    line = null; errors = []; calls++
    module.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data'])
  }
  return {
    /** Phoneme ids for `text` spoken with the espeak-ng voice of the Piper config (config.espeak.voice). Several '^...$' sentences come back concatenated. */
    async phonemize(text, espeakVoice) {
      if (calls >= rebuildEvery) await build()
      try { run(text, espeakVoice) } catch (first) {
        // A module that threw is not trusted again: a fresh one gets this text once more, and only then is it an error.
        try { await build(); run(text, espeakVoice) } catch (second) { throw new Error(`phonemizer failed: ${second?.message || first?.message || second || first}`, { cause: second }) }
      }
      let result = null
      try { if (line != null) result = JSON.parse(line) } catch { /* reported below */ }
      if (!result) throw new Error(`phonemizer gave no output${errors.length ? ': ' + errors.join(' ') : ''}`)
      return result.phoneme_ids || []
    },
    destroy() { try { module?.PThread?.terminateAllThreads?.() } catch { /* single threaded: nothing to stop */ } }
  }
}
