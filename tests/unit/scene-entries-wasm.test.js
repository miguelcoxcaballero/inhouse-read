import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import * as ref from './helpers/reference-scene-math.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { prng } from './helpers/pointer-harness.js'

// What the scene decides about each book, plant and lamp, and its plans, run in Rust. Every value is compared
// bit for bit (signed zeros and NaN included) with the frozen original.
const SPECIAL = [0, -0, NaN, Infinity, -Infinity, 1, -1, .5, -.5, 1e-9, 5e-324, 1e300, -1e300, 44, 90]
function check(expected, actual, label, path = '') {
  if (typeof expected === 'number' || typeof actual === 'number') {
    if (!Object.is(expected, actual)) throw new Error(`${label} ${path}: expected ${String(expected)}${Object.is(expected, -0) ? ' (-0)' : ''}, got ${String(actual)}${Object.is(actual, -0) ? ' (-0)' : ''}`)
    return
  }
  if (expected && typeof expected === 'object') {
    for (const key of (Array.isArray(expected) || ArrayBuffer.isView(expected) ? [...expected.keys()] : Object.keys(expected))) check(expected[key], actual?.[key], label, `${path}.${key}`)
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

describe('compiled class and state texts against the frozen JavaScript', () => {
  const WORDS = ['is-away', 'is-dragging', 'is-lifted', 'is-pressed', 'is-press-pending', 'ihr-spine', 'is-awayx', 'IS-AWAY', 'x', '']
  const SEPARATORS = [' ', '  ', '\t', '\n', '\f', '\r', ' \t ', ' ', '\u000b']
  it('flags, joins and compares 40000 random class lists', () => {
    const g = generator(31)
    const flagBits = flags => (flags.away ? 1 : 0) | (flags.dragging ? 2 : 0) | (flags.lifted ? 4 : 0) | (flags.pressed ? 8 : 0)
    for (let trial = 0; trial < 40000; trial++) {
      const classes = Array.from({ length: g.random.int(0, 6) }, () => g.random.pick(WORDS)).map((word, index) => (index ? g.random.pick(SEPARATORS) : g.random.pick(['', ' ', '\t'])) + word).join('')
      const flags = ref.classFlags(classes), bits = rustShelf.scene_class_flags(classes)
      check(flagBits(flags), bits, `classes ${JSON.stringify(classes)}`)
      const dragX = g.random.pick(['', '12px', '-3.5px', 'x', '1e2px', '|']), dragY = g.random.pick(['', '0px', '8px', ' 4']), disabled = g.random.chance(.3), pointerEvents = g.random.pick(['', 'none', 'auto'])
      const text = ref.stateText(flags, dragX, dragY, disabled, pointerEvents)
      check(text, rustShelf.scene_state_text(bits, dragX, dragY, disabled, pointerEvents), `state ${trial}`)
      const other = ref.stateText({ ...flags, pressed:!flags.pressed }, dragX, g.random.chance(.3) ? '5px' : dragY, g.random.chance(.2) ? !disabled : disabled, pointerEvents)
      check(ref.pressureOnly(text, other), rustShelf.scene_pressure_only(text, other), `pressure ${trial}`)
      check(ref.pressureOnly(text, text), rustShelf.scene_pressure_only(text, text), `same ${trial}`)
      check(ref.pressureOnly('', other), rustShelf.scene_pressure_only('', other), `empty ${trial}`)
      const drag = g.random.pick(['12px', '-0px', '1e400px', '.5', 'abc', '', '  7 ', '0x10', '-.2e1', '+3', 'Infinity', '-Infinity px'])
      check(parseFloat(drag) || 0, rustShelf.scene_drag_offset(drag), `drag ${JSON.stringify(drag)}`)
    }
  })
})

describe('compiled entry boxes and taps against the frozen JavaScript', () => {
  it('builds the same slot and fallback boxes for 30000 entries', () => {
    const g = generator(32), out = new Float64Array(12)
    for (let trial = 0; trial < 30000; trial++) {
      const entry = { kind:g.random.pick(['book', 'plant', 'lamp', undefined]), mount:g.random.pick(['undershelf', 'standing', undefined]), width:g.positive(300), height:g.positive(300),
        thickness:g.positive(60), depth:g.random.pick([undefined, null, 0, 40, g.positive(200)]) }
      const slot = ref.slotBox(entry), fallback = ref.fallbackBoxOf(entry, entry.kind === 'plant')
      rustShelf.scene_entry_boxes(entry.kind === 'plant' ? 1 : entry.kind === 'lamp' ? 2 : 0, entry.mount === 'undershelf', entry.width, entry.height, entry.thickness, entry.depth, out)
      check([slot.min.x, slot.min.y, slot.min.z, slot.max.x, slot.max.y, slot.max.z], out.subarray(0, 6), `slot ${trial}`)
      if (entry.kind !== 'lamp') check([fallback.min.x, fallback.min.y, fallback.min.z, fallback.max.x, fallback.max.y, fallback.max.z], out.subarray(6, 12), `fallback ${trial}`)
    }
  })

  it('picks the nearest padded tap rectangle like the original', () => {
    const g = generator(33)
    let picked = 0
    for (let trial = 0; trial < 20000; trial++) {
      const targets = Array.from({ length: g.random.int(0, 8) }, () => ({ left:g.random() * 300, top:g.random() * 500, width:g.random.pick([16, 18, 44, g.positive(60)]), height:g.random.pick([0, 44, g.positive(200)]) }))
      const near = targets.length && g.random.chance(.7) ? g.random.pick(targets) : null
      const x = near ? near.left + near.width * g.random() * 1.1 : g.random.pick([g.random() * 350, g.num(), undefined])
      const y = near ? near.top + near.height * g.random() * 1.1 : g.random.pick([g.random() * 560, g.num(), NaN])
      const expected = ref.nearestTapTarget(targets, x, y)
      const index = rustShelf.scene_nearest_tap(new Float64Array(targets.flatMap(t => [t.left, t.top, t.width, t.height])), x, y)
      check(expected ? targets.indexOf(expected) : -1, index, `trial ${trial}`)
      if (expected) picked++
    }
    expect(picked).toBeGreaterThan(5000)
  })

  it('pads taps and steps the lift, preview and pose of 30000 entries identically', () => {
    const g = generator(34), stepIo = new Float64Array(37), projectIo = new Float64Array(44), hitIo = new Float64Array(49)
    const scene = new rustShelf.RustScene(390, 700, 390, 150, false, true, 0)
    const sizes = new Float64Array(4)
    for (let trial = 0; trial < 30000; trial++) {
      const kind = g.random.pick(['book', 'plant', 'lamp']), code = kind === 'plant' ? 1 : kind === 'lamp' ? 2 : 0
      const now = g.positive(5000), reduced = g.random.chance(.15), zoom = g.random.pick([.5, 1, 2.3, g.positive(4)])
      const turn = new THREE.Euler(g.random() * .3, -g.random() * .6, 0), q = new THREE.Quaternion().setFromEuler(turn).invert()
      const entry = { kind, mount:kind === 'lamp' && g.random.chance(.4) ? 'undershelf' : 'standing', x:g.num(400), y:g.num(700), width:g.positive(120), height:g.positive(200), depth:g.random.pick([undefined, 0, 40, g.positive(100)]),
        depthInset:g.random.pick([undefined, 0, 5, g.num(20)]), offset:{ x:g.random.pick([0, g.num(40)]), y:g.random.pick([0, g.num(40)]) },
        lift:{ value:g.random.pick([0, .22, 1, g.num(2)]), from:g.random.pick([0, 1, g.num(2)]), target:g.random.pick([0, .22, 1]), started:g.positive(5000) },
        landing:g.random.chance(.3) ? { from:g.random.pick([0, .5, 1, g.num(2)]), started:g.positive(5000), duration:g.random.pick([0, 520, g.positive(900)]) } : null,
        preview:{ x:g.random.pick([0, g.num(30)]), y:g.random.pick([0, g.num(30)]), fromX:g.num(30), fromY:g.num(30), targetX:g.num(30), targetY:g.num(30), started:g.positive(5000), active:g.random.chance(.5) } }
      const flags = { away:g.random.chance(.2), dragging:g.random.chance(.2), lifted:g.random.chance(.2), pressed:g.random.chance(.2) }
      const dragX = g.random.pick(['', '14px', '-6.5px', 'x']), dragY = g.random.pick(['', '3px', '-20px'])
      const width = 390, depth = 150
      const dpr = g.random.pick([1, 2, 2.75, 0, NaN]), windowWidth = g.random.pick([390, 599, 600, 700]), scroll = g.random.pick([0, 100, g.num(400)])
      scene.configure(width, 700, 390, depth, false)
      scene.beginEntries(now, reduced, zoom, [q.x, q.y, q.z, q.w], dpr, windowWidth, scroll, 44)
      const mirror = structuredClone(entry)
      const expected = ref.stepEntry(mirror, { flags, dragX, dragY, now, reduced, zoom, inverseRotation:q, width, depth })
      const bits = (flags.away ? 1 : 0) | (flags.dragging ? 2 : 0) | (flags.lifted ? 4 : 0) | (flags.pressed ? 8 : 0)
      stepIo.fill(0)
      stepIo.set([code, entry.mount === 'undershelf' ? 1 : 0, bits, rustShelf.scene_drag_offset(dragX), rustShelf.scene_drag_offset(dragY), entry.lift.value, entry.lift.from, entry.lift.target, entry.lift.started])
      stepIo[9] = entry.landing ? 1 : 0
      if (entry.landing) { stepIo[10] = entry.landing.from; stepIo[11] = entry.landing.started; stepIo[12] = entry.landing.duration }
      const p = entry.preview
      stepIo.set([p.x, p.y, p.fromX, p.fromY, p.targetX, p.targetY, p.started, p.active ? 1 : 0, entry.offset.x, entry.offset.y, entry.x, entry.y, entry.width, entry.height, entry.depth, entry.depthInset], 13)
      scene.stepEntry(stepIo)
      const label = `entry ${trial} ${kind}`
      const detail = `${label} ${JSON.stringify({ entry, flags, dragX, dragY, now, reduced, zoom, q:[q.x, q.y, q.z, q.w], dpr, windowWidth })}`
      check([mirror.lift.value, mirror.lift.from, mirror.lift.target, mirror.lift.started], stepIo.subarray(5, 9), `${detail} lift`)
      check(Boolean(mirror.landing), stepIo[9] !== 0, `${detail} landing`)
      check([mirror.preview.x, mirror.preview.y, mirror.preview.active ? 1 : 0], [stepIo[13], stepIo[14], stepIo[20]], `${detail} preview`)
      const pose = expected.pose
      check([pose.position.x, pose.position.y, pose.position.z, pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.scale.x], stepIo.subarray(29, 36), `${detail} pose`)
      const motion = (expected.previewChanged ? 1 : 0) | (mirror.preview.active ? 2 : 0) | (Math.abs(mirror.preview.x) + Math.abs(mirror.preview.y) > .01 ? 4 : 0) | (expected.changingLift ? 8 : 0) | (expected.liftChanged ? 16 : 0)
      check(motion, stepIo[36], label)

      // projection decisions
      const b = ref.slotBox(entry), matrix = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().compose(new THREE.Vector3(g.num(300), g.num(300), g.num(100)), new THREE.Quaternion().setFromEuler(new THREE.Euler(g.num(3), g.num(3), 0)), new THREE.Vector3(1, 1, 1).multiplyScalar(.6 + g.random() * .5)), pose.matrix)
      const rect = ref.corners(b, matrix, {})
      const isometric = g.random.chance(.6), moving = g.random.chance(.2)
      scene.setMode(isometric, g.random.chance(.3), 0, 0)
      if (isometric) { scene.measureFit(900, 0, 800, 60, 0, false); scene.setInspection(g.random.pick([1, 1.5, 3]), 0, 0, moving) }
      scene.sizeViewport(700, 844, 2, sizes)
      scene.beginEntries(now, reduced, zoom, [q.x, q.y, q.z, q.w], dpr, windowWidth, scroll, 44)
      const model = g.random.chance(.6), overview = g.random.chance(.4), drop = g.random.chance(.1) ? { complete:g.random.chance(.5) } : null
      const insertion = g.random.chance(.1) ? { overlayCanvas:g.random.chance(.5) ? {} : null } : null
      const pressure = { rect, flags, scroll, viewportHeight:sizes[0], inspectionMoving:scene.moving, inspectionZoom:scene.zoom, progress:scene.progress, transition:scene.turning,
        desiredMode:scene.isometric ? 'isometric' : 'spine', devicePixelRatio:dpr, insertion, trashDrop:drop }
      projectIo.fill(0)
      projectIo.set([code, bits, drop ? 1 : 0, insertion ? 1 : 0, model ? 1 : 0, overview ? 1 : 0, drop?.complete ? 1 : 0, insertion?.overlayCanvas ? 1 : 0], 0)
      projectIo.set([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z], 8); projectIo.set(matrix.elements, 14)
      scene.projectEntry(projectIo)
      check([rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height, rect.closest], projectIo.subarray(30, 37), `${label} rect`)
      const decided = ref.projectDecisions({ ...entry, model:model ? {} : null, overview, inspectionResolution:0 }, pressure)
      check([decided.visible ? 1 : 0, decided.applies ? 1 : 0, decided.overview ? 1 : 0, decided.inspectionResolution, decided.modelVisible ? 1 : 0], projectIo.subarray(37, 42), `${label} decisions`)

      // the button
      const hitBox = g.random.chance(.5) ? b : new THREE.Box3(new THREE.Vector3(g.num(30), g.num(30), g.num(10)), new THREE.Vector3(g.num(60), g.num(60), g.num(10)))
      const hitMatrix = matrix
      const disabledOrInert = g.random.chance(.2)
      hitIo.fill(0)
      hitIo.set([code, entry.mount === 'undershelf' ? 1 : 0, bits, disabledOrInert ? 1 : 0, rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height, rect.closest], 0)
      hitIo.set([hitBox.min.x, hitBox.min.y, hitBox.min.z, hitBox.max.x, hitBox.max.y, hitBox.max.z], 11); hitIo.set(hitMatrix.elements, 17)
      scene.hitEntry(hitIo)
      const hit = ref.corners(hitBox, hitMatrix, {})
      check([hit.left, hit.right, hit.top, hit.bottom, hit.width, hit.height, hit.closest], hitIo.subarray(33, 40), `${label} hit`)
      const tap = code === 1 ? { left:hit.left, top:hit.top, width:hit.width, height:hit.height }
        : code === 2 ? ref.padTapSquare(hit, 44, {}) : ref.padTapRect(hit, windowWidth >= 600 ? 18 : 16, {})
      check([tap.left, tap.top, tap.width, tap.height], hitIo.subarray(40, 44), `${label} tap`)
      const zIndex = 100 + Math.round(rect.closest + 700)
      check([zIndex, rect.left - tap.left, rect.top - tap.top, code === 2 || scene.progress > .04 ? 1 : 0, flags.dragging || flags.away || disabledOrInert ? 0 : 1], hitIo.subarray(44, 49), `${label} cover`)
    }
    scene.free()
  })

  it('advances lamp fades, returns and previews exactly', () => {
    const g = generator(35), io = new Float64Array(8), insertionIo = new Float64Array(4), previewIo = new Float64Array(13), target = new Float64Array(2)
    for (let trial = 0; trial < 30000; trial++) {
      const label = `trial ${trial}`
      const power = { value:g.random.pick([0, 1, .5, g.num(2)]), from:g.random.pick([0, 1, g.num(2)]), target:g.random.pick([0, 1, .5]), started:g.positive(5000), duration:g.random.pick([0, 220, NaN, g.positive(500)]) }
      const isOn = g.random.pick([true, false, undefined]), now = g.positive(5000), reduced = g.random.chance(.2), mirror = { ...power }
      const expected = ref.advanceLampPower(mirror, isOn, now, reduced)
      io.set([isOn === false ? 0 : 1, power.value, power.from, power.target, power.started, power.duration, now, reduced ? 1 : 0])
      rustShelf.scene_lamp_power(io)
      check([mirror.value, mirror.from, mirror.target, mirror.started, mirror.duration, expected.moving ? 1 : 0, expected.changed ? 1 : 0], io.subarray(0, 7), label)

      const insertion = { elapsed:g.positive(800), lastFrame:g.positive(5000), duration:g.random.pick([0, 180, -1, NaN, g.positive(900)]) }
      const copy = { ...insertion }, step = ref.insertionStep(copy, now)
      insertionIo.set([insertion.elapsed, insertion.lastFrame, insertion.duration, now])
      rustShelf.scene_insertion_step(insertionIo)
      check([copy.elapsed, copy.lastFrame, step.t, step.eased], insertionIo, label)

      const preview = { x:g.num(30), y:g.num(30), fromX:g.num(30), fromY:g.num(30), targetX:g.random.pick([0, g.num(30)]), targetY:g.random.pick([0, g.num(30)]), started:g.positive(5000), active:g.random.chance(.6) }
      const goal = { x:g.random.chance(.3) ? preview.targetX : g.num(30), y:g.random.chance(.3) ? preview.targetY : g.num(30) }
      const copyPreview = { ...preview }, changed = ref.previewOffset(copyPreview, goal.x, goal.y, now, reduced)
      previewIo.set([preview.x, preview.y, preview.fromX, preview.fromY, preview.targetX, preview.targetY, preview.started, preview.active ? 1 : 0, goal.x, goal.y, now, reduced ? 1 : 0])
      rustShelf.scene_preview_offset(previewIo)
      check([copyPreview.x, copyPreview.y, copyPreview.fromX, copyPreview.fromY, copyPreview.targetX, copyPreview.targetY, copyPreview.started, copyPreview.active ? 1 : 0, changed ? 1 : 0],
        [...previewIo.subarray(0, 8), previewIo[12]], label)

      const row = { left:g.random.pick([undefined, 0, 12, g.num(40)]), ceiling:g.random.pick([undefined, null, 10, g.num(40)]), top:g.num(300), bottom:g.num(600) }
      const entry = { kind:g.random.pick(['book', 'lamp']), mount:g.random.pick(['undershelf', 'standing']), x:g.num(300), y:g.num(600), height:g.positive(200) }
      const center = g.random.pick([g.num(300), 150, 0])
      const wanted = ref.previewTarget(row, center, entry), under = entry.kind === 'lamp' && entry.mount === 'undershelf'
      rustShelf.scene_preview_target(row.left || 0, under ? row.ceiling ?? row.top : 0, row.bottom, center, entry.x, entry.y, entry.height, under, target)
      check([wanted.x, wanted.y], target, label)
    }
  })

  it('computes the record size like the original', () => {
    const g = generator(36), io = new Float64Array(20)
    for (let trial = 0; trial < 30000; trial++) {
      const entry = { x:g.num(300), y:g.num(600), width:g.positive(150), height:g.positive(220), thickness:g.positive(50), style:{ heightRatio:g.random.pick([1, .8, undefined, 0, '0.9', null, NaN]) } }
      const style = { heightRatio:g.random.pick([undefined, .9, 1, 0, '.85', NaN, null]), coverRatio:g.random.pick([undefined, .5, 3, 0, -1, NaN, '.6', Infinity, g.positive(4)]), width:g.random.pick([undefined, 0, 22, '30', g.num(60), NaN]) }
      const dimensions = g.random.chance(.3) ? { width:12, height:g.random.pick([undefined, 99]) } : null
      const row = g.random.chance(.7) ? { top:g.num(200), bottom:g.num(400) } : undefined, scale = g.random.pick([.65, 1, g.positive(2)]), usableDepth = g.random.pick([220, g.positive(300)])
      const mirror = structuredClone(entry)
      ref.recordDimensions(mirror, style, { dimensions, row, scale, usableDepth })
      io.fill(0)
      io.set([entry.y, entry.height, entry.width, entry.thickness, entry.style.heightRatio, style.heightRatio, style.coverRatio, style.width, dimensions ? 1 : 0, row ? 1 : 0, row?.top, row?.bottom, usableDepth, scale])
      rustShelf.scene_record_dimensions(io)
      const result = { y:io[14], height:io[15], width:io[16], thickness:io[17] }
      if (dimensions) for (const field of ['width', 'height', 'thickness', 'x', 'y', 'depthInset', 'shelf']) if (dimensions[field] !== undefined) result[field] = dimensions[field]
      check({ y:mirror.y, height:mirror.height, width:mirror.width, thickness:mirror.thickness }, { y:result.y, height:result.height, width:result.width, thickness:result.thickness }, `trial ${trial}`)
    }
  })
})

describe('compiled scene plans against the frozen JavaScript', () => {
  it('finds the same foliage clip, and no clip when nothing moved', () => {
    const g = generator(37)
    let clips = 0, steady = 0
    for (let session = 0; session < 1500; session++) {
      const inputs = []
      let previous = new Float64Array(0), lastReference = null, last = null
      for (let step = 0; step < 12; step++) {
        const repeat = last && g.random.chance(.4)
        const grid = g.random.chance(.6)
        const rect = repeat ? last.rect : { left:grid ? g.random.int(0, 4) * 10 : g.num(300), top:grid ? 10 : g.num(300), width:grid ? 40 : g.positive(100), height:grid ? 60 : g.positive(150) }
        const reference = step && g.random.chance(.6) ? lastReference : { left:rect.left, right:rect.left + rect.width, top:rect.top, bottom:rect.top + rect.height, width:rect.width, height:rect.height }
        lastReference = reference
        const areas = repeat ? last.areas : Array.from({ length: g.random.int(0, 6) }, () => { const l = grid ? g.random.int(0, 8) * 10 : g.num(300), t = grid ? g.random.int(0, 8) * 10 : g.num(300); return { left:l, right:l + (grid ? 30 : Math.abs(g.num(80))), top:t, bottom:t + (grid ? 40 : Math.abs(g.num(100))) } })
        last = { rect, areas }
        const expected = ref.foliageClip(inputs, reference, rect, areas)
        const packed = new Float64Array(10 + areas.length * 4)
        packed.set([reference.left, reference.right, reference.top, reference.bottom, reference.width, reference.height, rect.left, rect.top, rect.width, rect.height])
        areas.forEach((a, index) => packed.set([a.left, a.right, a.top, a.bottom], 10 + index * 4))
        const actual = rustShelf.scene_foliage_clip(previous, packed)
        check(expected === null ? '' : expected, actual, `session ${session} step ${step}`)
        if (actual) { previous = packed; clips++ } else steady++
      }
    }
    expect(clips).toBeGreaterThan(3000)
    expect(steady).toBeGreaterThan(100)
  })

  it('hashes casters, dims the daylight and chooses the cache miss reason alike', () => {
    const g = generator(38)
    for (let trial = 0; trial < 30000; trial++) {
      const ids = Array.from({ length: g.random.int(0, 40) }, () => g.random.pick([g.random.int(1, 2e6), g.random.int(1e9, 4e9), 2 ** 31, 2 ** 31 - 1, 2 ** 32 + 5, g.random.int(1, 9e9)]))
      const trash = g.random.chance(.5)
      check(ref.casterHash(trash, ids), rustShelf.scene_casters(trash, new Float64Array(ids)), `casters ${trial}`)
      const power = g.random.pick([0, 1, .5, undefined, NaN, g.num(2)]), baggebo = g.random.chance(.5)
      check(ref.daylight(power, baggebo), rustShelf.scene_daylight(power, baggebo), `daylight ${trial}`)
      const flags = { noContext:g.random.chance(.1), noSnapshot:g.random.chance(.2), contentDirty:g.random.chance(.3), shadowDirty:g.random.chance(.3), sceneMoving:g.random.chance(.3), settling:g.random.chance(.3),
        shadowRefit:g.random.chance(.4), transition:g.random.chance(.2), drop:g.random.chance(.2) }
      const bits = (flags.noContext ? 1 : 0) | (flags.noSnapshot ? 2 : 0) | (flags.contentDirty ? 4 : 0) | (flags.shadowDirty ? 8 : 0) | (flags.sceneMoving ? 16 : 0) | (flags.settling && !flags.shadowRefit ? 32 : 0) | (flags.transition ? 64 : 0) | (flags.drop ? 128 : 0)
      check(ref.cacheMiss(flags), rustShelf.scene_cache_miss(bits), `miss ${trial}`)
    }
  })

  it('counts the diagnostics, fits shadows and plans captures and the room alike', () => {
    const g = generator(39), out = new Float64Array(8), box = new Float64Array(6), plan = new Float64Array(4), room = new Float64Array(16)
    for (let trial = 0; trial < 6000; trial++) {
      const entries = Array.from({ length: g.random.int(0, 30) }, () => ({ kind:g.random.pick(['book', 'book', 'plant', 'lamp']), qualityReplacement:g.random.chance(.2), plantQuality:g.random.chance(.1) ? {} : null,
        model:g.random.chance(.8) ? { visible:g.random.chance(.8), userData:{ overview:g.random.chance(.4), inspectionResolution:g.random.pick([undefined, 0, 256, 1024, 2048, NaN, null]) } } : null }))
      const expected = ref.counts(entries)
      const packed = []
      for (const entry of entries) packed.push(entry.kind === 'plant' ? 1 : entry.kind === 'lamp' ? 2 : 0, entry.model?.visible ? 1 : 0, entry.qualityReplacement || entry.plantQuality ? 1 : 0, entry.model?.userData.overview ? 1 : 0, entry.model?.userData.inspectionResolution)
      const text = rustShelf.scene_counts(Float64Array.from(packed), out)
      check(expected.counts, out, `counts ${trial}`); check(expected.text, text, `text ${trial}`)

      const width = g.random.pick([320, 390, 640]), height = g.random.pick([600, 715]), depth = g.random.pick([100, 250 * width / 600]), sceneWidth = g.random.pick([width, 390, 460])
      const baggebo = g.random.chance(.4)
      const scene = new rustShelf.RustScene(width, height, sceneWidth, depth, baggebo, true, 0)
      const fullBounds = baggebo ? new THREE.Box3(new THREE.Vector3(-width / 2, -height, -depth), new THREE.Vector3(width / 2, 0, 0)) : new THREE.Box3(new THREE.Vector3(-width / 2, -height, -depth - 4), new THREE.Vector3(width / 2, 2, 12))
      const trash = g.random.chance(.5) ? { bounds:new THREE.Box3(new THREE.Vector3(-30, 0, -30), new THREE.Vector3(30, 140, 30)), position:new THREE.Vector3(g.num(300), g.num(80), g.num(100)) } : null
      const world = new THREE.Matrix4().compose(new THREE.Vector3(g.num(200), g.num(200), 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(g.random() * .3, -g.random() * .6, 0)), new THREE.Vector3(1, 1, 1).multiplyScalar(.4 + g.random()))
      const wanted = ref.shadowBounds(fullBounds, trash, world)
      scene.shadowBounds(trash ? [trash.bounds.min.x, trash.bounds.min.y, trash.bounds.min.z, trash.bounds.max.x, trash.bounds.max.y, trash.bounds.max.z, trash.position.x, trash.position.y, trash.position.z] : [], world.elements, box)
      check([wanted.min.x, wanted.min.y, wanted.min.z, wanted.max.x, wanted.max.y, wanted.max.z], box, `shadow ${trial}`)

      const sizes = new Float64Array(4); scene.measureFit(900, 0, 800, 60, 0, false); scene.sizeViewport(g.random.pick([700, 0]), 844, 2, sizes)
      const ratio = g.random.pick([1, 1.5, 2, 2.625, 3]), canvas = g.random.chance(.1) ? null : { left:g.random.pick([0, 20, 20.5, g.num(40)]), top:g.random.pick([60, 59.5, g.num(90)]) }
      const cache = g.random.chance(.5)
      const wantedPlan = ref.capturePlan({ cacheInspection:cache, viewportHeight:sizes[0], sceneWidth, ratio, canvas })
      scene.capturePlan(cache, ratio, canvas ? canvas.left : NaN, canvas ? canvas.top : NaN, plan)
      check([wantedPlan.margin, wantedPlan.renderWidth, wantedPlan.renderHeight, (wantedPlan.pixelAligned ? 1 : 0) | (wantedPlan.whole ? 2 : 0) | (wantedPlan.finite ? 4 : 0)], plan, `plan ${trial}`)

      const unitWidth = g.random.pick([width, width / 2 - 12, 300]), specWidth = 600, count = g.random.pick([1, 2, 3]), floorY = g.num(900)
      const wantedRoom = ref.roomPlan({ width, height, depth, sceneWidth, unitWidth, specWidth, baggeboWidth:600, unitCount:count, floorY })
      scene.roomPlan(unitWidth, specWidth, 600, count, floorY, room)
      check([wantedRoom.unitScale, wantedRoom.unitGap, ...wantedRoom.floor, ...wantedRoom.floorPosition, wantedRoom.roomSpan, wantedRoom.wall[1], wantedRoom.wall[2], ...wantedRoom.centers], room.subarray(0, 10 + count), `room ${trial}`)
      const stand = new Float64Array(3), minZ = g.num(100), minY = g.num(100), wallZ = g.num(600), radius = g.random.pick([44, g.positive(80)])
      scene.trashStand(radius, minZ, minY, wallZ, floorY, 12, stand)
      check(ref.trashStand({ width, depth, radius, boundsMin:{ y:minY, z:minZ }, wallZ, floorY, gap:12 }), stand, `stand ${trial}`)
      scene.free()
    }
  })

  it('keeps no JavaScript handle alive and survives a million calls', () => {
    const before = rustShelf.shelf_live_handles(), out = new Float64Array(7)
    for (let index = 0; index < 20; index++) {
      const scene = new rustShelf.RustScene(390, 700, 390, 150, false, index % 2 === 0, 0)
      for (let call = 0; call < 5000; call++) rustShelf.scene_corners([0, 0, 0, 1, 1, 1], new THREE.Matrix4().elements, out)
      scene.free()
    }
    expect(rustShelf.shelf_live_handles()).toBe(before)
    expect(rustShelf.scene_disjoint_rects(new Float64Array(0), [0, 1, 0, 1])).toHaveLength(0)
    expect(rustShelf.scene_nearest_tap(new Float64Array(0), 1, 1)).toBe(-1)
    // malformed input is answered, not trapped
    rustShelf.scene_corners([], [], out)
    expect(Number.isNaN(out[0])).toBe(true)
  })
})
