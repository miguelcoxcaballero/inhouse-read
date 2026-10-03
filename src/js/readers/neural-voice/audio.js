// The one AudioContext of the neural voices. It has to be created (or resumed) synchronously inside a user gesture
// (the play tap) or the browser keeps it suspended, so this tiny module is loaded with the app and the heavy engine is not.

let context = null
let native = null
let sequence = 0

export function nativePcmBridge(env = globalThis) {
  const bridge = env.InhousePcm
  try { return bridge && Number(bridge.getProtocol()) === 1 ? bridge : null } catch { return null }
}
export const nativeAudio = () => native
export function stopNativeAudio() {
  const previous = native; native = null
  if (context?.native) context = null
  if (previous) try { previous.bridge.stop(previous.session) } catch { /* bridge already closed */ }
}
export function pauseNativeAudio() {
  const previous = native
  if (previous) previous.paused = true
  if (context?.native) context = null
  if (previous) try { previous.bridge.pause(previous.session) } catch { /* bridge already closed */ }
}

/** Creates/resumes the shared AudioContext. Call it synchronously from a click/tap handler. Returns it (or null without Web Audio). */
export function unlockAudio(env = globalThis) {
  const bridge = nativePcmBridge(env)
  if (bridge) {
    if (!native || native.paused) {
      const session = `${Date.now()}-${++sequence}`
      bridge.begin(session, 'Audiolibro')
      native = { bridge, session }
      context = { native:true, state:'running', session, currentTime:0 }
    }
    return context
  }
  const Context = env.AudioContext || env.webkitAudioContext
  if (!Context) return null
  if (!context || context.state === 'closed') context = new Context({ latencyHint: 'playback' })
  if (context.state !== 'running') { try { Promise.resolve(context.resume()).catch(() => {}) } catch { /* resumes with the next gesture */ } }
  return context
}

/** The shared context, if unlock() has created one. */
export const audioContext = () => context

/** Forget the context (tests). */
export const resetAudio = () => { context = null; native = null }
