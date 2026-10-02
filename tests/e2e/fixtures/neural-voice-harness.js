import { getNeuralEngine, neuralVoices, isNeuralVoiceId } from '../../../src/js/readers/neural-voice/index.js'

// The spec drives the engine through window.neural and reads what it recorded.
const engine = getNeuralEngine()
const events = []
let audioContext = null
window.addEventListener('inhouse-tts', event => events.push({ ...event.detail, at: performance.now(), ctxTime: audioContext?.currentTime }))

// Every AudioBufferSourceNode.start(when) is recorded with its buffer duration: the spec checks gaps on the audio clock.
const starts = []
const originalCreate = AudioContext.prototype.createBufferSource
AudioContext.prototype.createBufferSource = function () {
  audioContext = this
  const source = originalCreate.call(this)
  const start = source.start.bind(source)
  source.start = when => { starts.push({ when, duration: source.buffer?.duration || 0, sampleRate: source.buffer?.sampleRate || 0, now: this.currentTime, data: window.__capture ? Array.from(source.buffer.getChannelData(0)) : null }); return start(when) }
  return source
}

// Frame cadence of the page while the engine works (the UI thread must stay free).
const frames = []
let last = performance.now()
const ctx2d = document.getElementById('busy').getContext('2d')
const tick = t => { frames.push(t - last); last = t; ctx2d.fillStyle = `hsl(${t % 360},50%,50%)`; ctx2d.fillRect(0, 0, 64, 64); requestAnimationFrame(tick) }
requestAnimationFrame(tick)

// A real tap: the engine's unlock() must run synchronously inside a user gesture, as the play button does.
document.getElementById('unlock').addEventListener('click', () => engine.unlock())

// Reads `texts` the way reading-voice.js does: speak(k, upcoming) when k-1 is 'done'. Resolves with the event log (ms from the call).
function readAll(voiceId, texts, rate = 1, { lookahead = 3, prefix = 'f' } = {}) {
  return new Promise(resolve => {
    const t0 = performance.now(), log = []
    let i = 0
    const speak = () => engine.speak({ text: texts[i], voiceId, rate, id: `${prefix}${i}`, upcoming: texts.slice(i + 1, i + 1 + lookahead) })
    const on = event => {
      const d = event.detail
      if (!String(d.id).startsWith(prefix)) return
      log.push({ ...d, at: performance.now() - t0, ctxTime: audioContext?.currentTime, latency: (audioContext?.outputLatency || audioContext?.baseLatency || 0) })
      const finished = d.type === 'error' || d.type === 'interrupted' || (d.type === 'done' && ++i >= texts.length)
      if (finished) { window.removeEventListener('inhouse-tts', on); resolve(log) }
      else if (d.type === 'done') speak()
    }
    window.addEventListener('inhouse-tts', on)
    speak()
  })
}

window.neural = { engine, voices: neuralVoices, isNeuralVoiceId, events, starts, frames, readAll }
