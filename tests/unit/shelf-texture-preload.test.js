import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Loader } from 'three'

const html = readFileSync('index.html', 'utf8')
const scene = readFileSync('src/js/bookshelf-scene.js', 'utf8')

describe('shelf texture resource hints', () => {
  it.each(['walnut-pbr.webp', 'walnut-surface.webp'])('starts loading the existing %s image from the HTML', name => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const hints = [...document.querySelectorAll('link[rel="preload"][as="image"]')]
      .filter(link => link.getAttribute('href') === `/src/assets/library/${name}`)
    expect(hints).toHaveLength(1)
    expect(scene).toContain(`new URL('../assets/library/${name}', import.meta.url).href`)
    expect(readFileSync(`src/assets/library/${name}`).length).toBeGreaterThan(0)
    expect(hints[0].getAttribute('crossorigin')).toBe(new Loader().crossOrigin)
  })
})
