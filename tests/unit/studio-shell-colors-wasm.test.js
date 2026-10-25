import { expect, it } from 'vitest'
import * as THREE from 'three'
import { rustShelf } from './helpers/rust-shelf-ready.js'

function reference(positions) {
  const attribute = new THREE.BufferAttribute(positions, 3), colors = []
  const floor = new THREE.Color(.068, .05, .037), wall = new THREE.Color(.34, .315, .288), ceiling = new THREE.Color(.5, .485, .46)
  const color = new THREE.Color()
  for (let i = 0; i < attribute.count; i++) {
    const y = attribute.getY(i) / 10
    color.copy(floor).lerp(wall, THREE.MathUtils.smoothstep(y, -.32, -.02)).lerp(ceiling, THREE.MathUtils.smoothstep(y, .3, .85))
    colors.push(color.r, color.g, color.b)
  }
  return new Float32Array(colors)
}

it('keeps every shell color byte identical to the real Three sphere recipe', () => {
  const sphere = new THREE.SphereGeometry(10, 48, 24)
  try {
    const positions = sphere.attributes.position.array, expected = reference(positions), actual = rustShelf.studio_shell_colors(positions)
    expect(new Uint8Array(actual.buffer)).toEqual(new Uint8Array(expected.buffer))
  } finally { sphere.dispose() }
})

it('preserves interpolation boundaries and randomized float32 heights', () => {
  const positions = new Float32Array(30000)
  let seed = 716723
  const edges = [-Infinity, -10, -3.2, -.2, 0, 3, 8.5, 10, Infinity, NaN]
  for (let i = 0; i < positions.length / 3; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    positions[i * 3 + 1] = i < edges.length ? edges[i] : (seed / 4294967296 - .5) * 40
  }
  expect(rustShelf.studio_shell_colors(positions)).toEqual(reference(positions))
  expect(rustShelf.studio_shell_colors(new Float32Array())).toEqual(new Float32Array())
  expect(() => rustShelf.studio_shell_colors(Float32Array.of(1, 2))).toThrow(/complete vertices/)
})
