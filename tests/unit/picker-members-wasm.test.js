// @vitest-environment node
// install() and remove() of the natural-voice picker run by rust-ui (picker_members.rs) against the frozen JavaScript
// methods: the same picker, engine and catalogue fakes, every call on them logged with the microtask at which it
// happened, for downloads that succeed, fail with each code, are aborted, throw at once, and for removals that fail.
import { expect, it } from 'vitest'
import './helpers/rust-ui-ready.js'
import { readerUI } from '../../src/js/readers/rust-ui-required.js'
import { referenceInstall, referenceRemove } from './helpers/reference-picker-members.js'

const DOWNLOAD_ERRORS = { offline:'Sin conexión.', storage:'Sin espacio en el dispositivo.', default:'No se pudo descargar.' }
const VOICES = [{ id:'piper:a', name:'Ana', lang:'es-ES', modelKey:'a' }, { id:'supertonic3:F1:es', name:'Sol', lang:'es', sharedPack:true, modelKey:'pack' },
  { id:'supertonic3:M1:en', name:'Sun', lang:'en', sharedPack:true, modelKey:'pack' }]

async function run(live, scenario) {
  const log = []
  let tick = 0
  const note = (...entry) => log.push([tick, ...entry.map(item => item instanceof Error ? `${item.constructor.name}:${item.message}` : item && typeof item === 'object' ? JSON.stringify(item) : item)])
  const gate = {}
  const engine = scenario.engine === 'none' ? null : {
    unlock:options => note('engine.unlock', options),
    install:(id, options) => {
      note('engine.install', id, Object.keys(options).join(), options.signal instanceof AbortSignal)
      if (scenario.install === 'throws') throw Object.assign(new Error('unsupported'), { code:'unsupported' })
      return new Promise((resolve, reject) => { gate.resolve = resolve; gate.reject = reject })
    },
    remove:id => { note('engine.remove', id); if (scenario.remove === 'throws') throw new Error('remove threw'); return scenario.remove === 'rejects' ? Promise.reject(new Error('remove failed')) : scenario.remove === 'plain' ? 5 : Promise.resolve() }
  }
  const owner = {
    reader:{ language:scenario.declared }, preferences:{ voiceLang:scenario.picked, voice:scenario.current },
    setPreference:(...args) => { note('setPreference', ...args); if (scenario.preference === 'throws') throw new Error('preference failed') },
    populateVoices:() => note('populateVoices'), voice:{ voiceRemoved:id => note('voiceRemoved', id) }
  }
  const picker = { host:owner, tasks:new Map(), errors:new Map(), voiceName:id => VOICES.find(voice => voice.id === id)?.name || 'natural',
    announce:text => note('announce', text), render:() => note('render') }
  if (scenario.busy) picker.tasks.set(scenario.id, new AbortController())
  const deps = { neuralEngine:() => { note('neuralEngine'); return engine }, isNeuralId:id => { note('isNeuralId', id); return scenario.valid !== false },
    declaredLanguage:reader => reader.language, langBase:tag => String(tag || '').split('-')[0], neuralVoiceList:() => VOICES, DOWNLOAD_ERRORS }
  const kit = { runtime:{ neuralEngine:deps.neuralEngine, neuralVoiceList:deps.neuralVoiceList }, catalog:{ isNeuralId:deps.isNeuralId, declaredLanguage:deps.declaredLanguage, langBase:deps.langBase }, messages:DOWNLOAD_ERRORS }
  const ui = readerUI()
  const call = (name, id) => live ? ui.picker_member(picker, name, [id], kit, ui) : name === 'install' ? referenceInstall(picker, id, deps) : referenceRemove(picker, id, deps)
  const advance = async count => { for (let step = 0; step < count; step++) { await Promise.resolve(); tick++ } }
  const promise = call(scenario.member, scenario.id)
  note('answered', promise instanceof Promise)
  promise.then(value => note('resolved', String(value)), error => note('rejected', error))
  await advance(3)
  if (scenario.member === 'install') {
    if (scenario.abort) picker.tasks.get(scenario.id)?.abort()
    if (scenario.outcome === 'ok') gate.resolve?.()
    else if (scenario.outcome) gate.reject?.(Object.assign(new Error('download failed'), scenario.outcome === 'plain' ? {} : { code:scenario.outcome }))
  }
  await advance(12)
  note('end', [...picker.tasks.keys()], [...picker.errors.entries()])
  return log
}

it('downloads and removes a voice at the microtask the JavaScript methods did', async () => {
  const scenarios = []
  for (const id of ['piper:a', 'supertonic3:F1:es', 'unknown']) {
    for (const outcome of ['ok', 'offline', 'storage', 'aborted', 'http', 'plain']) for (const picked of [undefined, 'es', 'en']) for (const declared of [undefined, 'es-MX', 'en'])
      scenarios.push({ member:'install', id, outcome, picked, declared })
    scenarios.push({ member:'install', id, outcome:'plain', abort:true }, { member:'install', id, install:'throws' }, { member:'install', id, engine:'none' }, { member:'install', id, busy:true },
      { member:'install', id, valid:false }, { member:'install', id, outcome:'ok', preference:'throws', picked:'es' })
    for (const remove of ['ok', 'rejects', 'throws', 'plain']) for (const current of [undefined, id, 'supertonic3:M1:en'])
      scenarios.push({ member:'remove', id, remove, current })
    scenarios.push({ member:'remove', id, engine:'none' }, { member:'remove', id, remove:'ok', current:id, preference:'throws' })
  }
  let lines = 0
  for (const scenario of scenarios) {
    const expected = await run(false, scenario)
    expect(await run(true, scenario), JSON.stringify(scenario)).toEqual(expected)
    lines += expected.length
  }
  expect(scenarios.length).toBeGreaterThan(200)
  expect(lines).toBeGreaterThan(1500)
})
