// Replays one scripted session against a bookshelf scene and records everything the outside world can
// observe: the canvas diagnostics, the projected buttons' inline styles, the foliage hit targets, the
// cameras and matrices of every render, the models' lifecycle calls and what the public methods return.
// Two scene modules given the same script must write the same transcript, bit for bit.
import * as THREE from 'three'
import { vi } from 'vitest'

/** State the mocked book model and renderer share with the run in progress. */
export const gpu = { renderer: null, log: [], pendingCovers: [], scene: null, camera: null }

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top })

export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The book model of the live shelf, reduced to what the scene touches. A book whose id contains "slow"
 * decodes its cover only when the script resolves it, like a real one on a slow device. */
export function bookModelMock() {
  const makeRenderer = () => {
    let ratio = 1
    const size = new THREE.Vector2()
    const renderer = {
      domElement: document.createElement('canvas'), shadowMap: {}, capabilities: { getMaxAnisotropy: () => 4 },
      getPixelRatio: () => ratio,
      setPixelRatio: value => { gpu.log.push(['setPixelRatio', value]); ratio = value },
      getSize: target => target.copy(size),
      autoClear: true, scissorTest: false, scissor: new THREE.Vector4(), viewport: new THREE.Vector4(),
      getScissorTest() { return this.scissorTest },
      setScissorTest(value) { gpu.log.push(['setScissorTest', value]); this.scissorTest = value },
      getScissor(target) { return target.copy(this.scissor) },
      setScissor(...values) { gpu.log.push(['setScissor', ...values.map(value => value.isVector4 ? value.toArray() : value)]); if (values[0].isVector4) this.scissor.copy(values[0]); else this.scissor.set(...values) },
      getViewport(target) { return target.copy(this.viewport) },
      setViewport(...values) { gpu.log.push(['setViewport', ...values.map(value => value.isVector4 ? value.toArray() : value)]); if (values[0].isVector4) this.viewport.copy(values[0]); else this.viewport.set(...values) },
      clear(...flags) { gpu.log.push(['clear', ...flags]) },
      setSize: (width, height) => { gpu.log.push(['setSize', width, height]); size.set(width, height) },
      render(scene, camera) {
        gpu.scene = scene; gpu.camera = camera
        gpu.log.push(['render', Array.from(camera.projectionMatrix.elements), camera.position.toArray(), sceneDump(scene)])
      }
    }
    return renderer
  }
  gpu.makeRenderer = makeRenderer
  return {
    getBookRenderer: () => gpu.renderer,
    lightBookScene() {},
    createBookModel(book, style, width, height, thickness, coverUrl, options = {}) {
      const model = new THREE.Group(); model.name = `book:${book.id}`
      const binding = new THREE.Mesh(new THREE.BoxGeometry(thickness * .38, height, thickness), new THREE.MeshStandardMaterial())
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding)
      const cover = new THREE.Mesh(new THREE.BoxGeometry(width, height, 1), new THREE.MeshStandardMaterial())
      cover.name = 'cover'; cover.position.set(0, 0, thickness / 2); model.add(cover)
      model.userData.overview = Boolean(options.overview)
      model.userData.inspectionResolution = options.inspectionResolution || 0
      gpu.log.push(['createBookModel', book.id, width, height, thickness, coverUrl ?? null, Boolean(options.overview), options.inspectionResolution || 0])
      if (String(book.id).includes('slow')) {
        model.userData.coverLoaded = undefined
        model.userData.ready = new Promise(resolve => gpu.pendingCovers.push(() => { model.userData.coverLoaded = true; resolve(true); model.userData.invalidate?.() }))
      } else model.userData.coverLoaded = true
      for (const name of ['updateSpineAppearance', 'updateCoverSource', 'updateCoverAppearance', 'updateEdgeAppearance'])
        model.userData[name] = (...args) => { gpu.log.push([name, book.id, args.length]) }
      if (!String(book.id).includes('nobookmark')) model.userData.updateBookmark = () => { gpu.log.push(['updateBookmark', book.id]) }
      model.userData.dispose = () => {
        gpu.log.push(['dispose', book.id])
        binding.geometry.dispose(); binding.material.dispose(); cover.geometry.dispose(); cover.material.dispose()
      }
      return model
    }
  }
}

function sceneDump(scene) {
  const dump = []
  scene.traverse(object => {
    if (object.userData.dropMarker || object.userData.entry || object.name === 'Library trash' || object.name?.startsWith('Shelf catalog') ||
      object === scene || object.userData.shelfLamp) {
      dump.push([object.name, object.visible, Array.from(object.matrixWorld.elements), object.userData.shelfLamp ? [object.intensity, object.visible] : 0])
    }
  })
  return dump
}

const numeric = value => Object.is(value, -0) ? '-0' : Number.isNaN(value) ? 'NaN' : value
const plain = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'number' ? numeric(item) : item))

function nodeRecord(node) {
  if (!node) return null
  const cover = node.querySelector(':scope > [data-shelf-cover-hit], :scope > [data-shelf-lamp-hit]')
  const svg = node.querySelector(':scope > .ihr-plant-foliage')
  return {
    style: node.getAttribute('style'), className: node.className, data: { ...node.dataset }, hidden: node.hidden,
    inert: node.inert || node.hasAttribute('inert'), tab: node.getAttribute('tabindex'), aria: node.getAttribute('aria-hidden'),
    cover: cover && { style: cover.getAttribute('style'), data: { ...cover.dataset } },
    foliage: svg && { style: svg.getAttribute('style'), box: svg.getAttribute('viewBox'), data: { ...svg.dataset },
      path: svg.querySelector(':scope > path[fill]')?.getAttribute('d'), clip: svg.querySelector('clipPath path')?.getAttribute('d'),
      events: svg.querySelector(':scope > path[fill]')?.style.pointerEvents }
  }
}

function snapshot(run) {
  const { shelf, nodes, stage, scroller, trashNode, catalogNode } = run
  const log = gpu.log.splice(0)
  return JSON.stringify(plain({
    canvas: { data: { ...shelf.canvas.dataset }, style: shelf.canvas.getAttribute('style'), width: shelf.canvas.width, height: shelf.canvas.height },
    stage: { style: stage.getAttribute('style'), className: stage.className },
    scroll: scroller.scrollTop,
    inspection: shelf.getInspectionView(),
    nodes: nodes.map(nodeRecord), trash: nodeRecord(trashNode), catalog: nodeRecord(catalogNode),
    log
  }))
}

const CLASSES = ['is-away', 'is-pressed', 'is-lifted', 'is-dragging', 'is-press-pending']

/** One reproducible session. `create` is the scene factory under test. Returns the transcript. */
export async function runScenario(create, seed, { steps = 60, units } = {}) {
  const random = mulberry32(seed * 7919 + 13)
  const pick = list => list[Math.floor(random() * list.length)]
  const between = (low, high) => low + random() * (high - low)
  const whole = (low, high) => Math.floor(between(low, high + 1))
  const transcript = []

  // Environment: one clock, one frame queue, fake timers, a window and a layout that answer like a browser.
  let clock = 0, serial = 0
  const frames = new Map()
  const cleanups = []
  const undoing = spy => { cleanups.push(() => spy.mockRestore()); return spy }
  const stub = (target, key, value) => {
    const had = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, { configurable: true, writable: true, value })
    cleanups.push(() => { if (had) Object.defineProperty(target, key, had); else delete target[key] })
  }
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; frames.set(id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    undoing(vi.spyOn(performance, 'now').mockImplementation(() => clock))
    const visibility = { value: 'visible' }
    undoing(vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility.value))
    undoing(vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture()))
    undoing(vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      const canvas = this
      return this.__context ||= {
        canvas, createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData() {},
        drawImage(_source, ...args) { gpu.log.push(['drawImage', canvas.className, ...args]) },
        clearRect(...args) { gpu.log.push(['clearRect', canvas.className, ...args]) }
      }
    }))
    stub(window, 'innerWidth', whole(360, 440))
    stub(window, 'innerHeight', whole(640, 900))
    stub(window, 'devicePixelRatio', pick([1, 1.5, 2, 2.625, 3]))
    delete document.documentElement.dataset.theme
    gpu.log = []; gpu.pendingCovers = []; gpu.scene = null
    gpu.renderer = gpu.makeRenderer()

    const shelfType = pick(['walnut', 'walnut', 'baggebo'])
    const unitCount = units ?? pick([1, 1, 2])
    const unitWidth = whole(300, 400)
    const width = unitCount === 1 ? unitWidth : unitWidth * unitCount + 24 * unitWidth / 600 * (unitCount - 1)
    const sceneWidth = pick([width, width, Math.round(width * 1.2), Math.round(width * .9)])
    let height = whole(560, 820)
    const bookCount = whole(2, 11)
    const topOffset = whole(40, 120)
    const edge = random() < .35
    const view = { scroller: { left: whole(0, 30), top: topOffset, height: whole(480, 640) }, stageTop: whole(0, 80) }
    const state = { scroll: 0, scrollerHeight: view.scroller.height, stageTop: view.stageTop }

    const scroller = document.createElement('div'), stage = document.createElement('div')
    scroller.append(stage); document.body.append(scroller)
    if (edge) scroller.style.setProperty('--ihr-scene-edge-to-edge', '1')
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => state.scrollerHeight })
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => state.scroll,
      set: value => { state.scroll = Math.max(0, Math.min(Number(value) || 0, 3000)) } })
    const scrollerRect = () => rect(view.scroller.left, view.scroller.top, sceneWidth, state.scrollerHeight)
    const stageRect = () => {
      const stageHeight = parseFloat(stage.style.height) || height
      const top = view.scroller.top + state.stageTop - state.scroll + (parseFloat(stage.style.top) || 0)
      return rect(view.scroller.left, top, sceneWidth, stageHeight)
    }
    scroller.getBoundingClientRect = scrollerRect
    stage.getBoundingClientRect = stageRect
    const canvasRect = canvas => {
      const stageBox = stageRect(), canvasHeight = parseFloat(canvas.style.height) || 0
      const top = Math.min(Math.max(stageBox.top, view.scroller.top), stageBox.bottom - canvasHeight)
      return rect(view.scroller.left, top, parseFloat(canvas.style.width) || sceneWidth, canvasHeight)
    }
    undoing(vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return this.className === 'ihr-bookshelf-scene' ? canvasRect(this) : rect(0, 0, this.width, this.height)
    }))

    const trashNode = random() < .75 ? document.createElement('button') : null
    const catalogNode = random() < .6 ? document.createElement('button') : null
    if (trashNode) { trashNode.className = 'ihr-shelf-trash'; stage.append(trashNode) }
    if (catalogNode) { catalogNode.className = 'ihr-shelf-catalog'; stage.append(catalogNode) }

    const rowCount = whole(2, 4), rowHeight = Math.floor((height - 20) / rowCount) - 40
    const rows = Array.from({ length: rowCount }, (_, index) => {
      const top = 20 + index * (rowHeight + 40)
      return { top, bottom: top + rowHeight, ceiling: top - 8, unit: unitCount === 1 ? 0 : index % unitCount, ...(index === 1 ? { left: 10, right: width - 10 } : {}) }
    })
    let serialNode = 0
    const makeNode = kind => {
      const node = document.createElement('button')
      node.className = kind === 'plant' ? 'ihr-plant' : kind === 'lamp' ? 'ihr-lamp' : 'ihr-spine'
      stage.append(node); return node
    }
    const objectNode = (kind, key) => { const node = makeNode(kind); node.dataset.objectId = key; return node }
    const entrySpecs = []
    const bookSpec = index => {
      const heightPx = random() < .3 ? whole(60, 100) : whole(110, 190), thickness = whole(14, 36)
      const slow = random() < .15 ? 'slow-' : ''
      const row = index % rowCount
      return { kind: 'book', node: makeNode('book'), book: { id: `${slow}b${index}-${++serialNode}`, title: `Book ${index}`, author: 'A', spineFontSize: whole(10, 14) },
        style: { color: pick(['#41694f', '#7a3b3b', '#2f4b7c']), width: thickness, heightRatio: between(.8, 1), coverRatio: between(.5, .8) },
        x: whole(30, Math.max(31, width - 60)), y: rows[row].bottom - heightPx, width: whole(60, 100), height: heightPx, thickness, shelf: row,
        depthInset: random() < .2 ? whole(1, 8) : 0 }
    }
    for (let index = 0; index < bookCount; index++) entrySpecs.push(bookSpec(index))
    if (random() < .6) entrySpecs.push({ kind: 'plant', node: objectNode('plant', `plant:p${serialNode + 1}`), key: `plant:p${++serialNode}`, seed: `s${seed}`, variant: 'monstera',
      catalogId: 'monstera', potId: 'muskot', x: whole(40, Math.max(41, width - 80)), y: rows[0].bottom - 60, width: 86, height: 110, shelf: 0 })
    if (random() < .6) entrySpecs.push({ kind: 'lamp', node: objectNode('lamp', `lamp:l${serialNode + 1}`), key: `lamp:l${++serialNode}`, lampId: 'tarnaby', mount: 'standing',
      x: whole(40, Math.max(41, width - 80)), y: rows[0].bottom - 50, width: 40, height: 80, depth: 40, shelf: 0, isOn: random() < .7, kelvin: 2700 })
    if (random() < .4 && shelfType === 'walnut') entrySpecs.push({ kind: 'lamp', node: objectNode('lamp', `lamp:m${serialNode + 1}`), key: `lamp:m${++serialNode}`, lampId: 'mittled',
      mount: 'undershelf', x: whole(40, Math.max(41, width - 80)), y: rows[rowCount - 1].ceiling, width: 30, height: 6, depth: 30, shelf: rowCount - 1, isOn: true, kelvin: 2700 })
    const startMode = seed % 2 === 0 ? 'isometric' : 'spine'
    const layoutOf = () => ({ stage, scroller, width, sceneWidth, height, rows, trashNode, catalogNode, shelfType, unitWidth, unitCount,
      mode: startMode, entries: entrySpecs.map(spec => ({ ...spec })) })

    const first = layoutOf()
    const run = { shelf: null, nodes: entrySpecs.map(spec => spec.node), stage, scroller, trashNode, catalogNode }
    run.shelf = create(first)
    if (!run.shelf) throw new Error('The scene was not created')
    // Microtasks deliver the observers' records and resolved promises; a real macrotask now and then lets the
    // test runner talk to its host during these long scripted sessions.
    let yields = 0
    const settle = async () => {
      for (let index = 0; index < 4; index++) await Promise.resolve()
      if (++yields % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    }
    const drain = async (limit = 60) => {
      let count = 0
      while (frames.size && count++ < limit) {
        clock += 16; vi.advanceTimersByTime(16)
        const current = [...frames.values()]; frames.clear()
        for (const callback of current) callback(clock)
        await settle()
        transcript.push(`frame ${count}: ${snapshot(run)}`)
      }
    }
    const record = async (label, result) => {
      await settle()
      transcript.push(`${label}: ${JSON.stringify(plain(result ?? null))} ${snapshot(run)}`)
    }
    await record('create')
    await drain()

    const nodeOf = () => pick(run.nodes)
    const bookNodes = () => run.nodes.filter((_node, index) => entrySpecs[index].kind === 'book')
    const operations = {
      frames: async () => { await drain(whole(1, 12)); return null },
      advance: async () => { const ms = pick([20, 100, 400, 1200, 3000]); clock += ms; vi.advanceTimersByTime(ms); return ms },
      mode: async () => { const next = random() < .62 ? 'isometric' : 'spine'; run.shelf.setMode(next, { animate: random() < .6 }); return next },
      scroll: async () => {
        state.scroll = whole(0, 600)
        scroller.dispatchEvent(new Event('scroll')); return state.scroll
      },
      resize: async () => {
        window.innerWidth = whole(340, 460); window.innerHeight = whole(600, 920)
        state.scrollerHeight = whole(420, 700)
        window.dispatchEvent(new Event('resize')); return [window.innerWidth, window.innerHeight, state.scrollerHeight]
      },
      ratio: async () => { window.devicePixelRatio = pick([1, 1.25, 1.5, 2, 2.5, 3]); window.dispatchEvent(new Event('resize')); return window.devicePixelRatio },
      class: async () => {
        const node = nodeOf(), name = pick(CLASSES)
        node.classList.toggle(name); return [node.className]
      },
      drag: async () => {
        const node = nodeOf()
        node.classList.add('is-dragging'); node.style.setProperty('--ihr-drag-x', `${whole(-80, 80)}px`); node.style.setProperty('--ihr-drag-y', `${whole(-80, 80)}px`)
        return node.className
      },
      release: async () => {
        for (const node of run.nodes) { node.classList.remove('is-dragging', 'is-lifted', 'is-pressed', 'is-press-pending'); node.style.removeProperty('--ihr-drag-x'); node.style.removeProperty('--ihr-drag-y') }
        return null
      },
      disable: async () => { const node = nodeOf(); node.disabled = !node.disabled; return node.disabled },
      away: async () => { const node = pick(bookNodes()) ?? nodeOf(); node.classList.toggle('is-away'); return node.className },
      inspectBegin: async () => { run.shelf.beginInspectionGesture(); return null },
      inspectView: async () => run.shelf.setInspectionView({ zoom: between(.8, 4.4), panX: between(-300, 300), panY: between(-300, 300) },
        { moving: random() < .6, renderNow: random() < .3 }),
      inspectEnd: async () => run.shelf.setInspectionView({ zoom: run.shelf.getInspectionZoom(), panX: 0, panY: 0 }, { moving: false, renderNow: random() < .5 }),
      zoomTo: async () => run.shelf.zoomTo(between(.9, 4.2), random() < .7 ? between(0, 500) : undefined, random() < .7 ? between(0, 800) : undefined),
      panBy: async () => { run.shelf.panBy(between(-50, 50), between(-50, 50)); return null },
      hover: async () => { run.shelf.setTrashHover(random() < .6); return null },
      trash: async () => {
        const node = pick(run.nodes), animation = run.shelf.animateObjectToTrash(node, { duration: pick([0, 200, 850]) })
        if (animation) animation.finished.then(value => { transcript.push(`trash finished ${value}`) })
        return Boolean(animation)
      },
      trashThrough: async () => {
      const animation = run.shelf.animateObjectToTrash(pick(run.nodes), { duration: pick([200, 850]) })
      if (animation) animation.finished.then(value => { transcript.push(`trash finished ${value}`) })
      await drain(120); return Boolean(animation)
    },
    turnThrough: async () => {
      run.shelf.setMode(random() < .7 ? 'isometric' : 'spine', { animate: true }); await drain(80); return null
    },
    returnOverlay: async () => {
      const node = pick(bookNodes()); if (!node) return null
      const ratio = pick([1, 2]), overlay = document.createElement('canvas')
      overlay.width = window.innerWidth * ratio; overlay.height = window.innerHeight * ratio
      overlay.className = 'return-overlay'; document.body.append(overlay)
      const animation = run.shelf.returnBook(node, { duration: pick([0, 90, 180]), overlayCanvas: overlay })
      if (animation) animation.finished.then(() => { transcript.push('overlay return finished') })
      return Boolean(animation)
    },
    returnBook: async () => {
        const node = pick(bookNodes()); if (!node) return null
        const animation = run.shelf.returnBook(node, { duration: pick([0, 90, 180]) })
        if (animation) animation.finished.then(() => { transcript.push('return finished') })
        return Boolean(animation)
      },
      preview: async () => {
        const objects = entrySpecs.map(spec => ({ key: spec.kind === 'book' ? `book:${spec.book.id}` : spec.node.dataset.objectId ?? spec.key,
          shelf: whole(0, rowCount - 1), center: whole(30, 300) }))
        run.shelf.previewPlacements(objects.slice(0, whole(0, objects.length)), pick(['x', objects[0]?.key])); return null
      },
      drop: async () => {
        const value = random() < .25 ? null : { shelf: whole(0, rowCount), x: between(-.2, 1.2), ...(random() < .3 ? { mount: 'undershelf' } : {}) }
        run.shelf.setDropPosition(value); return value
      },
      lampPower: async () => {
        const lamp = run.nodes.find((_node, index) => entrySpecs[index].kind === 'lamp'); if (!lamp) return null
        run.shelf.setLampPower(lamp, random() < .5, { animate: random() < .7 }); return null
      },
      lampKelvin: async () => {
        const lamp = run.nodes.find((_node, index) => entrySpecs[index].kind === 'lamp'); if (!lamp) return null
        run.shelf.setLampKelvin(lamp, pick([2200, 2700, 4000, 6500]), { animate: random() < .7 }); return null
      },
      updateEntry: async () => {
        const index = whole(0, entrySpecs.length - 1), spec = entrySpecs[index]
        if (spec.kind !== 'book') return null
        const book = { ...spec.book, title: `${spec.book.title}!`, author: random() < .5 ? 'B' : spec.book.author }
        const style = { ...spec.style, heightRatio: between(.8, 1), coverRatio: random() < .5 ? between(.5, .8) : spec.style.coverRatio,
          width: random() < .3 ? whole(12, 40) : spec.style.width }
        Object.assign(spec, { book, style })
        run.shelf.updateEntry(spec.node, book, style, random() < .4 ? 'cover.png' : undefined); return null
      },
      resolveCover: async () => { gpu.pendingCovers.splice(0, whole(1, 3)).forEach(resolve => resolve()); return null },
      modal: async () => {
        const node = random() < .7 ? pick(bookNodes()) : null
        run.shelf.setModalBackgroundDeferred(node ?? null, { resumeHidden: random() < .3 }); return node?.className ?? null
      },
      hold: async () => { run.shelf.setPaintHeld(random() < .5); return null },
      presentation: async () => { run.shelf.setPresentationActive(random() < .6); return null },
      visibility: async () => {
        visibility.value = visibility.value === 'visible' ? 'hidden' : 'visible'
        document.dispatchEvent(new Event('visibilitychange')); return visibility.value
      },
      theme: async () => {
        if (document.documentElement.dataset.theme === 'dark') delete document.documentElement.dataset.theme
        else document.documentElement.dataset.theme = 'dark'
        return document.documentElement.dataset.theme ?? ''
      },
      flush: async () => run.shelf.flush({ force: random() < .3 }),
      query: async () => {
        const x = between(0, 520), y = between(0, 800), node = nodeOf()
        return {
          pose: run.shelf.getBookPose(node), ret: run.shelf.getReturnPose(node), book: run.shelf.getBookAtPoint(x, y)?.className ?? null,
          object: run.shelf.getObjectAtPoint(x, y)?.className ?? null, drop: run.shelf.getDropPosition(x, y, node), trash: run.shelf.hitTrash(x, y),
          zoom: run.shelf.getInspectionZoom()
        }
      },
      layout: async () => {
        const change = pick(['same', 'move', 'remove', 'add', 'rows', 'size', 'stage'])
        if (change === 'move') for (const spec of entrySpecs) if (spec.kind === 'book') spec.x = whole(30, Math.max(31, width - 60))
        if (change === 'remove' && entrySpecs.length > 2) { const [gone] = entrySpecs.splice(whole(0, entrySpecs.length - 1), 1); gone.node.remove(); run.nodes = entrySpecs.map(spec => spec.node) }
        if (change === 'add') { entrySpecs.push(bookSpec(entrySpecs.length)); run.nodes = entrySpecs.map(spec => spec.node) }
        if (change === 'rows') for (const row of rows) { row.top += whole(-6, 6); row.bottom += whole(-6, 6) }
        if (change === 'size') for (const spec of entrySpecs) if (spec.kind === 'book') { spec.height += whole(-8, 8); spec.width += whole(-6, 6) }
        if (change === 'stage') {
          const next = document.createElement('div'); scroller.append(next); next.getBoundingClientRect = stage.getBoundingClientRect
          for (const spec of entrySpecs) { const fresh = spec.node.cloneNode(false); next.append(fresh); spec.node = fresh }
          if (trashNode) next.append(trashNode); if (catalogNode) next.append(catalogNode)
          run.nodes = entrySpecs.map(spec => spec.node)
          const layout = { ...layoutOf(), stage: next }
          const result = run.shelf.updateLayout(layout)
          stage.remove(); Object.assign(run, { stage: next })
          return result
        }
        return run.shelf.updateLayout(layoutOf())
      },
      animateFrom: async () => {
        const old = new Map()
        for (const spec of entrySpecs) old.set(spec.node.dataset.objectId ?? spec.book?.id ?? spec.key, rect(whole(0, 300), whole(0, 600), 20, 100))
        run.shelf.animateFromRects(old, { draggedKey: random() < .5 ? entrySpecs[0].book?.id : undefined }); return null
      }
    }
    const names = Object.keys(operations)
    const weights = { frames: 10, advance: 3, mode: 4, scroll: 5, class: 5, drag: 3, release: 3, inspectView: 4, zoomTo: 2, query: 4, layout: 3 }
    const bag = names.flatMap(name => Array(weights[name] ?? 1).fill(name))
    // The scene starts in a known state, then the session wanders through it.
    run.shelf.setMode(startMode, { animate: false }); await drain()
    for (let step = 0; step < steps; step++) {
      const name = pick(bag)
      let result
      try { result = await operations[name]() } catch (error) { result = `threw ${error?.constructor?.name}: ${error?.message}` }
      await record(`${step} ${name}`, result)
      if (random() < .7) await drain(whole(1, 8))
    }
    await drain(200)
    run.shelf.dispose()
    await settle()
    transcript.push(`disposed: ${JSON.stringify(plain({ stage: stage.getAttribute('style'), nodes: run.nodes.map(node => node.getAttribute('style')) }))}`)

  } finally {
    for (const undo of cleanups.reverse()) undo()
    vi.unstubAllGlobals(); vi.useRealTimers()
    document.body.replaceChildren()

  }
  return transcript
}
