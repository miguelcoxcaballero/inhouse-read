import { describe, it, expect, vi, beforeEach } from 'vitest'

const pdfOpen = vi.fn(async () => {})
const foliateOpen = vi.fn(async () => {})

vi.mock('../../src/js/readers/pdf-reader.js', () => ({
  PdfReader: class {
    open = pdfOpen
    next = vi.fn()
    prev = vi.fn()
    close = vi.fn()
    pageCount = 10
  }
}))

vi.mock('../../src/js/readers/foliate-reader.js', () => ({
  FoliateReader: class {
    open = foliateOpen
    next = vi.fn()
    prev = vi.fn()
    goToFraction = vi.fn()
    close = vi.fn()
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
  })

  it('enruta un PDF al PdfReader', async () => {
    const controller = new ReaderController()
    const file = makeFile('libro.pdf', new TextEncoder().encode('%PDF-1.4'))
    const container = document.createElement('div')

    const format = await controller.open(container, file)

    expect(format.engine).toBe('pdf')
    expect(pdfOpen).toHaveBeenCalledTimes(1)
    expect(foliateOpen).not.toHaveBeenCalled()
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
})
