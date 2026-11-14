import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Texture } from 'three'
// A model's relief bake (setCoverRelief, the material bake and its rebake after a finish change) is
// rust-ui/src/relief_bake.rs. This suite plays the same script of choices, finish changes, source changes and
// disposals, at the same microtask generations and with the same scripted delays of the map builders, on a
// production model and on the frozen JavaScript model (helpers/reference-book-model.js), and compares what
// each call answered and on which generation, every call to the builders, every texture installed or
// disposed and every redraw asked for, generation by generation.
const world = vi.hoisted(() => ({ generation:0, log:[], builds:[], slices:[], updates:[], calls:0 }))
const after = async (delay, value) => { for (let i = 0; i < delay; i++) await null; if (value instanceof Error) throw value; return value }
const next = (list, fallback) => list.length ? list.shift() : fallback
vi.mock('../../src/js/cover-relief.js', async original => ({ ...await original(),
  buildReliefMaps:(source, choice, options) => {
    const [delay, kind] = next(world.builds, [1, 'packed'])
    world.log.push([world.generation, 'build', Boolean(source), JSON.stringify(choice), options.maxSize, options.selectionAlpha, options.signal.aborted, Object.keys(options).join()])
    return after(delay, world.maps(kind, choice))
  },
  updateReliefMapStrengths:(built, selection, options) => {
    const [delay, kind] = next(world.updates, [1, 'packed'])
    world.log.push([world.generation, 'update', world.id(built.normalTexture), JSON.stringify(selection), options.signal.aborted, Object.keys(options).join()])
    if (kind === 'fails') return after(delay, new Error('zones changed'))
    const normal = built.normal.slice(); normal[0] = (normal[0] + 7) & 255
    return after(delay, { ...built, pixels:{ ...built.pixels }, normal })
  } }))
vi.mock('../../src/js/cover-appearance.js', async original => ({ ...await original(),
  runInSlices:task => { let step; do { step = task.next() } while (!step.done); world.log.push([world.generation, 'material', ++world.calls]); return after(next(world.slices, 1), step.value) } }))

const production = await import('../../src/js/book-model.js')
const reference = await import('./helpers/reference-book-model.js')

const colours = ['#d4a93c', '#1f4a78', '#6a923d']
const choice = (id, strength = .75, tolerance = 4) => ({ id:`color-${id}`, color:colours[id - 1], tolerance, strength })
const book = { id:'relief-race', title:'Cover', author:'', coverFinish:'satin' }
const style = { color:'#143a2a', shade:'#0e2a1e', ink:'#fffaf0', coverRatio:.66 }
world.maps = (kind, wanted) => {
  if (kind === 'none') return null
  if (kind === 'fails') return new Error('no maps')
  const seed = JSON.stringify(wanted).length
  const built = { size:{ width:2, height:2 }, normal:new Uint8ClampedArray(16).map((_, i) => (i * 31 + seed) & 255),
    pixels:{ width:2, height:2, preserveInk:true, mask:new Uint8Array([0, 255, seed & 255, 0]), foil:new Uint8Array([0, 0, 9, 200]), gloss:new Uint8Array([0, 255, 255, 3]) } }
  if (kind === 'packed') built.normalSelectionAlpha = true
  if (kind === 'unmasked') delete built.pixels.mask
  if (kind === 'raised') { delete built.pixels.mask; built.pixels.heightMap = new Uint8Array([250, 0, 1, 2]) }
  if (kind === 'sparse') built.pixels.mask = [undefined, 7, null, 255]
  return built
}

beforeEach(() => {
  vi.stubGlobal('ImageData', class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return new Proxy({
    measureText:text => ({ width:String(text).length * 8 }), createLinearGradient:() => ({ addColorStop() {} }),
    getImageData:(_x, _y, w, h) => ({ data:new Uint8ClampedArray(w * h * 4) })
  }, { get:(object, key) => object[key] ?? (() => {}) }) })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** Play `script.steps` ([generation, operation, argument]) on one implementation's model. */
async function play(module, script) {
  const ids = new WeakMap(); let seen = 0
  Object.assign(world, { generation:0, log:[], calls:0, builds:[...script.builds ?? []], slices:[...script.slices ?? []], updates:[...script.updates ?? []] })
  world.id = texture => { if (!texture) return texture === null ? 'null' : 'none'; if (!ids.has(texture)) ids.set(texture, ++seen); return ids.get(texture) }
  const log = world.log
  const disposals = vi.spyOn(Texture.prototype, 'dispose').mockImplementation(function () { log.push([world.generation, 'dispose', world.id(this)]) })
  const model = module.createBookModel({ ...book, ...script.book }, style, 132, 200, 30, null, script.options)
  const material = model.getObjectByName('front-cover').material, cover = Array.isArray(material) ? material[0] : material
  model.userData.invalidate = () => { log.push([world.generation, 'invalidate']) }
  let previous = ''
  const bytes = texture => texture?.image?.data ? [...texture.image.data].join() : ''
  for (let generation = 0; generation < (script.generations ?? 90); generation++) {
    world.generation = generation
    for (const [at, operation, argument] of script.steps) if (at === generation) {
      const index = script.steps.findIndex(step => step[0] === at && step[1] === operation && step[2] === argument)
      if (operation === 'set') Promise.resolve(model.userData.setCoverRelief(argument)).then(value => log.push([world.generation, 'answer', index, value]), error => log.push([world.generation, 'rejected', index, String(error)]))
      else if (operation === 'finish') model.userData.updateCoverAppearance({ ...book, ...script.book, ...argument })
      else if (operation === 'source') model.userData.updateCoverSource(null, { ...book, ...script.book, title:argument }, style)
      else if (operation === 'dispose') model.userData.dispose()
      else throw new Error(operation)
    }
    const state = [world.id(cover.clearcoatNormalMap), world.id(cover.clearcoatMap), world.id(cover.roughnessMap), cover.clearcoat, cover.version,
      bytes(cover.clearcoatNormalMap), bytes(cover.clearcoatMap), JSON.stringify(model.userData.coverRelief())].join('|')
    if (state !== previous) { log.push([generation, 'state', state]); previous = state }
    await null
  }
  if (!script.steps.some(step => step[1] === 'dispose')) model.userData.dispose()
  disposals.mockRestore()
  return log
}
async function compare(script) {
  const before = await play(reference, script), after = await play(production, script)
  for (let i = 0; i < Math.max(before.length, after.length); i++) expect(after[i], `event ${i} of ${JSON.stringify(script)}`).toEqual(before[i])
  return after
}

const layers = (...list) => ({ layers:list })
it.each([
  ['a colour, then the same colour again', { steps:[[0, 'set', choice(1)], [30, 'set', choice(1, .4)]] }],
  ['a colour cleared while its maps build', { builds:[[9, 'packed']], steps:[[0, 'set', choice(1)], [5, 'set', null]] }],
  ['a newer colour overtaking a material bake', { slices:[1, 12], steps:[[0, 'set', choice(1)], [6, 'set', choice(2)], [40, 'set', choice(2, .5)]] }],
  ['maps without the selection in alpha', { builds:[[2, 'masked'], [1, 'unmasked'], [0, 'raised'], [3, 'sparse']],
    steps:[[0, 'set', choice(1)], [20, 'set', choice(2)], [40, 'set', choice(3)], [60, 'set', choice(1, .5, 9)]] }],
  ['a builder that fails, then one that answers nothing', { builds:[[2, 'fails'], [2, 'none']], steps:[[0, 'set', choice(1)], [20, 'set', choice(2)]] }],
  ['the laminate changing during the first bake', { slices:[1, 10], steps:[[0, 'set', choice(1)], [5, 'finish', { coverFinish:'matte' }]] }],
  ['a finish rebake that a clear overtakes', { slices:[1, 1, 14], steps:[[0, 'set', choice(1)], [20, 'finish', { coverFinish:'glossy' }], [24, 'set', null]] }],
  ['a finish rebake with a relief in the record', { steps:[[0, 'set', choice(2)], [20, 'finish', { coverFinish:'matte', coverRelief:choice(2) }], [40, 'finish', { coverFinish:'glossy', coverRelief:choice(3) }]] }],
  ['layers in any order, then one intensity', { steps:[[0, 'set', layers(choice(1), choice(2))], [20, 'set', layers(choice(2), choice(1))],
    [40, 'set', layers(choice(1, .1), choice(2))], [60, 'set', layers(choice(1, .1), choice(2, .75, 2))]] }],
  ['an intensity recomposition that fails, and one a clear overtakes', { updates:[[3, 'fails'], [9, 'packed']],
    steps:[[0, 'set', layers(choice(1), choice(2))], [20, 'set', layers(choice(1, .2), choice(2))], [40, 'set', layers(choice(1, .3), choice(2))], [44, 'set', null]] }],
  ['a new printed cover under a saved relief', { book:{ coverRelief:choice(1) }, steps:[[30, 'source', 'Another printed cover'], [60, 'set', choice(1)]] }],
  ['disposal during the build and a choice after it', { builds:[[8, 'packed']], steps:[[0, 'set', choice(1)], [4, 'dispose'], [20, 'set', choice(2)]] }],
  ['a saved relief on a shelf model', { book:{ coverRelief:choice(3) }, options:{ shelf:true }, steps:[[40, 'set', choice(3, .2)]] }],
  ['a saved relief on an overview model', { book:{ coverRelief:layers(choice(1), choice(3)) }, options:{ shelf:true, overview:true }, steps:[[40, 'finish', { coverFinish:'matte' }]] }],
  ['an inspected shelf model without eager relief', { options:{ shelf:true, inspectionResolution:900, eagerRelief:false }, steps:[[0, 'set', choice(1)], [1, 'set', choice(1)], [2, 'set', choice(2)]] }],
  ['an invalid choice and three choices on one generation', { steps:[[0, 'set', { id:'unknown' }], [3, 'set', choice(1)], [3, 'set', choice(2)], [3, 'set', choice(3)]] }]
])('acts on the same microtask as the frozen model: %s', async (_name, script) => {
  const log = await compare(script)
  expect(log.some(entry => entry[1] === 'answer' || entry[1] === 'build')).toBe(true)
})

it('follows 160 pseudo-random scripts of choices, finishes, sources and disposals', async () => {
  let seed = 20261114
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  const pick = list => list[Math.floor(random() * list.length)]
  const strengths = [0, .1, .5, .75, 1], kinds = ['packed', 'packed', 'packed', 'masked', 'unmasked', 'raised', 'sparse', 'none', 'fails']
  let steady = false
  const selection = () => {
    // Half the scripts keep one pair of colours and vary its intensities: the recomposition path.
    if (steady && random() < .8) return layers(choice(1, pick(strengths)), choice(2, pick(strengths)))
    const roll = random()
    if (roll < .15) return null
    if (roll < .55) return choice(1 + Math.floor(random() * 3), pick(strengths), pick([4, 4, 6]))
    const first = 1 + Math.floor(random() * 3), second = 1 + (first + Math.floor(random() * 2)) % 3
    const list = [choice(first, pick(strengths)), choice(second, pick(strengths), pick([4, 4, 2]))]
    return layers(...(random() < .5 ? list : list.reverse()))
  }
  let answers = 0, updates = 0, rebakes = 0
  for (let round = 0; round < 160; round++) {
    const steps = []
    steady = round % 2 === 1
    for (let i = 0, count = 2 + Math.floor(random() * 7); i < count; i++) {
      const at = Math.floor(random() * 50), roll = random()
      if (roll < .68) steps.push([at, 'set', selection()])
      else if (roll < .86) steps.push([at, 'finish', random() < .6 ? { coverFinish:pick(['matte', 'satin', 'glossy']) } : { coverFinish:pick(['matte', 'glossy']), coverRelief:selection() }])
      else if (roll < .95) steps.push([at, 'source', `Cover ${round}.${i}`])
      else steps.push([at, 'dispose'])
    }
    const delays = () => Array.from({ length:8 }, () => [Math.floor(random() * (steady ? 3 : 9)), pick(steady ? ['packed', 'packed', 'masked'] : kinds)])
    const script = { steps, builds:delays(), updates:delays().map(([delay, kind]) => [delay, kind === 'fails' ? 'fails' : 'packed']), slices:Array.from({ length:12 }, () => Math.floor(random() * 9)),
      book:random() < .3 ? { coverRelief:selection() } : {}, options:pick([undefined, undefined, { shelf:true }, { shelf:true, overview:true }, { eagerRelief:false }]) }
    const log = await compare(script)
    answers += log.filter(entry => entry[1] === 'answer').length; updates += log.filter(entry => entry[1] === 'update').length
    rebakes += log.filter(entry => entry[1] === 'material').length
  }
  // The corpus reaches the reuse, recomposition and rebake paths, not only first builds.
  expect(answers).toBeGreaterThan(300); expect(updates).toBeGreaterThan(10); expect(rebakes).toBeGreaterThan(200)
}, 300_000)
