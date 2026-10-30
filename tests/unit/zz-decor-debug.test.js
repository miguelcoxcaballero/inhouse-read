// @vitest-environment node
import { it, beforeAll } from 'vitest'
import * as THREE from 'three'
import { createShelfLampLighting, ensureAreaLights } from '../../src/js/zz-main-lamp-lighting.js'
import { createShelfLampLighting as original, ensureAreaLights as ensureOriginal } from './helpers/reference-shelf-lamp-lighting.js'
import { compareRooms } from './helpers/lamp-lighting-scenarios.js'

beforeAll(async () => { await Promise.all([ensureAreaLights(), ensureOriginal()]) })

it('debug', () => {
  const wrap = (create, tag) => (scene, options) => {
    const manager = create(scene, options)
    const update = manager.update.bind(manager)
    manager.update = (entries, o) => {
      const before = scene.children.map(c => `${c.type}:${c.name}`).join(',')
      const value = update(entries, o)
      if (globalThis.__trace) console.log(tag, JSON.stringify(options), value, before, '=>', scene.children.map(c => `${c.type}:${c.name}`).join(','))
      return value
    }
    return manager
  }
  globalThis.__trace = true
  try { compareRooms({ createMine: wrap(createShelfLampLighting, 'mine'), createReference: wrap(original, 'ref'), seeds: 2, frames: 1 }) } catch (error) { console.log(String(error)) }
})
