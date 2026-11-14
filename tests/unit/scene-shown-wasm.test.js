import { describe, expect, it } from 'vitest'
import { rustShelf } from './helpers/rust-shelf-ready.js'

// The view's and the bin's diagnostics, written by Rust when they change (rust-ui/src/scene_shown.rs),
// against the frozen JavaScript of bookshelf-scene.js 1.7.333: the texts from transformFresh and
// trashTexts, each compared with the one last written (a Map per target) and written to the data.
// The targets are plain objects; every value, every key and the keys' order are compared after each
// frame, over views that turn, zoom and stand, a bin that moves, leaves and returns on another
// node, a flight into it and its cancellation, a shelf that changes its type, and the image that
// follows the fingers writing its four diagnostics between two frames.

const setData = (data, key, value) => { if (data[key] !== value) data[key] = value }
function frozen(scene) {
  const canvas = {}, shownData = new Map(), binShown = new Map()
  let bin = null, viewTexts = null, trashTexts = null
  const showData = (key, value) => { if (shownData.get(key) === value) return; shownData.set(key, value); setData(canvas, key, value) }
  const hideData = key => { if (shownData.delete(key)) delete canvas[key] }
  const binData = (key, value) => { if (binShown.get(key) !== value) { binShown.set(key, value); setData(bin, key, value) } }
  const trashData = (key, value) => { binData(key, value); showData(key, value) }
  return { canvas, showData, node(next) { binShown.clear(); bin = next },
    view(box, rooftop, floorVisible, units, out, shelfType, dimensions) {
      const texts = viewTexts = scene.transformFresh(box, rooftop, floorVisible, units, out) || viewTexts
      showData('shelfView', texts[0]); showData('viewProgress', texts[1]); showData('yaw', texts[2]); showData('pitch', texts[3])
      showData('zoom', texts[4]); showData('inspectionZoom', texts[5]); showData('inspectionMoving', texts[6]); showData('inspectionPan', texts[7])
      showData('cabinetWidth', texts[8]); showData('trashReserve', texts[9]); showData('shelfType', shelfType); showData('shelfUnits', texts[10])
      showData('shelfDimensions', dimensions); showData('sceneFitHeight', texts[11]); showData('floorVisible', texts[12]); showData('fullCabinetInFrame', texts[13])
    },
    noBin() {
      for (const key of ['trash3d', 'trashHover', 'trashVisible', 'trashViewHidden', 'trashLocalPosition', 'trashLocalScale',
        'trashLocalRotation', 'trashFootY', 'cabinetFloorY', 'trashCameraInFrame', 'trashFootWorld', 'floorContactWorld']) hideData(key)
    },
    drop(t) { const value = t.toFixed(4); binData('trashDropProgress', value); binData('dropProgress', value); showData('trashDropProgress', value) },
    cancel() { delete bin.trashDropProgress; delete bin.dropProgress; delete canvas.trashDropProgress
      shownData.delete('trashDropProgress'); binShown.delete('trashDropProgress'); binShown.delete('dropProgress') },
    trash(n, visible, inFrame) {
      const viewHidden = scene.trashViewHidden(), hover = String(scene.trashHover)
      binData('trash3d', 'true'); binData('trashVisible', String(visible)); binData('trashViewHidden', String(viewHidden))
      binData('trashHover', hover); binData('hover', hover)
      showData('trash3d', 'true'); showData('trashHover', hover); showData('trashVisible', String(visible)); showData('trashViewHidden', String(viewHidden))
      const texts = trashTexts = scene.trashTexts(n) || trashTexts
      trashData('trashLocalPosition', texts[0]); trashData('trashLocalScale', texts[1]); trashData('trashLocalRotation', texts[2])
      trashData('trashFootY', texts[3]); trashData('cabinetFloorY', texts[4]); trashData('trashCameraInFrame', String(inFrame))
      trashData('trashFootWorld', texts[5]); trashData('floorContactWorld', texts[6]); trashData('trashRadius', texts[7]); trashData('trashHeight', texts[8])
    } }
}
function ported(scene) {
  const canvas = {}, shownData = new Map()
  let bin = null, viewTexts = null
  const showData = (key, value) => { if (shownData.get(key) === value) return; shownData.set(key, value); setData(canvas, key, value) }
  scene.shows(canvas)
  return { canvas, showData, node(next) { bin = next; scene.binShows(next ?? undefined) },
    view(box, rooftop, floorVisible, units, out) {
      const texts = viewTexts = scene.transformShown(box, rooftop, floorVisible, units, out) || viewTexts
      showData('zoom', texts[0]); showData('inspectionZoom', texts[1]); showData('inspectionMoving', texts[2]); showData('inspectionPan', texts[3])
    },
    noBin() { scene.trashUnshown() },
    drop(t) { scene.dropShown(t.toFixed(4)) },
    cancel() { delete bin.trashDropProgress; delete bin.dropProgress; delete canvas.trashDropProgress; scene.dropUnshown() },
    trash(n, visible, inFrame) { scene.trashShown(n, visible, inFrame) } }
}

describe('the view\'s and the bin\'s diagnostics written by Rust', () => {
  it('leaves the canvas and the bin exactly as the frozen JavaScript did, frame after frame', () => {
    let seed = 20261114
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let trial = 0; trial < 12; trial++) {
      const isometric = trial % 2 === 0, baggebo = trial % 3 === 0
      const make = () => { const scene = new rustShelf.RustScene(600, 1200, 600 + trial * 40, 250, baggebo, isometric, 0); scene.measureFit(844, 60, 760, 60, 0, trial % 4 === 0); return scene }
      const a = make(), b = make(), old = frozen(a), now = ported(b)
      const out1 = new Float64Array(8), out2 = new Float64Array(8), box = new Float64Array([-40, 0, -40, 40, 140, 40, 700, -1100, 60]), none = new Float64Array(0)
      const n = new Float64Array([700.5, -1100.25, 60, .8, 0, .3, 0, -1100.25, -1100, 650.123, 900.5, 30, 650.1, 901, 30, 44, 140])
      let shelfType = baggebo ? 'baggebo' : 'walnut', dimensions = '600 x 250 x 1160 mm'
      let oldBin = {}, nowBin = {}, hasBin = trial % 5 !== 4, dropping = false, t = 0, time = 1000
      b.labels(shelfType, dimensions)
      old.node(oldBin); now.node(nowBin)
      const same = label => {
        expect(now.canvas, label).toEqual(old.canvas); expect(Object.keys(now.canvas), label).toEqual(Object.keys(old.canvas))
        expect(nowBin, label).toEqual(oldBin); expect(Object.keys(nowBin), label).toEqual(Object.keys(oldBin))
      }
      for (let frame = 0; frame < 400; frame++) {
        const dice = random(), label = `trial ${trial} frame ${frame}`
        time += 16
        if (dice < .04) { const to = !a.isometric, animate = random() < .7; a.setMode(to, animate, time, 0); b.setMode(to, animate, time, 0) }
        else if (dice < .12) { const zoom = 1 + random() * 2, x = (random() - .5) * 80, y = (random() - .5) * 80, moving = random() < .5; for (const scene of [a, b]) scene.setInspection(zoom, x, y, moving) }
        else if (dice < .2) n[Math.floor(random() * 17)] = random() < .2 ? -0 : (random() - .5) * 2000
        else if (dice < .24) { shelfType = shelfType === 'walnut' ? 'baggebo' : 'walnut'; dimensions = `${600 + frame} mm`; b.labels(shelfType, dimensions) }
        else if (dice < .28) { hasBin = !hasBin; if (hasBin && random() < .5) { oldBin = {}; nowBin = {}; old.node(oldBin); now.node(nowBin) } }
        else if (dice < .32) { const hover = random() < .5; for (const scene of [a, b]) scene.trashSetHover(hover, true, time) }
        else if (dice < .36 && hasBin) { dropping = true; t = 0 }
        else if (dice < .4) {
          // The image that follows the fingers writes its four diagnostics between two frames.
          for (const side of [old, now]) { side.showData('inspectionMoving', 'true'); side.showData('inspectionZoom', (1 + frame / 7).toFixed(4))
            side.showData('inspectionPan', JSON.stringify([frame, -frame])); side.showData('zoom', (.5 + frame / 11).toFixed(4)) }
          same(`${label} image`)
        }
        if (a.turning) { a.stepTurn(time); b.stepTurn(time) }
        old.view(hasBin ? box : none, frame % 9 ? -Infinity : 40, frame % 13 !== 0, 1 + trial % 3, out1, shelfType, dimensions)
        now.view(hasBin ? box : none, frame % 9 ? -Infinity : 40, frame % 13 !== 0, 1 + trial % 3, out2)
        expect([...out2], label).toEqual([...out1])
        if (!hasBin) { old.noBin(); now.noBin(); dropping = false }
        else {
          if (dropping) {
            t = Math.min(1, t + random() * .2); old.drop(t); now.drop(t)
            if (t === 1 || random() < .1) { dropping = false; if (random() < .7) { old.cancel(); now.cancel() } }
          }
          const visible = random() < .8, inFrame = random() < .8
          old.trash(n, visible, inFrame); now.trash(n, visible, inFrame)
        }
        same(label)
      }
      a.free(); b.free()
    }
  })

  // How a painted frame ends (RustScene#framePlan), against the frozen expressions of draw() in 1.7.333.
  it('ends a frame as the frozen JavaScript did, in every state of the view', () => {
    const frozen = (view, moving, trashMoving, localMoving, busy) => {
      const animating = Boolean(view.turning || view.reordering || moving || trashMoving || view.moving)
      const lastSceneMoving = Boolean(view.turning || view.reordering || moving || trashMoving)
      const lastLocalSceneMoving = Boolean(view.turning || view.reordering || localMoving || trashMoving)
      const quiet = !lastSceneMoving && !view.moving && !busy
      return (animating ? 1 : 0) | (lastSceneMoving ? 2 : 0) | (lastLocalSceneMoving ? 4 : 0) | (quiet ? 8 : 0) | (view.moving ? 16 : 0)
    }
    let states = 0
    for (let state = 0; state < 8; state++) {
      const view = new rustShelf.RustScene(600, 1200, 600, 250, false, false, 0)
      if (state & 1) view.setMode(true, true, 1000, 0)
      if (state & 2) view.beginReorder(1000)
      if (state & 4) view.setInspection(1.5, 3, 4, true)
      expect([view.turning, view.reordering, view.moving]).toEqual([Boolean(state & 1), Boolean(state & 2), Boolean(state & 4)])
      for (let moved = 0; moved < 16; moved++, states++)
        expect(view.framePlan(moved), `state ${state} moved ${moved}`).toBe(frozen(view, Boolean(moved & 1), Boolean(moved & 2), Boolean(moved & 4), Boolean(moved & 8)))
      view.free()
    }
    expect(states).toBe(128)
  })

  // The entries' own diagnostics (RustSceneEntryFrame#showEntries), against the frozen writes of updateEntries.
  it('writes the entries\' diagnostics as the frozen JavaScript did', () => {
    const frame = new rustShelf.RustSceneEntryFrame(), now = {}, old = {}, shownData = new Map()
    const showData = (key, value) => { if (shownData.get(key) === value) return; shownData.set(key, value); setData(old, key, value) }
    frame.shows(now)
    let seed = 99
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let step = 0; step < 2000; step++) {
      const activeBooks = random() < .5 ? 12 : Math.floor(random() * 300), summary = random() < .5 ? 3 : Math.floor(random() * 64) + Math.floor(random() * 40) * 8
      const writes = Object.keys(now).length
      showData('activeBooks', String(activeBooks)); showData('previewAnimating', String(Boolean(summary & 4))); showData('previewObjects', String(Math.floor(summary / 8)))
      frame.showEntries(activeBooks, summary)
      expect(Object.keys(now)).toEqual(Object.keys(old))
      for (const key of Object.keys(old)) expect(String(now[key]), `${key} step ${step}`).toBe(old[key])
      expect(writes === 0 || writes === 3).toBe(true)
    }
    frame.free()
  })
})
