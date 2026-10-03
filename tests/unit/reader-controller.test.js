import { describe, it, expect, vi, beforeEach } from 'vitest'

const pdfOpen = vi.fn(async () => {})
const foliateOpen = vi.fn(async () => {})
const pdfSnapshot = vi.fn(async () => null)
const foliateSnapshot = vi.fn(async () => null)
const foliateLength = vi.fn(async () => null)

vi.mock('../../src/js/readers/pdf-reader.js', () => ({
  PdfReader: class {
    open = pdfOpen
    next = vi.fn()
    prev = vi.fn()
    close = vi.fn()
    pageCount = 10
    getPageSnapshot = pdfSnapshot
  }
}))

vi.mock('../../src/js/readers/foliate-reader.js', () => ({
  FoliateReader: class {
    open = foliateOpen
    next = vi.fn()
    prev = vi.fn()
    goToFraction = vi.fn()
    close = vi.fn()
    getPageSnapshot = foliateSnapshot
    getLengthMetadata = foliateLength
    getSpeechSource = vi.fn(async () => ({ text:'Hello.', start:0 }))
  }
}))

const { ReaderController, UnsupportedFormatError } = await import('../../src/js/readers/reader-controller.js')

function makeFile(name, bytes) {
  return new File([bytes], name)
}

describe('ReaderController', () => {
  beforeEach(() => {
    pdfOpen.mockClear()
    foliateOpen.mockClear()
    pdfSnapshot.mockReset()
    foliateSnapshot.mockReset()
    foliateLength.mockReset()
  })

  it('enruta un PDF al PdfReader', async () => {
    const controller = new ReaderController()
    const file = makeFile('libro.pdf', new TextEncoder().encode('%PDF-1.4'))
    const container = document.createElement('div')

    const format = await controller.open(container, file)

    expect(format.engine).toBe('pdf')
    expect(pdfOpen).toHaveBeenCalledTimes(1)
    expect(foliateOpen).not.toHaveBeenCalled()
    expect(controller.pageCount).toBe(10)
  })

  it('enruta un EPUB al FoliateReader', async () => {
    const controller = new ReaderController()
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
    const file = makeFile('libro.epub', bytes)
    const container = document.createElement('div')

    const format = await controller.open(container, file)

    expect(format.engine).toBe('foliate')
    expect(foliateOpen).toHaveBeenCalledTimes(1)
    expect(pdfOpen).not.toHaveBeenCalled()
    // EPUB es texto reflowable sin un número de página fijo: no se inventa uno.
    expect(controller.pageCount).toBeNull()
  })

  it('enruta un MOBI al FoliateReader', async () => {
    const controller = new ReaderController()
    const bytes = new Uint8Array(80)
    bytes.set(new TextEncoder().encode('BOOKMOBI'), 60)
    const file = makeFile('libro.mobi', bytes)
    const container = document.createElement('div')

    const format = await controller.open(container, file)

    expect(format.engine).toBe('foliate')
    expect(format.label).toBe('MOBI')
  })

  it('lanza UnsupportedFormatError para un formato desconocido', async () => {
    const controller = new ReaderController()
    const file = makeFile('notas.txt', new TextEncoder().encode('hola mundo'))
    const container = document.createElement('div')

    await expect(controller.open(container, file)).rejects.toBeInstanceOf(UnsupportedFormatError)
  })

  it('exposes the rendered saved page and its engine locator', async () => {
    const controller = new ReaderController()
    await controller.open(document.createElement('div'), makeFile('libro.pdf', new TextEncoder().encode('%PDF-1.4')))
    const source = document.createElement('canvas')
    pdfSnapshot.mockResolvedValue({ source, width:200, height:300, sourceType:'pdf-canvas',
      text:'The actual third page', location:{ fraction:2/9, locator:{kind:'pdf-page',value:3} } })
    expect(await controller.getPageSnapshot()).toMatchObject({ source, sourceType:'pdf-canvas',
      text:'The actual third page', location:{ locator:{kind:'pdf-page',value:3} } })
  })

  it('discards a page snapshot if another book takes over while it is being drawn', async () => {
    const controller = new ReaderController()
    await controller.open(document.createElement('div'), makeFile('libro.pdf', new TextEncoder().encode('%PDF-1.4')))
    let resolve
    pdfSnapshot.mockImplementation(() => new Promise(done => { resolve = done }))
    const pending = controller.getPageSnapshot()
    controller.close()
    resolve({ source:document.createElement('canvas'), width:200, height:300 })
    expect(await pending).toBeNull()
    expect(await controller.getPageSnapshot()).toBeNull()
  })

  it('passes the speech source of the engine through, and has none for engines without one', async () => {
    const controller = new ReaderController()
    expect(await controller.getSpeechSource()).toBeNull()
    await controller.open(document.createElement('div'), new File(['PK\x03\x04'], 'a.epub'))
    expect(await controller.getSpeechSource()).toEqual({ text:'Hello.', start:0 })
    await controller.open(document.createElement('div'), new File(['%PDF-1.4'], 'a.pdf'))
    expect(await controller.getSpeechSource()).toBeNull()
  })

  it('forwards length metadata without calling an EPUB page count a real page count', async () => {
    const controller = new ReaderController()
    await controller.open(document.createElement('div'), new File(['PK\x03\x04'], 'a.epub'))
    foliateLength.mockResolvedValue({ wordCount:180000, estimatedPageCount:600, lengthSource:'text' })
    expect(await controller.getLengthMetadata()).toEqual({ wordCount:180000, estimatedPageCount:600, lengthSource:'text' })
    expect(controller.pageCount).toBeNull()
    await controller.open(document.createElement('div'), new File(['%PDF-1.4'], 'a.pdf'))
    expect(await controller.getLengthMetadata()).toEqual({ pageCount:10, lengthSource:'pages' })
  })

  it('discards a background length count after its reader session closes', async () => {
    const controller = new ReaderController()
    expect(await controller.getLengthMetadata()).toBeNull()
    await controller.open(document.createElement('div'), new File(['PK\x03\x04'], 'a.epub'))
    let finish
    foliateLength.mockImplementation(() => new Promise(resolve => { finish=resolve }))
    const count = controller.getLengthMetadata()
    controller.close()
    finish({wordCount:90000,estimatedPageCount:300,lengthSource:'text'})
    expect(await count).toBeNull()
  })
})
