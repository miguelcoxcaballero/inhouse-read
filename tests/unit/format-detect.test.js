import { describe, it, expect } from 'vitest'
import { detectFormat, sniffBytes, isSupported, ENGINE } from '../../src/js/format-detect.js'

function makeFile(name, bytes) {
  return new File([bytes], name)
}

describe('sniffBytes', () => {
  it('reconoce la cabecera %PDF-', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n...')
    expect(sniffBytes(bytes)).toMatchObject({ engine: ENGINE.PDF, label: 'PDF' })
  })

  it('reconoce la firma ZIP (EPUB/CBZ)', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
    expect(sniffBytes(bytes)).toMatchObject({ engine: ENGINE.FOLIATE })
  })

  it('reconoce el header PalmDOC BOOKMOBI en el offset 60', () => {
    const bytes = new Uint8Array(80)
    const marker = new TextEncoder().encode('BOOKMOBI')
    bytes.set(marker, 60)
    expect(sniffBytes(bytes)).toMatchObject({ engine: ENGINE.FOLIATE, label: 'MOBI' })
  })

  it('reconoce el header PalmDOC legado TEXtREAd', () => {
    const bytes = new Uint8Array(80)
    bytes.set(new TextEncoder().encode('TEXtREAd'), 60)
    expect(sniffBytes(bytes)).toMatchObject({ engine: ENGINE.FOLIATE, label: 'MOBI' })
  })

  it('reconoce FB2 crudo por su XML', () => {
    const xml = '<?xml version="1.0"?><FictionBook xmlns="x"><body/></FictionBook>'
    expect(sniffBytes(new TextEncoder().encode(xml))).toMatchObject({ engine: ENGINE.FOLIATE, label: 'FB2' })
  })

  it('devuelve UNKNOWN para bytes sin firma reconocible', () => {
    expect(sniffBytes(new Uint8Array([1, 2, 3, 4]))).toMatchObject({ engine: ENGINE.UNKNOWN })
  })
})

describe('detectFormat', () => {
  it('detecta un PDF real por bytes', async () => {
    const file = makeFile('libro.pdf', new TextEncoder().encode('%PDF-1.4\n%%EOF'))
    const result = await detectFormat(file)
    expect(result).toMatchObject({ engine: ENGINE.PDF, label: 'PDF' })
  })

  it('detecta un EPUB (zip) y usa la extensión para afinar la etiqueta', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0])
    const file = makeFile('mi-libro.epub', bytes)
    const result = await detectFormat(file)
    expect(result).toMatchObject({ engine: ENGINE.FOLIATE, label: 'EPUB' })
  })

  it('distingue un CBZ de un EPUB aunque ambos sean ZIP a nivel de bytes', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0])
    const file = makeFile('comic.cbz', bytes)
    const result = await detectFormat(file)
    expect(result).toMatchObject({ engine: ENGINE.FOLIATE, label: 'CBZ' })
  })

  it('detecta MOBI por el header PalmDOC', async () => {
    const bytes = new Uint8Array(80)
    bytes.set(new TextEncoder().encode('BOOKMOBI'), 60)
    const file = makeFile('libro.mobi', bytes)
    const result = await detectFormat(file)
    expect(result).toMatchObject({ engine: ENGINE.FOLIATE, label: 'MOBI' })
  })

  it('cae a la extensión cuando la cabecera está vacía o truncada', async () => {
    const file = makeFile('libro.azw3', new Uint8Array(0))
    const result = await detectFormat(file)
    expect(result).toMatchObject({ engine: ENGINE.FOLIATE, label: 'AZW3', source: 'ext' })
  })

  it('marca como no soportado un formato desconocido', async () => {
    const file = makeFile('notas.txt', new TextEncoder().encode('hola'))
    const result = await detectFormat(file)
    expect(isSupported(result)).toBe(false)
  })

  it('isSupported es true para pdf y foliate', () => {
    expect(isSupported({ engine: ENGINE.PDF })).toBe(true)
    expect(isSupported({ engine: ENGINE.FOLIATE })).toBe(true)
    expect(isSupported({ engine: ENGINE.UNKNOWN })).toBe(false)
    expect(isSupported(null)).toBe(false)
  })
})
