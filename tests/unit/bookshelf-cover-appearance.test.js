import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'
import { analyzeCoverAppearance } from '../../src/js/cover-appearance.js'

const viewColors = vi.hoisted(() => [])

vi.mock('../../src/js/book-model.js', () => ({
  getBookRenderer: () => null,
  planReadingBookPose: () => ({ x: 0, y: 0, scale: 1, angle: 0, pitch: 0 }),
  bookView(host, book, style, dimensions) {
    viewColors.push(style.color)
    const canvas = document.createElement('canvas')
    canvas.dataset.renderer = 'three-mesh'
    canvas.dataset.coverRatio = String(style.coverRatio ?? 0.66)
    canvas.dataset.modelAspectRatio = String(dimensions.width / dimensions.height)
    host.append(canvas)
    return {
      canvas,
      draw() {},
      updateAppearance() {},
      animate() { return { finished: Promise.resolve() } },
      dispose() {}
    }
  }
}))

vi.mock('../../src/js/cover-appearance.js', async importOriginal => {
  const original = await importOriginal()
  return {
    ...original,
    analyzeCoverAppearance: vi.fn(async () => ({
      color: '#2f6b4f', shade: '#244f3c', ink: '#fffaf0',
      fontFamily: 'Oswald', fontCanvasFamily: 'Oswald',
      fontFallback: 'Arial Narrow, sans-serif', fontWeight: 600, aspectRatio: 0.82, source: 'cover'
    })),
    readCoverAspectRatio: vi.fn(async () => 0.82)
  }
})

describe('cover matched shelf styling', () => {
  let shelf
  let container

  afterEach(() => {
    shelf?.destroy()
    shelf = null
    container?.remove()
    document.body.innerHTML = ''
  })

  it('applies the extracted colour and type to the spine and opening animation', async () => {
    container = document.createElement('div')
    document.body.append(container)
    const book = {
      id: 'drive:cover-match', title: 'A Cover Matched Title', author: 'Reader',
      format: 'EPUB', cover: new Blob(['cover'], { type: 'image/jpeg' })
    }
    shelf = renderBookshelf(container, [book], {
      shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0,
      coverSrcFor: () => 'blob:cover-match'
    })

    await vi.waitFor(() => expect(
      container.querySelector('.ihr-spine')?.style.getPropertyValue('--ihr-spine-base')
    ).toBe('#2f6b4f'))
    let spine = container.querySelector('.ihr-spine')
    expect(spine.style.getPropertyValue('--ihr-spine-font')).toContain('Oswald')

    spine.click()
    await vi.waitFor(() => expect(document.querySelector('.ihr-flyout__book')).not.toBeNull())
    expect(document.querySelector('.ihr-flyout__book').style.getPropertyValue('--ihr-spine-base')).toBe('#2f6b4f')
    expect(document.querySelector('.ihr-flyout__book').style.getPropertyValue('--ihr-spine-font')).toContain('Oswald')
    const coverTarget = document.querySelector('.ihr-flyout__cover-target')
    expect(parseFloat(coverTarget.style.width) / parseFloat(coverTarget.style.height)).toBeCloseTo(0.82, 1)
  })

  it('restores saved cover styling before the first shelf frame', () => {
    container = document.createElement('div')
    document.body.append(container)
    const appearance = {
      color: '#2f6b4f', shade: '#244f3c', ink: '#fffaf0',
      fontFamily: 'Oswald', fontCanvasFamily: 'Oswald',
      fontFallback: 'Arial Narrow, sans-serif', fontWeight: 600, aspectRatio: 0.82,
      source: 'cover'
    }
    const book = {
      id: 'drive:cached', title: 'Cached', format: 'EPUB',
      cover: new Blob(['cover'], { type: 'image/jpeg' }),
      coverAppearance: appearance,
      coverAppearanceKey: 'drive:cached|Cached|image/jpeg|5|'
    }
    shelf = renderBookshelf(container, [book], {
      shelfWidth: 390, sections: false, waitForCoverAppearance: true
    })

    expect(container.querySelector('.ihr-library-loading')).toBeNull()
    const spine = container.querySelector('.ihr-spine')
    expect(spine.style.getPropertyValue('--ihr-spine-base')).toBe('#2f6b4f')
    expect(spine.querySelector('canvas').dataset.coverRatio).toBe('0.82')
    expect(Number(spine.querySelector('canvas').dataset.modelAspectRatio)).toBeCloseTo(0.82)
  })

  it('hides provisional book styles until uncached covers are analyzed, then saves them', async () => {
    container = document.createElement('div')
    document.body.append(container)
    let finishAnalysis
    const appearance = {
      color: '#3b5268', shade: '#293b4c', ink: '#fffaf0', aspectRatio: 0.74,
      fontFamily: 'Lora', fontCanvasFamily: 'Lora', source: 'cover'
    }
    vi.mocked(analyzeCoverAppearance).mockImplementation(async () => appearance)
    vi.mocked(analyzeCoverAppearance).mockImplementationOnce(() => new Promise(resolve => {
      finishAnalysis = resolve
    }))
    const onCoverAppearance = vi.fn(async () => {})
    const book = {
      id: 'drive:cold', title: 'Cold', format: 'EPUB',
      cover: new Blob(['cover'], { type: 'image/jpeg' })
    }
    shelf = renderBookshelf(container, [book], {
      shelfWidth: 390, sections: false, waitForCoverAppearance: true,
      coverSrcFor: () => 'blob:cold', onCoverAppearance
    })

    expect(container.querySelector('.ihr-library-loading')).not.toBeNull()
    expect(container.querySelector('.ihr-spine')).toBeNull()
    await vi.waitFor(() => expect(finishAnalysis).toBeTypeOf('function'))
    finishAnalysis(appearance)
    await vi.waitFor(() => expect(container.querySelector('.ihr-spine')).not.toBeNull())
    expect(container.querySelector('.ihr-library-loading')).toBeNull()
    expect(container.querySelector('.ihr-spine').style.getPropertyValue('--ihr-spine-base')).toBe('#3b5268')
    expect(container.querySelector('.ihr-spine canvas').dataset.coverRatio).toBe('0.74')
    expect(onCoverAppearance).toHaveBeenCalledWith(book, expect.objectContaining({ aspectRatio: 0.74 }), expect.stringContaining('drive:cold'))
  })

  it('analyzes a book imported while the shelf is hidden, so its first visible frame is final', async () => {
    container = document.createElement('div')
    document.body.append(container)
    const appearance = {
      color: '#e9e4d8', shade: '#cfc8b8', ink: '#2b2622', aspectRatio: 0.7,
      fontFamily: 'Lora', fontCanvasFamily: 'Lora', source: 'cover'
    }
    vi.mocked(analyzeCoverAppearance).mockImplementation(async () => appearance)
    const onCoverAppearance = vi.fn(async () => {})
    shelf = renderBookshelf(container, [], {
      sections: false, waitForCoverAppearance: true,
      coverSrcFor: () => 'blob:imported', onCoverAppearance
    })
    const book = {
      id: 'local:imported', title: 'Imported', format: 'PDF',
      cover: new Blob(['cover'], { type: 'image/png' })
    }
    // Home is hidden behind the reader: no layout, but the cover is analysed.
    shelf.update([book])
    expect(container.querySelector('.ihr-spine')).toBeNull()
    await vi.waitFor(() => expect(onCoverAppearance).toHaveBeenCalled())

    Object.defineProperty(container, 'clientWidth', { value: 390, configurable: true })
    shelf.update([book])
    expect(container.querySelector('.ihr-spine').style.getPropertyValue('--ihr-spine-base')).toBe('#e9e4d8')
  })

  it('flies a book home in its analysed cloth when the analysis lands just after closing', async () => {
    container = document.createElement('div')
    document.body.append(container)
    const appearance = {
      color: '#e9e4d8', shade: '#cfc8b8', ink: '#2b2622', aspectRatio: 0.7,
      fontFamily: 'Lora', fontCanvasFamily: 'Lora', source: 'cover'
    }
    let finishAnalysis
    vi.mocked(analyzeCoverAppearance).mockImplementation(() => new Promise(resolve => { finishAnalysis = resolve }))
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ left: 40, top: 100, right: 74, bottom: 250, width: 34, height: 150, x: 40, y: 100 })
    const book = {
      id: 'local:just-read', title: 'Just read', format: 'PDF',
      cover: new Blob(['cover'], { type: 'image/png' })
    }
    try {
      shelf = renderBookshelf(container, [book], { shelfWidth: 390, sections: false, coverSrcFor: () => 'blob:just-read' })
      const provisional = container.querySelector('.ihr-spine').style.getPropertyValue('--ihr-spine-base')
      expect(provisional).not.toBe('#e9e4d8')
      await vi.waitFor(() => expect(finishAnalysis).toBeTypeOf('function'))
      viewColors.length = 0
      const returning = shelf.returnToShelf(book.id, { book })
      setTimeout(() => finishAnalysis(appearance), 40)
      expect(await returning).toBe(true)
      // The flight (and the rebuilt DOM spine) never start from the provisional colour.
      expect(viewColors.length).toBeGreaterThan(0)
      expect(new Set(viewColors)).toEqual(new Set(['#e9e4d8']))
      expect(container.querySelector('.ihr-spine').style.getPropertyValue('--ihr-spine-base')).toBe('#e9e4d8')
    } finally {
      rect.mockRestore()
    }
  })
})
