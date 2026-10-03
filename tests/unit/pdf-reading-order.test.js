import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ contents:[], layers:[] }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions:{}, OPS:{},
  getDocument:() => ({ promise:Promise.resolve({ numPages:state.contents.length, getPage:async number => ({
    getViewport:({ scale }) => ({ width:600 * scale, height:800 * scale, transform:[scale, 0, 0, -scale, 0, 800 * scale] }),
    getTextContent:async () => state.contents[number - 1],
    imageCoordinates:new Float32Array(), getOperatorList:async () => ({ fnArray:[] }),
    render:() => ({ promise:Promise.resolve(), cancel:vi.fn() })
  }) }), destroy:vi.fn() }),
  TextLayer:class {
    constructor({ container, textContentSource }) { this.container = container; this.content = textContentSource; state.layers.push(this) }
    async render() {
      for (const item of this.content.items) {
        if (typeof item.str !== 'string' || !item.str) continue
        const span = document.createElement('span'); span.textContent = item.str; this.container.append(span)
        if (item.hasEOL) this.container.append(document.createElement('br'))
      }
    }
    cancel = vi.fn()
  }
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default:'worker.mjs' }))
vi.mock('../../src/js/gestures.js', () => ({ attachSwipeNavigation:() => () => {} }))
import { PdfReader } from '../../src/js/readers/pdf-reader.js'
import { planSpeech } from '../../src/js/readers/speech-text.js'

const item = (str, x, y, width = 190, size = 12) => ({ str, dir:'ltr', width, height:size,
  transform:[size, 0, 0, size, x, 800 - y], fontName:'f1', hasEOL:true })
const content = items => ({ items, styles:{ f1:{ fontFamily:'serif', ascent:.8, descent:-.2 } } })
function shuffledColumns() {
  return content([
    item('Derecha primera frase.', 330, 130), item('Izquierda segunda frase.', 50, 148),
    item('Izquierda primera frase.', 50, 130), item('Derecha segunda frase.', 330, 148),
    item('Capítulo de prueba', 50, 80, 490, 22),
    item('Párrafo separado a la izquierda.', 50, 180), item('Párrafo separado a la derecha.', 330, 180)
  ])
}
const ordered = 'Capítulo de prueba\n\nIzquierda primera frase. Izquierda segunda frase.\n\nPárrafo separado a la izquierda.\n\nDerecha primera frase. Derecha segunda frase.\n\nPárrafo separado a la derecha.'
let reader, container
beforeEach(() => {
  document.body.innerHTML = '<main></main>'; container = document.querySelector('main')
  Object.defineProperties(container, { clientWidth:{ value:390, configurable:true }, clientHeight:{ value:700, configurable:true } })
  container.getBoundingClientRect = () => ({ left:0, top:0, right:390, bottom:700, width:390, height:700 })
  container.scrollBy = vi.fn(); container.scrollTo = vi.fn(); state.layers.length = 0
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return { canvas:this, drawImage:vi.fn() } })
  state.contents = [shuffledColumns(), shuffledColumns()]
})
afterEach(() => { reader?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })
async function open(mode = 'text') {
  reader = new PdfReader(); await reader.open(container, new ArrayBuffer(0), { preferences:{ pdfMode:mode } })
}

describe('PDF geometric reading order shared by text view and audiobook', () => {
  it('reads a full-width heading, the complete left column, then the complete right column', async () => {
    await open()
    expect(container.querySelector('.pdf-reflow-page').textContent).toBe(ordered)
    expect(await reader.getSpeechText()).toBe(ordered)
    expect((await reader.getSpeechSource()).text).toBe(ordered)
  })
  it('keeps the original printed coordinates while giving its text layer and voice the same logical order', async () => {
    await open('original')
    const source = await reader.getSpeechSource()
    expect(source.text).toBe(ordered)
    expect(state.layers[0].content.items.map(value => value.str)).toEqual([
      'Capítulo de prueba', 'Izquierda primera frase.', 'Izquierda segunda frase.', 'Párrafo separado a la izquierda.',
      'Derecha primera frase.', 'Derecha segunda frase.', 'Párrafo separado a la derecha.'
    ])
    for (const entry of state.layers[0].content.items) {
      expect(shuffledColumns().items.find(original => original.str === entry.str).transform).toEqual(entry.transform)
    }
    const start = source.text.indexOf('Derecha primera')
    source.highlight(start, start + 'Derecha primera frase.'.length)
    expect([...container.querySelectorAll('.inhouse-speech-current')].map(element => element.textContent)).toEqual(['Derecha primera frase.'])
  })
  it('stages the corrected text without turning the visible page early', async () => {
    await open('original')
    const source = await reader.getNextSpeechSource()
    expect(source.text).toBe(ordered)
    expect(reader.currentPage).toBe(1)
    expect(source.activate()).toBe(true)
    expect(reader.currentPage).toBe(2)
    const start = source.text.indexOf('Izquierda segunda')
    source.highlight(start, start + 'Izquierda segunda frase.'.length)
    expect([...container.querySelectorAll('.inhouse-speech-current')].map(element => element.textContent)).toEqual(['Izquierda segunda frase.'])
  })
  it('joins normal line wraps and only inserts a paragraph break for a larger vertical gap', async () => {
    state.contents = [content([
      item('La frase comienza en la primera línea y', 50, 100, 440),
      item('continúa en la segunda sin separarse.', 50, 118, 430),
      item('Este sí es otro párrafo.', 50, 151, 230)
    ])]
    await open()
    expect((await reader.getSpeechSource()).text).toBe('La frase comienza en la primera línea y continúa en la segunda sin separarse.\n\nEste sí es otro párrafo.')
  })
  it('finds a phrase crossing PDF line wraps when searching', async () => {
    state.contents = [content([item('La frase comienza en la primera línea y', 50, 100, 440), item('continúa en la segunda sin separarse.', 50, 118, 430)])]
    await open()
    expect(await reader.search('y continúa')).toHaveLength(1)
  })
  it('keeps spoken offsets when switching the same page between original and adaptable text views', async () => {
    await open('original')
    const source = await reader.getNextSpeechSource()
    expect(source.activate()).toBe(true)
    const start = source.text.indexOf('Derecha primera')
    await reader.applyPreferences({ pdfMode:'text' })
    expect(source.isValid()).toBe(true)
    source.highlight(start, start + 20)
    expect(container.querySelector('.pdf-reflow-page').classList.contains('inhouse-speech-current')).toBe(true)
    await reader.applyPreferences({ pdfMode:'original' })
    expect(source.isValid()).toBe(true)
    source.highlight(start, start + 20)
    expect([...container.querySelectorAll('.inhouse-speech-current')].map(element => element.textContent)).toEqual(['Derecha primera frase.'])
  })
  it.each(['original', 'text'])('preserves repeated body paragraphs with header skipping enabled on a geometric %s PDF', async mode => {
    state.contents = [content([item('No.', 50, 100, 24), item('Sí.', 50, 132, 24), item('No.', 50, 164, 24)])]
    await open(mode)
    const source = await reader.getSpeechSource()
    expect(source.headerRanges).toEqual([])
    expect(Object.isFrozen(source.headerRanges)).toBe(true)
    expect(planSpeech(source.text, { skipHeaders:true, headerRanges:source.headerRanges }).map(value => value.text)).toEqual(['No.', 'Sí.', 'No.'])
  })
  it('keeps confirmed-header metadata stable on a detached next page and through both PDF views', async () => {
    state.contents = [shuffledColumns(), content([item('No.', 50, 100, 24), item('Sí.', 50, 132, 24), item('No.', 50, 164, 24)])]
    await open('original')
    const source = await reader.getNextSpeechSource(), headerRanges = source.headerRanges
    expect(headerRanges).toEqual([])
    expect(Object.isFrozen(headerRanges)).toBe(true)
    expect(source.activate()).toBe(true)
    for (const mode of ['text', 'original']) {
      await reader.applyPreferences({ pdfMode:mode })
      expect(source.isValid()).toBe(true)
      expect(source.headerRanges).toBe(headerRanges)
      expect(planSpeech(source.text, { skipHeaders:true, headerRanges }).map(value => value.text)).toEqual(['No.', 'Sí.', 'No.'])
    }
  })
  it('leaves legacy sources without geometry on their existing header-skipping policy', async () => {
    state.contents = [{ items:[{ str:'Running header', hasEOL:true }, { str:'Body.', hasEOL:true }] }]
    await open('original')
    expect(Object.hasOwn(await reader.getSpeechSource(), 'headerRanges')).toBe(false)
  })
})
