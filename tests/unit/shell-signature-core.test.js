import { describe, it, expect } from 'vitest'
import { extractShellSignature } from '../../src/js/content-freshness.js'
import { extractShellSignature as reference } from './helpers/reference-content-freshness.js'

// rust-core/src/shell_signature.rs (through the page's loader) against the frozen JavaScript scan,
// on documents built from the tokens that matter and on random text.
const site = 'https://miguelcoxcaballero.github.io/inhouse-read/?x=1'
function random(seed) {
  let state = seed >>> 0
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)]
const TOKENS = ['<script', '<SCRIPT', '<Script', '<link', '<LINK', '<scripts', '<linked', '<script_', '<ſcript', '<lınk', '<', '>', '</script>', ' ', '\n', '\t', ' ', '﻿', ' ', '　', '᠎',
  'type=', 'TYPE=', 'Type=', 'type =', 'data-type=', 'rel=', 'REL=', 'src=', 'SRC=', 'data-src=', 'href=', 'HREF=', 'xhref=', '"', "'", '"module"', "'module'", '"MODULE"', '"modulex"', '"Module\'',
  '"stylesheet"', "'STYLESHEET'", '"preload"', '/assets/a.js', 'assets/b.css', './c.js', '../d.css', 'https://cdn.example/x.js', '//cdn.example/y.css', '', 'a b', '%20', '#frag', '?q=1',
  'crossorigin', 'as="font"', 'K', 'İ', 'ı', 'ſ', '😀', '\ud800', 'x']
function document(rng) {
  const parts = []
  const count = 3 + Math.floor(rng() * 40)
  for (let i = 0; i < count; i++) {
    if (rng() < .4) {
      // A plausible tag, with attributes in either order and an occasional defect.
      const tag = rng() < .5 ? 'script' : 'link'
      const ref = pick(rng, ['/assets/main-Abc.js', 'assets/x.css', './y.js', 'https://cdn.example/z.js', '//cdn.example/w.css', 'http://exa mple/x.js', 'https://[bad/y.css', 'a b.js', '', '?only=query', '#only'])
      const quote = pick(rng, ['"', "'", '"', '"', ''])
      const kind = tag === 'script' ? `type=${quote}module${quote}` : `rel=${quote}stylesheet${quote}`
      const locator = tag === 'script' ? 'src' : 'href'
      const attributes = [kind, `${locator}=${quote}${ref}${quote}`, pick(rng, ['crossorigin', 'async', 'data-x="1"', ''])]
      if (rng() < .5) attributes.reverse()
      parts.push(`<${pick(rng, [tag, tag.toUpperCase(), tag])}${pick(rng, [' ', '\n', '\t', ' ', '  '])}${attributes.join(pick(rng, [' ', '\n', '　', ' ']))}${pick(rng, ['>', '/>', '', '>'])}`)
    } else parts.push(pick(rng, TOKENS))
  }
  return parts.join(pick(rng, ['', '', ' ']))
}
function outcome(scan, html) { try { return scan(html, site) } catch (error) { return `throws:${error.constructor.name}:${error.message}` } }

describe('shell signature from the Rust core', () => {
  it('reads the same files as the original on 20,000 generated documents', () => {
    let withFiles = 0, throwing = 0, total = 0
    for (let seed = 1; seed <= 20_000; seed++) {
      const html = document(random(seed))
      const expected = outcome(reference, html)
      expect(outcome(extractShellSignature, html), `seed ${seed}: ${JSON.stringify(html)}`).toBe(expected)
      total++
      if (expected && !expected.startsWith('throws')) withFiles++
      if (expected.startsWith('throws')) throwing++
    }
    expect(withFiles).toBeGreaterThan(total / 4)
    expect(throwing).toBeGreaterThan(0)
  }, 120_000)
  it('agrees on documents of ordinary scale and on odd inputs', () => {
    const big = Array.from({ length: 3000 }, (_, index) => `<link rel="stylesheet" href="/a/${index}.css"><script type="module" src="/a/${index}.js"></script>`).join('\n')
    expect(extractShellSignature(big, site)).toBe(reference(big, site))
    expect(extractShellSignature(big, site).split(' ')).toHaveLength(6000)
    for (const html of ['', '<', '<script', '<script>', '<script type="module" src="a.js"', 'x'.repeat(100_000), '<script type="module" src="a.js">'.repeat(1000) + '<script']) {
      expect(extractShellSignature(html, site)).toBe(reference(html, site))
    }
    expect(() => extractShellSignature(undefined, site)).toThrow(TypeError)
    expect(() => reference(undefined, site)).toThrow(TypeError)
  }, 60_000)
})
