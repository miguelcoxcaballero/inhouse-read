// The one AudioContext of the neural voices. It has to be created (or resumed) synchronously inside a user gesture
// (the play tap) or the browser keeps it suspended, so this tiny module is loaded with the app and the heavy engine is not.

let context = null

/** Creates/resumes the shared AudioContext. Call it synchronously from a click/tap handler. Returns it (or null without Web Audio). */
export function unlockAudio(env = globalThis) {
  const Context = env.AudioContext || env.webkitAudioContext
  if (!Context) return null
  if (!context || context.state === 'closed') context = new Context({ latencyHint: 'playback' })
  if (context.state !== 'running') { try { Promise.resolve(context.resume()).catch(() => {}) } catch { /* resumes with the next gesture */ } }
  return context
}

/** The shared context, if unlock() has created one. */
export const audioContext = () => context

/** Forget the context (tests). */
export const resetAudio = () => { context = null }
