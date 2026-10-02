import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderExperience } from '../../src/js/readers/reader-experience.js'
import { DEFAULT_READING_PREFERENCES, READING_THEMES, normalizeReadingPreferences, readingCSS } from '../../src/js/readers/reading-preferences.js'

vi.mock('../../src/js/readers/reading-voice.js', () => ({
  ReadingVoice:class { state = 'stopped'; stop = vi.fn() }
}))

const place = (value, fraction) => ({ locator:{ kind:'cfi', value }, fraction })
const quiet = place('epubcfi(/6/2)', .1)
const beyond = place('epubcfi(/6/4)', .6)
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = '<header class="app-header"></header><section id="reader-screen"><div id="reader-toolbar"></div></section>'
  for (const id of ['reader-location', 'reader-settings', 'reader-audio', 'reader-save-bookmark',
    'reader-search-shortcut', 'reader-more-shortcut',
    'reader-top-title', 'reader-top-byline']) {
    const button = document.createElement('button')
    button.id = id
    if (id === 'reader-location') button.innerHTML = '<span class="reader-location-label"></span>'
    document.getElementById('reader-screen').append(button)
  }
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

async function setup(persist = vi.fn(async () => {})) {
  const reader = {
    location:{ ...beyond }, format:{ engine:'foliate' }, toc:[], pageCount:null,
    applyPreferences:vi.fn(async () => {}), addQuoteAnnotation:vi.fn(), getSelection:vi.fn(),
    next:vi.fn(async () => {}), prev:vi.fn(async () => {})
  }
  const experience = new ReaderExperience(reader, { persist })
  experience.panel.close = vi.fn()
  reader.goToLocator = vi.fn(async (locator, fraction) => {
    reader.location = { locator, fraction }
    experience.relocate()
  })
  reader.goToTarget = vi.fn(async () => {
    reader.location = { ...beyond }
    experience.relocate()
  })
  await experience.open({ id:'book-a', title:'Book A', readingHistory:[quiet] })
  return { reader, experience, persist }
}

describe('reader navigation during asynchronous history writes', () => {
  it('keeps an internal link tapped after the previous section appears but before its history is saved', async () => {
    const saved = deferred()
    const persist = vi.fn().mockImplementationOnce(() => saved.promise).mockResolvedValue(undefined)
    const { experience, reader } = await setup(persist)
    const returning = experience.returnToReading()
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    expect(experience.location.locator).toEqual(quiet.locator)

    const following = experience.jump(null, 'beyond.xhtml')
    expect(reader.goToTarget).not.toHaveBeenCalled()
    saved.resolve()
    await Promise.all([returning, following])

    expect(reader.goToTarget).toHaveBeenCalledWith('beyond.xhtml')
    expect(experience.location.locator).toEqual(beyond.locator)
    expect(experience.history[0].locator).toEqual(quiet.locator)
  })

  it.each(['reset', 'open'])('drops queued old-book links after %s without holding up the new book', async action => {
    const saved = deferred()
    const persist = vi.fn().mockImplementationOnce(() => saved.promise).mockResolvedValue(undefined)
    const { experience, reader } = await setup(persist)
    const returning = experience.returnToReading()
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    const obsolete = experience.jump(null, 'old-book-link.xhtml')
    if (action === 'reset') experience.reset()
    await experience.open({ id:'book-b', title:'Book B', readingHistory:[] })
    await experience.jump(null, 'new-book-link.xhtml')
    saved.resolve()
    await Promise.all([returning, obsolete])

    expect(reader.goToTarget.mock.calls).toEqual([['new-book-link.xhtml']])
    expect(experience.book.id).toBe('book-b')
    expect(experience.navigating).toBe(false)
    expect(persist.mock.calls.map(([id]) => id)).toEqual(['book-a', 'book-b'])
  })

  it('lets a subsequent jump run after a page turn fails', async () => {
    const { experience, reader } = await setup()
    reader.next.mockRejectedValueOnce(new Error('page unavailable'))
    const turn = experience.step(1)
    const jump = experience.jump(null, 'next-section.xhtml')
    await expect(turn).rejects.toThrow('page unavailable')
    await jump
    expect(reader.goToTarget).toHaveBeenCalledWith('next-section.xhtml')
    expect(experience.navigating).toBe(false)
  })
})

describe('reader appearance and compact location', () => {
  it('keeps AMOLED as a persistent reading theme across all reader surfaces', async () => {
    const { experience, reader } = await setup()
    experience.panel.querySelector('[data-theme="amoled"]').click()
    await vi.waitFor(() => expect(reader.applyPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ theme:'amoled' })))
    expect(JSON.parse(localStorage.getItem('inhouse-read-reading-preferences')).theme).toBe('amoled')
    for (const surface of [experience.screen, experience.panel, document.querySelector('.app-header')]) {
      expect(surface.dataset.readingTheme).toBe('amoled')
      expect(surface.style.colorScheme).toBe('dark')
    }
    for (const surface of [experience.screen, experience.screen.parentElement, experience.panel]) {
      expect(surface.style.getPropertyValue('--reading-paper')).toBe('#000000')
      expect(surface.style.getPropertyValue('--reading-ink')).toBe('#c6c6c6')
    }
    expect(experience.panel.querySelector('[data-theme="amoled"]').getAttribute('aria-pressed')).toBe('true')
    experience.reset()
    await experience.open({ id:'book-b', title:'Another book' })
    expect(experience.preferences.theme).toBe('amoled')
    expect(reader.applyPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ theme:'amoled' }))
  })

  it('applies the brightness filter only when the brightness is not the 100% identity', async () => {
    const { experience } = await setup()
    const filter = () => experience.screen.style.getPropertyValue('--reader-brightness-filter')
    expect(filter()).toBe('none')
    await experience.setPreference('brightness', 80)
    expect(filter()).toBe('brightness(80%)')
    await experience.setPreference('brightness', 120)
    expect(filter()).toBe('brightness(120%)')
    await experience.setPreference('brightness', 100)
    expect(filter()).toBe('none')
  })

  it('restores the saved AMOLED preference when constructing a reader', async () => {
    localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify({ theme:'amoled', margin:0 }))
    const { experience } = await setup()
    expect(experience.preferences).toMatchObject({ theme:'amoled', margin:0 })
    expect(experience.panel.querySelector('[data-pref="margin"]').value).toBe('0')
    expect(experience.screen.dataset.readingTheme).toBe('amoled')
  })

  it('uses black instead of dark gray and light gray instead of white for EPUB content', () => {
    expect(READING_THEMES.amoled).toEqual({ background:'#000000', color:'#c6c6c6', scheme:'dark' })
    const css = readingCSS({theme:'amoled'})
    expect(css).toContain('color-scheme:dark')
    expect(css).toContain('background:#000000 !important')
    expect(css).toContain('color:#c6c6c6 !important')
    // EPUBs with a white content wrapper must not put a white rectangle on OLED.
    expect(css).toContain('background-color:transparent !important')
    expect(css).not.toContain('#ffffff')
  })

  it('offers reduced defaults without rewriting a reader’s explicit spacing choices', () => {
    expect(normalizeReadingPreferences()).toMatchObject({ margin:16, lineHeight:1.6 })
    expect(normalizeReadingPreferences({ margin:0 })).toMatchObject({ margin:0 })
    expect(normalizeReadingPreferences({ margin:24, lineHeight:1.7 })).toMatchObject({ margin:24, lineHeight:1.7 })
    expect(normalizeReadingPreferences({ margin:Infinity, lineHeight:NaN })).toMatchObject({ margin:16, lineHeight:1.6 })
    expect(normalizeReadingPreferences(null)).toEqual(DEFAULT_READING_PREFERENCES)
    expect(normalizeReadingPreferences({theme:'toString',font:'constructor'})).toMatchObject({theme:'paper',font:'book'})
  })

  it('keeps EPUB chapter titles out of the toolbar while preserving accessible location', async () => {
    const { experience, reader } = await setup()
    reader.location = { ...beyond, section:'An unusually long chapter title that must not push the toolbar buttons', page:12 }
    experience.relocate()
    expect(experience.locationButton.querySelector('.reader-location-label').textContent).toBe('60 %')
    expect(experience.locationButton.getAttribute('aria-label')).toContain(reader.location.section)
    expect(experience.locationButton.title).toContain('Página 12')
    expect(experience.panel.querySelector('.reading-position').textContent).toContain(reader.location.section)
  })

  it('uses a short PDF page counter while retaining the full page name for navigation', async () => {
    const { experience, reader } = await setup()
    reader.pageCount = 1352
    reader.location = { fraction:.7, locator:{kind:'pdf-page',value:947} }
    experience.relocate()
    expect(experience.locationButton.querySelector('.reader-location-label').textContent).toBe('947 / 1352')
    expect(experience.locationButton.getAttribute('aria-label')).toBe('Progreso y capítulos, Página 947 de 1352')
    expect(experience.panel.querySelector('.reading-position').textContent).toBe('Página 947 de 1352')
  })

  it('puts screen rotation in the plain More options menu', async () => {
    const { experience } = await setup()
    const rotate = experience.panel.querySelector('#reading-more #reader-rotate')
    expect(rotate?.textContent).toBe('Girar pantalla')
    expect(document.querySelectorAll('#reader-rotate')).toHaveLength(1)
    expect(rotate.onclick).toBeTypeOf('function')
    const contents = experience.panel.querySelector('#reading-more #reader-toc-shortcut')
    expect(contents?.textContent).toBe('Índice, marcadores y citas')
    expect(document.querySelectorAll('#reader-toc-shortcut')).toHaveLength(1)
    expect(contents.onclick).toBeTypeOf('function')
  })

  it('reserves only the actual visible audio player height, releasing it behind an open panel', async () => {
    const { experience } = await setup()
    experience.miniPlayer.getBoundingClientRect = () => ({ height:58 })
    experience.voice.state = 'playing'
    experience.updateMiniPlayer()
    expect(experience.screen.classList.contains('has-reading-audio')).toBe(true)
    expect(experience.screen.classList.contains('has-reading-mini-player')).toBe(true)
    expect(experience.screen.style.getPropertyValue('--reader-audio-height')).toBe('58px')
    experience.panel.setAttribute('open', '')
    experience.updateMiniPlayer()
    expect(experience.screen.classList.contains('has-reading-audio')).toBe(true)
    expect(experience.screen.classList.contains('has-reading-mini-player')).toBe(false)
    expect(experience.screen.style.getPropertyValue('--reader-audio-height')).toBe('0px')
    experience.panel.removeAttribute('open')
    experience.updateMiniPlayer()
    expect(experience.screen.classList.contains('has-reading-mini-player')).toBe(true)
    expect(experience.screen.style.getPropertyValue('--reader-audio-height')).toBe('58px')
    experience.voice.state = 'stopped'
    experience.updateMiniPlayer()
    expect(experience.screen.classList.contains('has-reading-audio')).toBe(false)
    expect(experience.screen.classList.contains('has-reading-mini-player')).toBe(false)
    expect(experience.screen.style.getPropertyValue('--reader-audio-height')).toBe('0px')
  })

  it('keeps a landscape panel above the toolbar without sending its top off screen', async () => {
    vi.stubGlobal('innerWidth', 844)
    vi.stubGlobal('innerHeight', 390)
    vi.stubGlobal('visualViewport', undefined)
    const { experience } = await setup()
    experience.toolbar.getBoundingClientRect = () => ({ height:48 })
    experience.panel.setAttribute('open', '')
    experience.resizePanel()
    expect(experience.panel.style.bottom).toBe('60px')
    expect(experience.panel.style.maxHeight).toBe('314px')
    expect(parseFloat(experience.panel.style.bottom) + parseFloat(experience.panel.style.maxHeight)).toBeLessThan(390)
  })

  it('keeps the panel inside the visible mobile viewport while its keyboard is open', async () => {
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 844)
    const viewport = new EventTarget()
    Object.assign(viewport, { height:300, offsetTop:0 })
    vi.stubGlobal('visualViewport', viewport)
    const { experience } = await setup()
    experience.panel.setAttribute('open', '')
    viewport.dispatchEvent(new Event('resize'))
    expect(experience.panel.style.bottom).toBe('544px')
    expect(experience.panel.style.maxHeight).toBe('284px')
    expect(parseFloat(experience.panel.style.bottom) + parseFloat(experience.panel.style.maxHeight)).toBeLessThan(844)
  })

  it('reserves the return row outside the page and removes the reservation with its history', async () => {
    const { experience } = await setup()
    experience.returnButton.getBoundingClientRect = () => ({ height:44 })
    experience.renderPlaces()
    expect(experience.returnButton.hidden).toBe(false)
    expect(experience.screen.style.getPropertyValue('--reader-return-height')).toBe('44px')
    experience.history = []
    experience.renderPlaces()
    expect(experience.returnButton.hidden).toBe(true)
    expect(experience.screen.style.getPropertyValue('--reader-return-height')).toBe('0px')
    experience.history = [quiet]
    experience.renderPlaces()
    expect(experience.screen.style.getPropertyValue('--reader-return-height')).toBe('44px')
    experience.reset()
    expect(experience.screen.style.getPropertyValue('--reader-return-height')).toBe('0px')
  })

  it.each([false, true])('opens a useful content tab from More with an index present: %s', async hasIndex => {
    const { experience, reader } = await setup()
    reader.toc = hasIndex ? [{label:'First chapter',href:'first.xhtml'}] : []
    experience.renderToc()
    experience.panel.showModal = () => experience.panel.setAttribute('open', '')
    experience.panel.querySelector('#reader-toc-shortcut').click()
    const selected = hasIndex ? 'toc' : 'bookmarks'
    expect(experience.panel.dataset.view).toBe('navigation')
    expect(experience.panel.querySelector(`[data-place-tab="${selected}"]`).getAttribute('aria-selected')).toBe('true')
    expect(experience.panel.querySelector(`[data-places="${selected}"]`).hidden).toBe(false)
    expect(experience.panel.querySelectorAll('[data-place-tab][aria-selected="true"]')).toHaveLength(1)
  })

  it('restores the child mode control label when leaving a book', async () => {
    const { experience } = await setup()
    const control = experience.panel.querySelector('[data-kids]')
    control.click()
    expect(control.getAttribute('aria-label')).toBe('Salir del modo infantil')
    expect(experience.screen.classList.contains('reader-kids-mode')).toBe(true)
    experience.reset()
    expect(experience.screen.classList.contains('reader-kids-mode')).toBe(false)
    expect(control.getAttribute('aria-pressed')).toBe('false')
    expect(control.getAttribute('aria-label')).toBe('Activar modo infantil')
  })
})

describe('search results', () => {
  const hits = [
    { label:'The quiet room', parts:{ pre:'…a book waited beside ', match:'the', post:' plant' }, excerpt:'…a book waited beside the plant', locator:quiet.locator },
    { label:'', excerpt:'Plain excerpt', locator:beyond.locator }
  ]

  it('shows where each hit is and marks the match instead of printing an object', async () => {
    const { experience, reader } = await setup()
    reader.search = vi.fn(async () => hits)
    await experience.search('the')
    const buttons = experience.panel.querySelectorAll('[data-search-results] button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].querySelector('small').textContent).toBe('The quiet room')
    expect(buttons[0].querySelector('mark').textContent).toBe('the')
    expect(buttons[0].textContent).toContain('…a book waited beside the plant')
    expect(buttons[1].querySelector('small')).toBeNull()
    expect(buttons[1].textContent).toBe('Plain excerpt')
    expect(experience.panel.textContent).not.toContain('[object Object]')
  })

  it('clears the on-page marks when the panel closes without a jump, and keeps them after one', async () => {
    const { experience, reader } = await setup()
    reader.search = vi.fn(async () => hits)
    reader.clearSearch = vi.fn()
    await experience.search('the')
    experience.panel.querySelector('[data-search-results] button').click()
    await vi.waitFor(() => expect(reader.goToLocator).toHaveBeenCalled())
    experience.panel.dispatchEvent(new Event('close'))
    expect(reader.clearSearch).not.toHaveBeenCalled()
    expect(experience.panel.querySelectorAll('[data-search-results] button')).toHaveLength(2)
    experience.panel.dispatchEvent(new Event('close'))
    expect(reader.clearSearch).toHaveBeenCalledOnce()
    expect(experience.panel.querySelectorAll('[data-search-results] button')).toHaveLength(0)
    expect(experience.panel.querySelector('[data-search-status]').textContent).toBe('')
  })

  it('ends the search when the query is emptied or the book is left', async () => {
    const { experience, reader } = await setup()
    reader.search = vi.fn(async () => hits)
    reader.clearSearch = vi.fn()
    await experience.search('the')
    const query = experience.panel.querySelector('[data-search-query]')
    query.value = ''; query.dispatchEvent(new Event('input'))
    expect(reader.clearSearch).toHaveBeenCalledOnce()
    await experience.search('the')
    experience.reset()
    expect(reader.clearSearch).toHaveBeenCalledTimes(2)
  })

  it('a speed or voice change re-speaks the sentence being read, other audio options do not', async () => {
    const { experience } = await setup()
    experience.voice.restart = vi.fn()
    experience.setPreference('rate', 1.5)
    expect(experience.voice.restart).toHaveBeenCalledTimes(1)
    expect(experience.voice.rate).toBe(1.5)
    experience.setPreference('voice', 'es-device')
    expect(experience.voice.restart).toHaveBeenCalledTimes(2)
    expect(experience.voice.voice).toBe('es-device')
    experience.setPreference('footnotes', true)
    expect(experience.voice.restart).toHaveBeenCalledTimes(2)
    expect(experience.voice.stop).not.toHaveBeenCalled()
  })
})

describe('voice picker', () => {
  const nativeVoice = (voiceURI, lang, quality, extra = {}) => ({ voiceURI, name:`${lang} ${voiceURI}`, lang, quality, network:false, installed:true, ...extra })
  const stubBridge = (voices, extra = {}) => {
    const bridge = { speak:vi.fn(), stop:vi.fn(), getVoices:() => JSON.stringify(voices), ...extra }
    vi.stubGlobal('InhouseSpeech', bridge)
    return bridge
  }
  const select = experience => experience.panel.querySelector('[data-pref="voice"]')
  const groups = experience => [...select(experience).querySelectorAll('optgroup')].map(group => [group.label, [...group.querySelectorAll('option')].map(option => option.value)])

  it('groups the voices into recommended and all, with Automática as the best natural voice', async () => {
    stubBridge([nativeVoice('es-good', 'es-ES', 400), nativeVoice('es-robot', 'es-ES', 300, { name:'eSpeak' }), nativeVoice('en-good', 'en-US', 400)])
    const { experience, reader } = await setup()
    reader.language = 'es'
    experience.populateVoices()
    expect(select(experience).options[0]).toMatchObject({ value:'', textContent:'Automática · mejor voz natural' })
    expect(groups(experience)).toEqual([['Recomendadas (naturales)', ['es-good', 'en-good']], ['Todas las voces', ['es-good', 'es-robot', 'en-good']]])
    expect(select(experience).getAttribute('aria-label')).toBe('Voz de lectura')
    expect(experience.panel.querySelector('[data-voice-auto]').textContent).toBe('Se usará: Español (España) · Alta calidad · sin conexión.')
  })

  it('offers the voice download only on Android and only when the best voice is not high quality', async () => {
    const bridge = stubBridge([nativeVoice('es-normal', 'es-ES', 300)], { openVoiceSettings:vi.fn() })
    const { experience, reader } = await setup()
    reader.language = 'es'
    experience.populateVoices()
    const button = experience.panel.querySelector('[data-voice-settings]')
    expect(button.hidden).toBe(false)
    expect(button.textContent).toBe('Descargar voces de mayor calidad')
    button.click()
    expect(bridge.openVoiceSettings).toHaveBeenCalledOnce()
    bridge.getVoices = () => JSON.stringify([nativeVoice('es-high', 'es-ES', 500)])
    experience.populateVoices()
    expect(button.hidden).toBe(true)
    expect(experience.panel.querySelector('[data-voice-info]').hidden).toBe(false) // still says which voice Automática uses
  })

  it('does not show the download hint without the native bridge, or with an older app that cannot open settings', async () => {
    stubBridge([nativeVoice('es-normal', 'es-ES', 300)])
    const { experience, reader } = await setup()
    reader.language = 'es'
    experience.populateVoices()
    expect(experience.panel.querySelector('[data-voice-settings]').hidden).toBe(true)
    vi.stubGlobal('InhouseSpeech', undefined)
    experience.populateVoices()
    expect(experience.panel.querySelector('[data-voice-settings]').hidden).toBe(true)
  })

  it('keeps an explicit choice selected, falls back to Automática when it is gone, and refreshes native voices when the audio tab opens', async () => {
    const bridge = stubBridge([nativeVoice('es-good', 'es-ES', 400), nativeVoice('en-good', 'en-US', 400)], { refreshVoices:vi.fn() })
    const { experience, reader } = await setup()
    reader.language = 'es'
    experience.preferences = { ...experience.preferences, voice:'en-good' }
    experience.populateVoices()
    expect(select(experience).value).toBe('en-good')
    expect(experience.panel.querySelector('[data-voice-auto]').textContent).toBe('')
    experience.preferences = { ...experience.preferences, voice:'uninstalled' }
    experience.populateVoices()
    expect(select(experience).value).toBe('')
    experience.panel.showModal = vi.fn()
    experience.show('audio')
    expect(bridge.refreshVoices).toHaveBeenCalled()
  })
})
