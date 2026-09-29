import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'

vi.mock('../../src/js/book-model.js', () => ({
  bookView(host) {
    const canvas = document.createElement('canvas')
    canvas.dataset.renderer = 'three-mesh'
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
})
