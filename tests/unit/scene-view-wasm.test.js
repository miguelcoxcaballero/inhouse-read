import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { projectShelfDropPosition as production } from '../../src/js/bookshelf-scene.js'
import { projectShelfDropPosition as frozenDrop } from './helpers/reference-bookshelf-scene.js'
import * as ref from './helpers/reference-scene-math.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { prng } from './helpers/pointer-harness.js'

// The scene's view, entries and plans run in Rust. Every value is compared bit for bit (signed zeros and NaN
// included) with the frozen original, over large pseudo-random corpora that include the degenerate numbers
// a real session never produces.
const SPECIAL = [0, -0, NaN, Infinity, -Infinity, 1, -1, .5, -.5, 1e-9, 5e-324, 1e300, -1e300, 44, 90, 4, 160]
const same = (a, b) => Object.is(a, b)
function check(expected, actual, label, path = '') {
  if (typeof expected === 'number' || typeof actual === 'number') {
    if (!same(expected, actual)) throw new Error(`${label} ${path}: expected ${String(expected)} (${Object.is(expected, -0) ? '-0' : ''}), got ${String(actual)} (${Object.is(actual, -0) ? '-0' : ''})`)
    return
  }
  if (expected && typeof expected === 'object') {
    const keys = Array.isArray(expected) || ArrayBuffer.isView(expected) ? [...expected.keys()] : Object.keys(expected)
    for (const key of keys) check(expected[key], actual?.[key], label, `${path}.${key}`)
    return
  }
  if (expected !== actual) throw new Error(`${label} ${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
const generator = seed => {
  const random = prng(seed)
  const num = (scale = 1000) => random.chance(.1) ? random.pick(SPECIAL) : (random() - .5) * random.pick([2, scale, scale * 100])
  const positive = (scale = 1000) => random.chance(.08) ? random.pick(SPECIAL) : random() * random.pick([1, scale, scale * 10])
  return { random, num, positive }
}
const box = (g, finite = false) => {
  const a = Array.from({ length: 6 }, () => finite ? (g.random() - .5) * 400 : g.num(300))
  return new THREE.Box3(new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(a[3], a[4], a[5]))
}
const matrix = (g, finite = false) => {
  const m = new THREE.Matrix4()
  if (g.random.chance(.6)) {
    m.compose(new THREE.Vector3(g.num(500), g.num(500), g.num(500)), new THREE.Quaternion().setFromEuler(new THREE.Euler(g.num(7), g.num(7), g.num(7))),
      new THREE.Vector3(Math.abs(g.num(3)) || 1, Math.abs(g.num(3)) || 1, Math.abs(g.num(3)) || 1))
    if (finite) return m
  } else m.fromArray(Array.from({ length: 16 }, () => finite ? (g.random() - .5) * 4 : g.num(5)))
  return m
}

describe('compiled scene geometry against the frozen JavaScript', () => {
  it('projects boxes under matrices exactly (20000 random cases)', () => {
    const g = generator(11), out = new Float64Array(7)
    for (let trial = 0; trial < 20000; trial++) {
      const b = box(g, g.random.chance(.5)), m = matrix(g, g.random.chance(.5))
      const expected = ref.corners(b, m, {})
      rustShelf.scene_corners([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z], m.elements, out)
      check([expected.left, expected.right, expected.top, expected.bottom, expected.width, expected.height, expected.closest], out, `trial ${trial}`)
    }
  })

  it('builds the same disjoint strips for 20000 random sets of rectangles', () => {
    const g = generator(12)
    let strips = 0
    for (let trial = 0; trial < 20000; trial++) {
      const count = g.random.int(0, 9), grid = g.random.chance(.5)
      const edge = () => grid ? g.random.int(0, 8) * 10 : g.num(100)
      const rects = Array.from({ length: count }, () => { const l = edge(), t = edge(); return { left:l, right:l + (grid ? g.random.int(0, 4) * 10 : Math.abs(g.num(80))), top:t, bottom:t + (grid ? g.random.int(0, 4) * 10 : Math.abs(g.num(80))) } })
      const outer = { left:grid ? 0 : g.num(50), right:grid ? 80 : g.num(150), top:grid ? 0 : g.num(50), bottom:grid ? 80 : g.num(150) }
      const expected = ref.disjointRectangles(rects, outer)
      const packed = new Float64Array(rects.flatMap(r => [r.left, r.right, r.top, r.bottom]))
      const actual = rustShelf.scene_disjoint_rects(packed, [outer.left, outer.right, outer.top, outer.bottom])
      expect(actual.length).toBe(expected.length * 4)
      expected.forEach((strip, index) => check([strip.left, strip.right, strip.top, strip.bottom], actual.subarray(index * 4, index * 4 + 4), `trial ${trial}`))
      strips += expected.length
    }
    expect(strips).toBeGreaterThan(20000)
  })

  it('finds the same shelf and place for 20000 random drop rays', () => {
    const g = generator(13)
    let hit = 0, miss = 0
    for (let trial = 0; trial < 20000; trial++) {
      const finite = g.random.chance(.7)
      const ray = new THREE.Ray(new THREE.Vector3(finite ? g.random() * 400 : g.num(), finite ? g.random() * -800 : g.num(), finite ? 4000 + g.random() * 400 : g.num()),
        new THREE.Vector3(finite ? (g.random() - .5) * .4 : g.num(), finite ? (g.random() - .5) * .4 : g.num(), finite ? -1 : g.num()).normalize())
      const furniture = new THREE.Matrix4().compose(new THREE.Vector3(g.num(80), g.num(80), 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(finite ? g.random() * .3 : g.num(3), finite ? -g.random() * .6 : g.num(3), 0)), new THREE.Vector3(1, 1, 1).multiplyScalar(finite ? .5 + g.random() : Math.abs(g.num(2))))
      const rows = Array.from({ length: g.random.int(0, 5) }, (_, index) => {
        const row = { top:index * 200 + (finite ? 0 : g.num(30)), bottom:index * 200 + 180 + (finite ? 0 : g.num(30)) }
        if (g.random.chance(.4)) row.left = g.random.chance(.2) ? null : g.num(60)
        if (g.random.chance(.4)) row.right = g.num(400)
        if (g.random.chance(.4)) row.ceiling = g.random.chance(.2) ? null : row.top - g.random() * 20
        if (g.random.chance(.3)) row.padding = g.random.chance(.2) ? undefined : g.num(30)
        return row
      })
      const width = g.random.chance(.1) ? g.num() : 390
      const options = g.random.pick([undefined, {}, 16, 0, 200, NaN, { padding:8 }, { mount:'undershelf', depth:60 }, { mount:'undershelf' }, { mount:'undershelf', depth:-5, padding:2 }, { padding:'20' }])
      let expected, actual
      try { expected = frozenDrop(ray, furniture, rows, width, options) } catch (error) { expected = error.constructor.name }
      try { actual = production(ray, furniture, rows, width, options) } catch (error) { actual = error.constructor.name }
      check(expected, actual, `trial ${trial}`)
      expected ? hit++ : miss++
    }
    expect(hit).toBeGreaterThan(8000)
    expect(miss).toBeGreaterThan(500)
  })
})

describe('compiled scene view against the frozen JavaScript', () => {
  const baggeboBounds = (width, height, depth) => new THREE.Box3(new THREE.Vector3(-width / 2, -height, -depth), new THREE.Vector3(width / 2, 0, 0))
  const walnutBounds = (width, height, depth) => new THREE.Box3(new THREE.Vector3(-width / 2, -height, -depth - 4), new THREE.Vector3(width / 2, 2, 12))

  function makePair(g) {
    const width = g.random.pick([320, 386, 600, 640, 1200, g.num()]), height = g.random.pick([560, 715, 900, g.num()])
    const depth = g.random.pick([250 * width / 600, 150, g.num()]), sceneWidth = g.random.pick([width, width * 1.2, 390, g.num()])
    const baggebo = g.random.chance(.4), isometric = g.random.chance(.4), scrollTop = g.random.pick([0, 120, g.num(500)])
    const rust = new rustShelf.RustScene(width, height, sceneWidth, depth, baggebo, isometric, scrollTop)
    const state = { width, height, depth, sceneWidth, baggebo, fullBounds:(baggebo ? baggeboBounds : walnutBounds)(width, height, depth),
      progress:isometric ? 1 : 0, desiredMode:isometric ? 'isometric' : 'spine', frontalScroll:isometric ? 0 : scrollTop, transition:null,
      sceneFitHeight:1, edgeToEdge:false, inspectionZoom:1, panX:0, panY:0, inspectionMoving:false, viewportHeight:1 }
    return { rust, state }
  }

  it('runs 300 random sessions of turns, fits, inspection and viewport sizes alike', () => {
    const out = new Float64Array(8), sizes = new Float64Array(4)
    let transforms = 0
    for (let session = 0; session < 300; session++) {
      const g = generator(100 + session), { rust, state } = makePair(g)
      let now = 0
      for (let step = 0; step < 40; step++) {
        const kind = g.random.int(0, 8), label = `session ${session} step ${step} kind ${kind}`
        if (kind === 0) {
          const next = g.random.chance(.5), animate = g.random.chance(.6), scrollTop = g.random.pick([0, 80, g.num(400)])
          const wasIsometric = state.desiredMode === 'isometric'
          state.desiredMode = next ? 'isometric' : 'spine'
          const target = next ? 1 : 0
          if (!target) { state.inspectionZoom = 1; state.panX = state.panY = 0; state.inspectionMoving = false }
          if (target && !wasIsometric) state.frontalScroll = scrollTop
          const scrollTo = target ? 0 : state.frontalScroll
          if (!animate) { state.progress = target; state.transition = null }
          else state.transition = { from:state.progress, to:target, elapsed:0, lastFrame:now, scrollFrom:scrollTop, scrollTo }
          check(scrollTo, rust.setMode(next, animate, now, scrollTop), label)
        } else if (kind === 1) {
          now += g.random.pick([0, 8, 16, 33, 120, 900, -5])
          let expected
          if (state.transition) {
            const frame = ref.stepTransition(state.transition, now)
            state.progress = frame.progress
            if (frame.done) state.transition = null
            expected = frame.scrollPan
          }
          check(expected, rust.stepTurn(now), label)
          check(Boolean(state.transition), rust.turning, label)
        } else if (kind === 2) {
          state.edgeToEdge = g.random.chance(.4)
          const inputs = { innerHeight:g.random.pick([700, 844, g.num()]), clip:{ top:g.random.pick([0, 60, g.num()]), bottom:g.random.pick([700, 800, g.num()]) },
            stageBounds:{ top:g.num(300) }, scrollTop:g.num(400), paddingBottom:g.random.pick(['0px', '12.5px', '', 'x', '40']), edgeToEdge:state.edgeToEdge }
          state.sceneFitHeight = ref.measureFitHeight(inputs)
          check(state.sceneFitHeight, rust.measureFit(inputs.innerHeight, inputs.clip.top, inputs.clip.bottom, inputs.stageBounds.top + inputs.scrollTop,
            parseFloat(inputs.paddingBottom) || 0, state.edgeToEdge), label)
        } else if (kind === 3) {
          const view = { zoom:g.random.pick([1, 2.5, 5, 0, NaN, '3', null, undefined, g.num(5)]), panX:g.random.pick([0, 50, '10', g.num(400), null, NaN]), panY:g.random.pick([0, -30, g.num(400), undefined]) }
          const moving = g.random.chance(.5)
          const changed = ref.setInspectionView(state, view, moving)
          check(changed, rust.setInspection(view.zoom, view.panX, view.panY, moving), label)
        } else if (kind === 4) {
          const value = g.random.pick([1, 2, 3.7, 9, 0, 'x', '2', null]), cx = g.random.pick([undefined, NaN, 100, '5', g.num(400)]), cy = g.random.pick([undefined, 300, g.num(600)])
          const rect = { left:g.num(60), top:g.num(60) }
          check(ref.zoomTo(state, value, cx, cy, rect), rust.zoomTo(value, cx, cy, rect.left, rect.top), label)
        } else if (kind === 5) {
          const x = g.random.pick([0, 12, '4', null, NaN, g.num(100)]), y = g.random.pick([0, -9, undefined, g.num(100)])
          check(ref.panBy(state, x, y), rust.panBy(x, y), label)
        } else if (kind === 6) {
          const inputs = { clientHeight:g.random.pick([0, 700, g.num()]), innerHeight:g.random.pick([844, 700, g.num()]), devicePixelRatio:g.random.pick([0, 1, 2.625, 3, NaN, g.num(4)]) }
          const expected = ref.viewportSizes(state, inputs)
          rust.sizeViewport(inputs.clientHeight, inputs.innerHeight, inputs.devicePixelRatio, sizes)
          state.viewportHeight = expected.viewportHeight
          check([expected.viewportHeight, expected.ratio, expected.baseRatio, expected.shelfHeight], sizes, label)
          check(state.viewportHeight, rust.viewportHeight, label)
        } else if (kind === 7) {
          const trash = g.random.chance(.5) ? { bounds:box(g, true), position:new THREE.Vector3(g.num(300), g.num(80), g.num(100)) } : null
          const roof = g.random.chance(.3) ? [{ rooftop:true, y:g.num(300), height:g.num(200) }, { rooftop:true, y:g.num(300), height:g.num(200) }] : []
          const floorVisible = g.random.chance(.5), unitCount = g.random.pick([1, 2, 3])
          const expected = ref.updateTransform(state, { trash, rooftop:roof, floorVisible, unitCount })
          let rooftop = -Infinity
          for (const entry of roof) rooftop = Math.max(rooftop, -entry.y + entry.height / 2)
          const bin = trash ? [trash.bounds.min.x, trash.bounds.min.y, trash.bounds.min.z, trash.bounds.max.x, trash.bounds.max.y, trash.bounds.max.z,
            trash.position.x, trash.position.y, trash.position.z] : []
          const texts = rust.transform(new Float64Array(bin), rooftop, floorVisible, unitCount, out)
          check([expected.yaw, expected.pitch, expected.zoom, expected.x, expected.y, expected.reserve, expected.stageHeight, expected.inFrame ? 1 : 0], out, label)
          check(expected.texts, [...texts], label)
          check(state.panX, rust.panX, label); check(state.panY, rust.panY, label)
          transforms++
        } else {
          const rows = Array.from({ length: g.random.int(1, 4) }, (_, index) => ({ top:index * 200, bottom:index * 200 + 180, ...(g.random.chance(.3) ? { ceiling:index * 200 - 8 } : {}), ...(g.random.chance(.3) ? { left:12 } : {}) }))
          const position = g.random.chance(.2) ? null : { shelf:g.random.pick([0, 1, 2, 3, 4, -1, 1.5, '1', NaN]), x:g.random.pick([0, .5, 1, 2, -1, NaN, g.num(2), '.3']), ...(g.random.chance(.3) ? { mount:'undershelf' } : {}) }
          const expected = ref.dropPositionOf(position, rows)
          const shelf = Number(position?.shelf), x = Number(position?.x)
          const previous = rust.dropState()
          const changed = rust.setDrop(Boolean(position), shelf, x, position?.mount === 'undershelf', rows.length)
          const now = rust.dropState()
          check(expected ? [expected.shelf, expected.x, expected.mount ? 1 : 0] : [], now.length ? [...now] : [], label)
          check(Boolean(expected) !== (previous.length > 0) || (expected && previous.length && (previous[0] !== expected.shelf || previous[1] !== expected.x || Boolean(previous[2]) !== Boolean(expected.mount))) ? true : false, changed, label)
          if (expected) {
            const row = rows[expected.shelf]
            const marker = ref.dropMarker(row, expected, state.width, state.depth)
            check(marker, [...rust.dropMarker(packRowsLike(rows[expected.shelf]))], label)
          }
          check(Boolean(expected), rust.hasDrop, label)
        }
        check(state.progress, rust.progress, label); check(state.inspectionZoom, rust.zoom, label)
        check(state.panX, rust.panX, label); check(state.panY, rust.panY, label); check(state.inspectionMoving, rust.moving, label)
        check(state.desiredMode === 'isometric', rust.isometric, label)
        check(state.sceneFitHeight, rust.fitHeight, label)
        const canInspect = state.desiredMode === 'isometric' && !state.transition && state.progress === 1
        check(canInspect, rust.canInspect(), label)
      }
      rust.free()
    }
    expect(transforms).toBeGreaterThan(500)
  })

  it('places a retained image and the pointer view like the original', () => {
    const g = generator(14), placement = new Float64Array(4), view = new Float64Array(7)
    for (let trial = 0; trial < 5000; trial++) {
      const { rust, state } = makePair(g)
      rust.measureFit(900, 0, 800, 100, 0, false)
      state.sceneFitHeight = rust.fitHeight
      const sizes = new Float64Array(4); rust.sizeViewport(g.random.pick([700, 0]), 900, 2, sizes); state.viewportHeight = sizes[0]
      const seen = { zoom:g.random.pick([1, 1.5, 3, 4]), panX:g.num(200), panY:g.num(200) }
      ref.setInspectionView(state, seen, false); rust.setInspection(seen.zoom, seen.panX, seen.panY, false)
      const source = { zoom:g.random.pick([1, 1.5, 2, 4, 0, NaN]), panX:g.num(100), panY:g.num(100), margin:g.random.pick([0, 4, 128, g.num(30)]), width:g.positive(900), height:g.positive(900) }
      const expected = ref.project(state, source, state.viewportHeight)
      rust.snapshotPlacement(source.zoom, source.panX, source.panY, source.margin, source.width, source.height, placement)
      check([expected.scale, expected.left, expected.top, expected.covers ? 1 : 0], placement, `trial ${trial}`)
      const rect = { left:g.num(50), top:g.num(50) }
      rust.inspectionView(rect.left, rect.top, view)
      check([rust.zoom, rust.panX, rust.panY, rust.sceneWidth, rust.fitHeight, rect.left + rust.sceneWidth / 2, rect.top + rust.fitHeight / 2], view, `trial ${trial}`)
      rust.free()
    }
  })

  it('eases the reorder release and the bin lid alike', () => {
    const g = generator(15)
    for (let session = 0; session < 200; session++) {
      const { rust } = makePair(g)
      let started = null, transition = null, openness = 0, hover = false, now = 0
      for (let step = 0; step < 30; step++) {
        now += g.random.pick([0, 16, 40, 100, 600])
        const label = `session ${session} step ${step}`
        const kind = g.random.int(0, 3)
        if (kind === 0) { started = now; rust.beginReorder(now) }
        else if (kind === 1) {
          const t = started === null ? null : ref.reorderAmount(started, now)
          if (t?.done) started = null
          check(t?.amount, rust.stepReorder(now), label); check(started !== null, rust.reordering, label)
        } else if (kind === 2) {
          const requested = g.random.chance(.6), shown = g.random.chance(.7), isometric = rust.isometric
          const next = requested && isometric && shown
          const moved = next !== hover
          if (moved) { hover = next; transition = { from:openness, to:next ? 1 : 0, started:now } }
          check(moved, rust.trashSetHover(requested, shown, now), label)
        } else {
          const reduced = g.random.chance(.2)
          let moving = false
          if (transition) { const step = ref.trashTransitionStep(transition, now, reduced); openness = step.openness; moving = step.moving; if (step.done) transition = null }
          check(moving, rust.trashStep(now, reduced), label)
        }
        check(openness, rust.trashOpenness, label); check(hover, rust.trashHover, label); check(Boolean(transition), rust.trashEasing, label)
      }
      rust.free()
    }
  })

  it('computes the bin flight, its tap box and its texts exactly', () => {
    const g = generator(16), out = new Float64Array(6), flight = new Float64Array(5), overflow = new Float64Array(2)
    for (let trial = 0; trial < 20000; trial++) {
      const { rust, state } = makePair(g)
      const drop = { elapsed:g.positive(900), lastFrame:g.positive(900), complete:g.random.chance(.2), duration:g.random.pick([0, 850, 200, -5, g.positive()]), initialOpenness:g.random.pick([0, .5, 1, g.num(2)]) }
      const now = g.positive(1000), mirror = { ...drop }
      const expected = ref.trashDropStep(mirror, now)
      rustShelf.scene_trash_drop(drop.elapsed, drop.lastFrame, drop.complete, drop.duration, drop.initialOpenness, now, flight)
      check([mirror.elapsed, mirror.lastFrame, expected.t, expected.openness, expected.bounce], flight, `drop ${trial}`)
      const world = g.positive(3), radius = g.positive(100), width = g.positive(200), height = g.positive(300)
      check(ref.trashEndScale(world, radius, width, height), rustShelf.scene_trash_end_scale(world, radius, width, height), `end ${trial}`)
      const right = g.num(900), sceneWidth = g.positive(900), t = g.random.pick([0, .1, .5, 1, g.num(2)])
      const shift = ref.trashOverflow(right, sceneWidth, t)
      rustShelf.scene_trash_overflow(right, sceneWidth, t, overflow)
      check(shift !== null, overflow[0] === 1, `overflow ${trial}`); if (shift !== null) check(shift, overflow[1], `overflow ${trial}`)
      // the tap box
      const rect = ref.corners(box(g), matrix(g, true), {})
      sceneWidthSetup(rust, state, g)
      const inputs = { trashRect:rect, scroll:g.random.pick([0, 120, g.num(400)]), viewportHeight:rust.viewportHeight, sceneWidth:rust.sceneWidth, sceneFitHeight:rust.fitHeight,
        viewHidden:rust.trashViewHidden(), stageBounds:{ left:g.num(40), top:g.num(80) }, scrollerBounds:{ left:g.num(40), top:g.num(40), right:g.positive(500), bottom:g.positive(900) },
        innerWidth:g.random.pick([390, 0, g.num(600)]), innerHeight:g.random.pick([844, 0, g.num(900)]), visualBottom:g.random.pick([844, 0, -4, NaN, Infinity, g.num(900)]) }
      const frame = ref.trashFrame(inputs)
      rust.trashFrame([rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height], inputs.scroll, inputs.stageBounds.left, inputs.stageBounds.top,
        [inputs.scrollerBounds.left, inputs.scrollerBounds.top, inputs.scrollerBounds.right, inputs.scrollerBounds.bottom], inputs.innerWidth, inputs.innerHeight, inputs.visualBottom, out)
      check([frame.visible ? 1 : 0, frame.inFrame ? 1 : 0, frame.hitLeft, frame.hitTop, frame.hitWidth, frame.hitHeight], out, `frame ${trial}`)
      rust.free()
    }
    const g2 = generator(17)
    for (let trial = 0; trial < 3000; trial++) {
      const v = () => new THREE.Vector3(g2.num(500), g2.num(500), g2.num(500))
      const inputs = { position:v(), scale:g2.num(3), rotation:new THREE.Euler(g2.num(3), g2.num(3), g2.num(3)), footY:g2.num(400), floorY:g2.num(400),
        footWorld:v(), floorContact:v(), radius:g2.random.pick([44, g2.num(100)]), height:g2.random.pick([140, g2.num(300)]) }
      const texts = rustShelf.scene_trash_texts([inputs.position.x, inputs.position.y, inputs.position.z], inputs.scale, [inputs.rotation.x, inputs.rotation.y, inputs.rotation.z],
        inputs.footY, inputs.floorY, [inputs.footWorld.x, inputs.footWorld.y, inputs.footWorld.z], [inputs.floorContact.x, inputs.floorContact.y, inputs.floorContact.z], inputs.radius, inputs.height)
      check(ref.trashTexts(inputs), [...texts], `texts ${trial}`)
    }
  })

  it('places the catalogue booklet, its tap box and its face exactly', () => {
    const g = generator(18), place = new Float64Array(4), out = new Float64Array(6)
    for (let trial = 0; trial < 15000; trial++) {
      const { rust, state } = makePair(g)
      sceneWidthSetup(rust, state, g)
      const first = g.random.chance(.2) ? { top:20, bottom:220 } : { top:g.num(300), bottom:g.num(500) }
      rust.catalogPlace(first.top, first.bottom, place)
      check(ref.catalogPlace(first, state.width, state.depth, rust.progress), [...place.slice(0, 3), place[3] === 1], `place ${trial}`)
      const bounds = box(g, true), world = matrix(g, g.random.chance(.7)), cover = g.random.pick([{}, { width:76, height:108, thickness:3.4 }, { width:g.num(100), height:g.num(100), thickness:g.num(10) }])
      const layout = { stageBounds:{ left:g.num(40), top:g.num(90) }, clip:{ left:g.num(40), top:g.num(60), right:g.positive(500), bottom:g.positive(900) }, innerWidth:g.random.pick([390, g.num(500)]), innerHeight:g.random.pick([844, g.num(900)]), scroll:g.random.pick([0, 130, g.num(300)]) }
      const expected = ref.catalogFrame({ bounds, matrixWorld:world, cover, scroll:layout.scroll, viewportHeight:rust.viewportHeight, progress:rust.progress, desiredMode:rust.isometric ? 'isometric' : 'spine',
        stageBounds:layout.stageBounds, clip:layout.clip, innerWidth:layout.innerWidth, innerHeight:layout.innerHeight })
      const { width:coverWidth = 76, height:coverHeight = 108, thickness = 3.4 } = cover
      const face = rust.catalogFrame([bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z], world.elements, [coverWidth, coverHeight, thickness], layout.scroll,
        [layout.stageBounds.left, layout.stageBounds.top], [layout.clip.left, layout.clip.top, layout.clip.right, layout.clip.bottom], [layout.innerWidth, layout.innerHeight], out)
      check([expected.visible ? 1 : 0, expected.viewHidden ? 1 : 0, expected.targetWidth, expected.targetHeight, expected.left, expected.top], out, `frame ${trial}`)
      check(expected.face, face, `face ${trial}`)
      rust.free()
    }
  })

  it('finds the insertion frame like the original', () => {
    const g = generator(19), out = new Float64Array(5)
    const scene = rustShelf.RustScene ? new rustShelf.RustScene(390, 700, 390, 250, false, true, 0) : null
    let found = 0
    for (let trial = 0; trial < 15000; trial++) {
      const vw = g.random.pick([390, 360, 844, 1024, 200, 300]), vh = g.random.pick([844, 640, 700, 300, 400])
      const camera = new THREE.OrthographicCamera(-g.random.int(0, 300), vw - g.random.int(0, 300), g.random.int(0, 300), g.random.int(0, 300) - vh, .1, 20000)
      camera.position.z = 8000
      if (g.random.chance(.3)) camera.setViewOffset(vw, vh, g.random.int(0, 50), g.random.int(0, 50), g.random.int(50, vw), g.random.int(50, vh))
      camera.updateMatrixWorld(true)
      const b = new THREE.Box3(new THREE.Vector3(g.random() * 300 - 100, g.random() * -600, -g.random() * 100), new THREE.Vector3(g.random() * 400, g.random() * 100 - 100, g.random() * 100))
      if (g.random.chance(.1)) b.min.x = g.num()
      const expected = ref.insertionFrame(b, camera, vw, vh)
      scene.insertionFrame([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z], camera.matrixWorldInverse.elements, camera.projectionMatrix.elements, vw, vh, out)
      check([expected.found ? 1 : 0, expected.x, expected.y, expected.width, expected.height], out, `trial ${trial}`)
      if (expected.found) found++
    }
    expect(found).toBeGreaterThan(1000)
    scene.free()
  })
})

function sceneWidthSetup(rust, state, g) {
  // a viewport and a fit height so that the layout numbers are not the initial ones
  const sizes = new Float64Array(4)
  rust.measureFit(g.random.pick([844, 700]), 0, g.random.pick([800, 700]), g.random.pick([60, 0]), 0, g.random.chance(.3))
  rust.sizeViewport(g.random.pick([700, 0]), g.random.pick([844, 700]), 2, sizes)
  state.viewportHeight = sizes[0]
}
function packRowsLike(row) {
  const { top, bottom, left, right, ceiling, padding } = row
  return new Float64Array([Number(top), Number(bottom), Number(left), Number(right), Number(ceiling ?? top), Number(padding),
    (left !== undefined ? 1 : 0) | (right !== undefined ? 2 : 0) | (ceiling != null ? 4 : 0) | (padding !== undefined ? 8 : 0)])
}
