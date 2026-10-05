import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { bootKey, hashString, librarySignature, recordLibrary, clearPoster,
  POSTER_IMG_KEY, POSTER_META_KEY, LIBRARY_SIG_KEY } from '../../src/js/boot-poster.js'

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const inline = html.match(/<body>\s*<script>([\s\S]*?)<\/script>/)[1].replace('__BUILD_ID__', 'dev')

function runInline() {
  document.getElementById('boot-poster')?.remove()
  document.documentElement.classList.remove('ihr-boot-skeleton')
  new Function(inline)()
}
const IMAGE = 'data:image/webp;base64,UklGRg=='

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  window.matchMedia = () => ({ matches: false })
})

describe('boot poster key', () => {
  it('is produced identically by the inline script of index.html and by the module', () => {
    localStorage.setItem(POSTER_META_KEY, JSON.stringify({ k: bootKey(), x: 0, y: 61, w: 390, h: 783, c: [0, 0, 0, 0] }))
    localStorage.setItem(POSTER_IMG_KEY, IMAGE)
    runInline()
    const poster = document.getElementById('boot-poster')
    expect(poster).not.toBeNull()
    expect(poster.getAttribute('aria-hidden')).toBe('true')
    expect(poster.alt).toBe('')
    expect(document.documentElement.classList.contains('ihr-boot-skeleton')).toBe(false)
  })

  it.each([
    ['theme', () => localStorage.setItem('inhouse-read-theme', 'dark')],
    ['view mode', () => localStorage.setItem('inhouse-read-shelf-view', 'isometric')],
    ['shelf type', () => localStorage.setItem('inhouse-read-shelf-type', 'baggebo')],
    ['plants', () => localStorage.setItem('inhouse-read-shelf-plants', '[{"id":"a"}]')],
    ['lamps', () => localStorage.setItem('inhouse-read-shelf-lamps', '[{"key":"a"}]')],
    ['library', () => localStorage.setItem(LIBRARY_SIG_KEY, 'other:3')]
  ])('shows no poster, only the skeleton, after the %s changed', (_, change) => {
    localStorage.setItem(POSTER_META_KEY, JSON.stringify({ k: bootKey(), x: 0, y: 61, w: 390, h: 783 }))
    localStorage.setItem(POSTER_IMG_KEY, IMAGE)
    change()
    runInline()
    expect(document.getElementById('boot-poster')).toBeNull()
    expect(document.documentElement.classList.contains('ihr-boot-skeleton')).toBe(true)
  })

  it('shows the skeleton on a first launch, and ignores a poster that is not a WebP image', () => {
    runInline()
    expect(document.documentElement.classList.contains('ihr-boot-skeleton')).toBe(true)
    localStorage.setItem(POSTER_META_KEY, JSON.stringify({ k: bootKey(), x: 0, y: 0, w: 1, h: 1 }))
    localStorage.setItem(POSTER_IMG_KEY, 'data:text/html;base64,AAAA')
    runInline()
    expect(document.getElementById('boot-poster')).toBeNull()
  })

  it('applies the saved theme before anything else paints', () => {
    localStorage.setItem('inhouse-read-theme', 'dark')
    runInline()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('survives storage that throws', () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError') }
    try { expect(() => runInline()).not.toThrow() } finally { Storage.prototype.getItem = original }
    expect(document.documentElement.classList.contains('ihr-boot-skeleton')).toBe(true)
  })
})

describe('library signature', () => {
  const book = { id: 'a', title: 'Uno', cover: new Blob(['abc'], { type: 'image/png' }), progressUpdatedAt: 1, locator: 'x' }

  it('ignores sync and progress metadata but follows what is drawn', () => {
    const base = librarySignature([book])
    expect(librarySignature([{ ...book, progressUpdatedAt: 99, locator: 'y', readingHistory: [1] }])).toBe(base)
    expect(librarySignature([{ ...book, title: 'Dos' }])).not.toBe(base)
    expect(librarySignature([{ ...book, cover: new Blob(['abcd'], { type: 'image/png' }) }])).not.toBe(base)
    expect(librarySignature([book, { ...book, id: 'b' }])).not.toBe(base)
    expect(librarySignature([])).not.toBe(base)
  })

  it('records the signature once and drops a visible poster when it really changed', () => {
    recordLibrary([book])
    const first = localStorage.getItem(LIBRARY_SIG_KEY)
    expect(first).toBe(librarySignature([book]))
    const poster = document.createElement('img')
    poster.id = 'boot-poster'
    document.body.append(poster)
    recordLibrary([book])
    expect(document.getElementById('boot-poster')).not.toBeNull()
    recordLibrary([book, { ...book, id: 'b' }])
    expect(document.getElementById('boot-poster')).toBeNull()
    expect(localStorage.getItem(LIBRARY_SIG_KEY)).not.toBe(first)
  })

  it('hashes like the inline script (FNV-1a)', () => {
    expect(hashString('')).toBe('811c9dc5')
    expect(hashString('a')).toBe('e40c292c')
  })

  it('clears both poster entries', () => {
    localStorage.setItem(POSTER_META_KEY, '{}'); localStorage.setItem(POSTER_IMG_KEY, IMAGE)
    clearPoster()
    expect(localStorage.getItem(POSTER_META_KEY)).toBeNull()
    expect(localStorage.getItem(POSTER_IMG_KEY)).toBeNull()
  })
})
