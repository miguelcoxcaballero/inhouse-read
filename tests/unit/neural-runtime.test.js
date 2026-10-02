import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The catalogue stays available if the lazy engine fails. Playback reports the
// failure and never silently substitutes an operating-system voice.
const ENGINE = '../../src/js/readers/neural-voice/index.js'
beforeEach(() => {
  vi.resetModules()
  // Finish a reader's scheduled engine lookup before its test DOM is removed.
  vi.stubGlobal('requestIdleCallback', callback => { callback(); return 0 })
})
afterEach(() => { vi.doUnmock(ENGINE); vi.unstubAllGlobals(); delete globalThis.__inhouseNeuralTest; document.body.innerHTML = '' })

describe('neural runtime guards', () => {
  it('a module that fails to load keeps the downloadable catalogue but no engine or installed voices', async () => {
    vi.doMock(ENGINE, () => { throw new Error('chunk failed to load') })
    const runtime = await import('../../src/js/readers/neural-runtime.js')
    expect(await runtime.loadNeural()).toBeNull()
    expect(runtime.neuralEngine()).toBeNull()
    const { neuralVoices } = await import('../../src/js/readers/neural-voice/catalog.js')
    expect(runtime.neuralVoiceList().map(voice => voice.id)).toEqual(neuralVoices.map(voice => voice.id))
    expect(runtime.neuralVoiceList().map(voice => voice.id)).toContain('piper:es_ES-davefx-medium')
    expect(runtime.neuralVoiceList().every(voice => voice.neural && !voice.installed)).toBe(true)
    expect(runtime.neuralReady()).toBe(false)
    expect(() => runtime.unlockNeural()).not.toThrow()
  })
  it('reports an unavailable natural engine without starting a device voice or changing the selection', async () => {
    vi.doMock(ENGINE, () => { throw new Error('chunk failed to load') })
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn(), getVoices:() => JSON.stringify([{ voiceURI:'es-good', name:'es', lang:'es-ES', quality:400, network:false, installed:true }]) })
    const { ReadingVoice } = await import('../../src/js/readers/reading-voice.js')
    const onState = vi.fn()
    const voice = new ReadingVoice({ language:'es', getSpeechText:async () => 'Hola mundo.' }, onState)
    voice.voice = 'piper:es_ES-davefx-medium' // a saved neural choice the device cannot honour
    await voice.play()
    expect(speak).not.toHaveBeenCalled()
    expect(voice.state).toBe('stopped')
    expect(voice.voice).toBe('piper:es_ES-davefx-medium')
    expect(onState).toHaveBeenLastCalledWith('stopped', 'Este dispositivo no puede reproducir voces naturales.')
    voice.stop()
  })
  it('the reader panel builds and keeps the neural group hidden when the module is missing', async () => {
    vi.doMock(ENGINE, () => { throw new Error('chunk failed to load') })
    vi.stubGlobal('InhouseSpeech', { speak:vi.fn(), stop:vi.fn(), getVoices:() => '[]' })
    document.body.innerHTML = '<header class="app-header"></header><section id="reader-screen"><div id="reader-toolbar"></div></section>'
    for (const id of ['reader-location', 'reader-settings', 'reader-audio', 'reader-save-bookmark', 'reader-search-shortcut', 'reader-more-shortcut', 'reader-top-title', 'reader-top-byline']) {
      const button = document.createElement('button'); button.id = id
      if (id === 'reader-location') button.innerHTML = '<span class="reader-location-label"></span>'
      document.getElementById('reader-screen').append(button)
    }
    const { ReaderExperience } = await import('../../src/js/readers/reader-experience.js')
    const experience = new ReaderExperience({ language:'es', location:{ fraction:0 }, format:{ engine:'foliate' }, toc:[], applyPreferences:async () => {}, getSelection() {} }, { persist:async () => {} })
    await experience.open({ id:'b', title:'Book' })
    experience.panel.showModal = vi.fn()
    experience.show('audio')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(experience.panel.querySelector('[data-neural]').hidden).toBe(true)
    expect(experience.panel.querySelector('[data-neural-offer]').hidden).toBe(true)
    expect(experience.voiceMenu.value).toBe('')
    expect(experience.languageMenu.options.some(option => option.value === 'es')).toBe(true)
    expect(experience.voiceMenu.options.map(option => option.value)).toEqual([''])
  })
  it('an engine whose getters throw is treated as absent', async () => {
    const runtime = await import('../../src/js/readers/neural-runtime.js')
    const broken = { get supported() { throw new Error('boom') }, get installed() { throw new Error('boom') }, get downloads() { throw new Error('boom') } }
    globalThis.__inhouseNeuralTest = { engine:broken, voices:[{ id:'piper:es_ES-davefx-medium', lang:'es-ES', name:'Davefx', sizeMB:63 }] }
    await runtime.loadNeural()
    expect(runtime.neuralEngine()).toBeNull()
    expect(runtime.neuralVoiceList().map(voice => [voice.id, voice.installed])).toEqual([['piper:es_ES-davefx-medium', false]])
    expect(runtime.neuralVoiceList(broken)).toEqual([]) // a throwing installed getter is guarded too
    expect(runtime.neuralReady(broken)).toBe(false)
    expect(() => runtime.unlockNeural()).not.toThrow()
  })
  it('the test hook installs a prepared engine and catalogue, and does nothing without it', async () => {
    const hook = { engine:{ supported:true, installed:new Set(['piper:es_ES-davefx-medium']), downloads:new Map(), unlock:vi.fn() }, voices:[{ id:'piper:es_ES-davefx-medium', lang:'es-ES', name:'Davefx', sizeMB:63 }] }
    globalThis.__inhouseNeuralTest = hook
    const runtime = await import('../../src/js/readers/neural-runtime.js')
    expect(await runtime.loadNeural()).not.toBeNull()
    expect(runtime.neuralEngine()).toBe(hook.engine)
    expect(runtime.neuralVoiceList().map(voice => [voice.id, voice.installed])).toEqual([['piper:es_ES-davefx-medium', true]])
    runtime.unlockNeural()
    expect(hook.engine.unlock).toHaveBeenCalledOnce()
    vi.resetModules(); delete globalThis.__inhouseNeuralTest
    const plain = await import('../../src/js/readers/neural-runtime.js')
    await plain.loadNeural()
    expect(plain.neuralEngine()).not.toBe(hook.engine) // the stock engine, not the hook's
  })
})
