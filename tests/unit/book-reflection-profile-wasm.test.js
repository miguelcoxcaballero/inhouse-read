// @vitest-environment node
import { expect, it } from 'vitest'
import * as THREE from 'three'
import { applyBookReflectionSurface } from '../../src/js/book-reflection-surface.js'
import { applyBookReflectionSurface as original } from './helpers/reference-book-reflection-surface.js'

// The Rust waviness profile (rust-ui/src/book_reflection.rs) against the frozen JavaScript profile:
// the phase vector and the amplitude (carried by the strength uniform) must match to the bit for any seed.
function random(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 } }
const pieces = ['', 'a', 'Libro', '42|cover', 'ñandú', '東京', '😀', '\ud800', 'x\udc00', '\ufffd', '\u0000', ' ', 'back', 'binding', 'tail', 'head']
function seedOf(next) {
  const kind = Math.floor(next() * 12)
  if (kind === 0) return undefined
  if (kind === 1) return null
  if (kind === 2) return Math.floor(next() * 1e9)
  if (kind === 3) return { toString: () => 'object-seed' }
  if (kind === 4) return next() < .5
  return Array.from({ length: Math.floor(next() * 7) }, () => pieces[Math.floor(next() * pieces.length)]).join(next() < .5 ? '|' : '')
}
const snapshot = material => {
  const controls = material.userData.bookReflectionSurface
  return { phase: controls.uniforms.bookReflectionPhase.value.toArray(), strength: controls.uniforms.bookReflectionStrength.value,
    scale: controls.uniforms.bookReflectionUvScale.value.toArray(), environment: controls.uniforms.bookEnvironmentReflection.value }
}

it('derives the same phases and amplitude as the original for 20000 random seeds', () => {
  const next = random(2025)
  for (let i = 0; i < 20_000; i++) {
    const seed = seedOf(next), strength = [undefined, .018, .014, .05, .2, -1, NaN, '.03', null][Math.floor(next() * 9)]
    const options = { seed, strength, uvScale: [1, 1], environmentReflection: next() }
    const a = applyBookReflectionSurface(new THREE.MeshStandardMaterial(), options), b = original(new THREE.MeshStandardMaterial(), options)
    expect(snapshot(a)).toEqual(snapshot(b))
    // The seed of an installed material changes with setSeed; the amplitude follows it.
    const again = seedOf(next)
    a.userData.bookReflectionSurface.setSeed(again); b.userData.bookReflectionSurface.setSeed(again)
    expect(snapshot(a)).toEqual(snapshot(b))
  }
})
