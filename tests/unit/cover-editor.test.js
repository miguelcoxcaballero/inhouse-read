import { describe, expect, it } from 'vitest'
import { EDITOR_TABS, coverEditorPose, coverTiltFrames, editorTabId, nextEditorTab } from '../../src/js/cover-editor.js'
import { sampleBookMotion } from '../../src/js/book-model.js'

describe('pestañas del editor', () => {
  it('ofrece Lomo y Portada, en ese orden, y valida el id', () => {
    expect(EDITOR_TABS.map(tab => [tab.id, tab.label, tab.heading])).toEqual([
      ['spine', 'Lomo', 'Lomo'],
      ['cover', 'Portada', 'Portada']
    ])
    expect(editorTabId('cover')).toBe('cover')
    expect(editorTabId('nope')).toBe('spine')
    expect(editorTabId(undefined)).toBe('spine')
  })

  it('el teclado recorre las pestañas con vuelta, Inicio y Fin', () => {
    expect(nextEditorTab('spine', 'ArrowRight')).toBe('cover')
    expect(nextEditorTab('cover', 'ArrowRight')).toBe('spine')
    expect(nextEditorTab('spine', 'ArrowLeft')).toBe('cover')
    expect(nextEditorTab('cover', 'ArrowLeft')).toBe('spine')
    expect(nextEditorTab('cover', 'ArrowDown')).toBe('spine')
    expect(nextEditorTab('cover', 'Home')).toBe('spine')
    expect(nextEditorTab('spine', 'End')).toBe('cover')
    expect(nextEditorTab('spine', 'Enter')).toBeNull()
    expect(nextEditorTab('spine', 'a')).toBeNull()
  })
})

describe('pose de la portada sobre la hoja', () => {
  const base = { viewportWidth: 390, viewportHeight: 844, coverW: 260, coverH: 394, centerY: 354, thickness: 30 }

  it('mira de frente y cabe en la franja libre sobre la hoja', () => {
    const pose = coverEditorPose({ ...base, sheetTop: 388 })
    expect(pose.angle).toBe(0)
    expect(pose.pitch).toBe(0)
    const half = base.coverH * pose.scale / 2
    const center = base.centerY + pose.y
    expect(center + half).toBeLessThanOrEqual(388 - 10)
    expect(center - half).toBeGreaterThanOrEqual(40)
    expect(pose.scale).toBeGreaterThan(.5)
    expect(pose.scale).toBeLessThanOrEqual(1)
  })

  it('reduce también por debajo de la escala mínima antigua para que quepa una portada alta', () => {
    const args = { ...base, viewportWidth:320, viewportHeight:568, coverH:600, sheetTop:200 }
    const pose = coverEditorPose(args)
    const bottom = args.centerY + pose.y + args.coverH * pose.scale / 2
    expect(bottom).toBeLessThanOrEqual(args.sheetTop - 18)
    expect(pose.scale).toBeGreaterThan(0)
  })

  it('una hoja más baja deja una portada más grande, nunca mayor que la de vuelo en móvil', () => {
    const low = coverEditorPose({ ...base, sheetTop: 360 })
    const high = coverEditorPose({ ...base, sheetTop: 640 })
    expect(high.scale).toBeGreaterThan(low.scale)
    expect(high.scale).toBeLessThanOrEqual(1)
  })

  it('sin medida de la hoja usa un respaldo razonable', () => {
    const pose = coverEditorPose({ ...base, sheetTop: NaN })
    expect(Number.isFinite(pose.y)).toBe(true)
    expect(pose.scale).toBeGreaterThanOrEqual(.42)
  })

  it('en pantallas anchas aprovecha la franja y puede superar la escala de vuelo', () => {
    const pose = coverEditorPose({ viewportWidth: 1280, viewportHeight: 1000, coverW: 290, coverH: 440, centerY: 420, thickness: 34, sheetTop: 760 })
    expect(pose.scale).toBeGreaterThan(1)
    expect(pose.scale).toBeLessThanOrEqual(1.2)
  })

  it('en horizontal bajo la portada se queda donde vuela el libro', () => {
    expect(coverEditorPose({ ...base, landscape: true, sheetTop: 0 })).toEqual({ x: 0, y: 0, scale: 1, angle: 0, pitch: 0 })
  })

  it('no se sale a lo ancho en una pantalla estrecha', () => {
    const pose = coverEditorPose({ viewportWidth: 320, viewportHeight: 900, coverW: 300, coverH: 300, centerY: 380, thickness: 20, sheetTop: 800 })
    expect(300 * pose.scale).toBeLessThanOrEqual(320 - 32 + 1e-6)
  })
})

describe('balanceo de la portada', () => {
  const base = { x: 0, y: -40, scale: .8, angle: 0, pitch: 0 }

  it('empieza y acaba exactamente en la pose base, en unos 2,4 s', () => {
    const { frames, duration } = coverTiltFrames(base)
    expect(duration).toBe(2400)
    expect(frames[0].transform).toEqual(base)
    expect(frames.at(-1).transform).toEqual(base)
  })

  it('oscila unas tres veces con guiñada de ±12° y cabeceo de ±7°', () => {
    const { frames } = coverTiltFrames(base)
    const yaw = frames.map(frame => frame.transform.angle)
    const pitch = frames.map(frame => frame.transform.pitch)
    expect(Math.max(...yaw)).toBeGreaterThan(11)
    expect(Math.min(...yaw)).toBeLessThan(-11)
    expect(Math.max(...yaw)).toBeLessThanOrEqual(12)
    expect(Math.max(...pitch)).toBeGreaterThan(6)
    expect(Math.max(...pitch)).toBeLessThanOrEqual(7)
    expect(Math.min(...pitch)).toBeGreaterThanOrEqual(-7)
    const crossings = yaw.slice(1).filter((value, index) => Math.sign(value) * Math.sign(yaw[index]) < 0).length
    expect(crossings).toBeGreaterThanOrEqual(5)
    expect(crossings).toBeLessThanOrEqual(7)
  })

  it('no mueve ni escala el libro: sólo gira alrededor de su pose', () => {
    const { frames } = coverTiltFrames(base)
    for (const { transform } of frames) {
      expect(transform.x).toBe(base.x)
      expect(transform.y).toBe(base.y)
      expect(transform.scale).toBe(base.scale)
    }
  })

  it('la curva muestreada por el motor de poses es continua y sin saltos', () => {
    const { frames } = coverTiltFrames(base)
    let previous = sampleBookMotion(frames, 0)
    let maxStep = 0
    for (let i = 1; i <= 288; i++) {
      const pose = sampleBookMotion(frames, i / 288)
      maxStep = Math.max(maxStep, Math.abs(pose.angle - previous.angle))
      expect(Math.abs(pose.angle)).toBeLessThanOrEqual(13)
      expect(Math.abs(pose.pitch)).toBeLessThanOrEqual(8)
      previous = pose
    }
    // A 120 fotogramas por segundo el giro no supera ~1 grado por muestra.
    expect(maxStep).toBeLessThan(1)
    expect(sampleBookMotion(frames, 1).angle).toBeCloseTo(0, 6)
  })

  it('admite otros parámetros', () => {
    const { frames, duration } = coverTiltFrames(base, { cycles: 2, yaw: 5, pitch: 2, duration: 1000 })
    expect(duration).toBe(1000)
    expect(Math.max(...frames.map(frame => Math.abs(frame.transform.angle)))).toBeLessThanOrEqual(5)
  })
})
