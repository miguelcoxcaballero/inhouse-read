/**
 * Editor de la portada: pestañas, giro del libro, propuestas de relieve y
 * balanceo. La vista 3D y el motor de relieve son dobles: aquí se prueba el
 * contrato del editor (qué pide a la vista y cuándo), no la geometría.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'
import { analyzeCoverRelief } from '../../src/js/cover-relief.js'

const views = vi.hoisted(() => [])

vi.mock('../../src/js/book-model.js', () => ({
  getBookRenderer: () => null,
  planReadingBookPose: () => ({ x: 0, y: 0, scale: 1, angle: 0, pitch: 0 }),
  fitCoverImage: (w, h) => ({ x: 0, y: 0, width: w, height: h }),
  bookView(host, book, style) {
    const canvas = document.createElement('canvas')
    canvas.dataset.renderer = 'three-mesh'
    host.append(canvas)
    let pose = { x: 0, y: 0, scale: 1, angle: 0, pitch: 0 }
    const view = {
      canvas, animations: [],
      draw() {}, updateAppearance() {}, updateSpineAppearance() {}, updateEdgeAppearance() {},
      updateCoverAppearance: vi.fn(),
      setCoverRelief: vi.fn(async () => {}),
      getPose: () => ({ ...pose }),
      animate(frames, timing) {
        const motion = { frames, timing, cancelled: false }
        view.animations.push(motion)
        pose = { ...frames.at(-1).transform }
        // Las animaciones largas (el balanceo) siguen en marcha hasta que el
        // test las termina o alguien las cancela; las cortas terminan ya.
        let end
        const finished = timing.duration > 1000 ? new Promise(resolve => { end = resolve }) : Promise.resolve()
        motion.finish = () => end?.()
        return { finished, cancel() { motion.cancelled = true; end?.() } }
      },
      dispose() {}
    }
    views.push(view)
    return view
  }
}))

vi.mock('../../src/js/cover-relief.js', async importOriginal => ({
  ...await importOriginal(),
  analyzeCoverRelief: vi.fn(),
  buildReliefMaps: vi.fn()
}))

vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(),
  readCoverAspectRatio: vi.fn(async () => 0.66),
  analyzeCoverAppearance: vi.fn(async () => null)
}))

const PROPOSALS = [
  { id: 'foil', label: 'Título y autor en relieve dorado', description: 'Letras elevadas con lámina dorada.', strength: .75, confidence: .8, thumbnail: 'data:image/png;base64,AAAA' },
  { id: 'frame', label: 'Marco grabado', description: 'Un filete en el borde.', strength: .6, confidence: .5, thumbnail: 'data:image/png;base64,BBBB' },
  { id: 'varnish', label: 'Barniz selectivo', description: 'Las zonas oscuras con brillo.', strength: .5, confidence: .3, thumbnail: 'data:image/png;base64,CCCC' }
]

let container, shelf
const flush = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))
const book = (extra = {}) => ({
  id: 'local:relieve:1', title: 'La sombra del viento', author: 'Carlos Ruiz Zafón', format: 'EPUB',
  sourceType: 'local', addedAt: 1, lastOpenedAt: 1, cover: new Blob(['x'], { type: 'image/jpeg' }), ...extra
})

function reduceMotion(reduce) {
  vi.stubGlobal('matchMedia', query => ({
    matches: reduce && /reduce/.test(query), media: query, addEventListener() {}, removeEventListener() {}
  }))
}

async function openEditor(books = [book()], options = {}) {
  container = document.createElement('div')
  document.body.append(container)
  const onBookCustomizationChange = vi.fn(async () => {})
  shelf = renderBookshelf(container, books, {
    shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, autoOpen: false,
    coverSrcFor: () => 'blob:cover-relief', onBookCustomizationChange, ...options
  })
  container.querySelector('.ihr-spine').click()
  const edit = await vi.waitFor(() => {
    const button = document.querySelector('.ihr-flyout__edit-button')
    expect(button?.disabled).toBe(false)
    return button
  })
  edit.click()
  return {
    editor: document.querySelector('.ihr-spine-editor'),
    view: views.at(-1), onBookCustomizationChange,
    tab: name => [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === name)
  }
}

beforeEach(() => {
  views.length = 0
  reduceMotion(false)
  vi.mocked(analyzeCoverRelief).mockReset()
  vi.mocked(analyzeCoverRelief).mockImplementation(async () => ({ proposals: PROPOSALS, analysis: {} }))
})
afterEach(() => {
  shelf?.destroy()
  shelf = null
  container?.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('pestañas del editor', () => {
  it('es una lista de pestañas accesible con tabulación móvil y navegación por flechas', async () => {
    const { editor, tab } = await openEditor()
    const list = editor.querySelector('[role="tablist"]')
    expect(list.getAttribute('aria-label')).toBeTruthy()
    const tabs = [...list.querySelectorAll('[role="tab"]')]
    expect(tabs.map(item => item.textContent)).toEqual(['Lomo', 'Portada'])
    expect(tabs.map(item => item.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(tabs.map(item => item.tabIndex)).toEqual([0, -1])
    const panels = tabs.map(item => document.getElementById(item.getAttribute('aria-controls')))
    expect(panels.every(panel => panel?.getAttribute('role') === 'tabpanel')).toBe(true)
    expect(panels.map(panel => panel.getAttribute('aria-labelledby'))).toEqual(tabs.map(item => item.id))
    expect(panels.map(panel => panel.hidden)).toEqual([false, true])
    expect(editor.querySelector('.ihr-spine-editor__heading').textContent).toBe('Editar el lomo')

    tabs[0].focus()
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(tab('Portada'))
    expect(tab('Portada').getAttribute('aria-selected')).toBe('true')
    expect(tab('Portada').tabIndex).toBe(0)
    expect(tab('Lomo').tabIndex).toBe(-1)
    expect(panels.map(panel => panel.hidden)).toEqual([true, false])
    expect(editor.querySelector('.ihr-spine-editor__heading').textContent).toBe('Editar la portada')
    expect(editor.getAttribute('aria-label')).toBe('Editar la portada')

    tab('Portada').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(tab('Lomo'))
    tab('Lomo').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(tab('Portada'))
    tab('Portada').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(tab('Lomo'))
  })

  it('los controles del lomo siguen en la pestaña Lomo, funcionando', async () => {
    const { editor, onBookCustomizationChange } = await openEditor()
    const spine = editor.querySelector('[role="tabpanel"]:not([hidden])')
    expect(spine.querySelector('select[aria-label="Brillo de la portada"]')).not.toBeNull()
    expect(spine.querySelector('input[aria-label="Texto del lomo"]')).not.toBeNull()
    const gloss = spine.querySelector('select[aria-label="Brillo de la portada"]')
    gloss.value = 'glossy'
    gloss.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(onBookCustomizationChange).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ coverFinish: 'glossy' })))
  })
})

describe('giro animado entre lomo y portada', () => {
  it('abrir el editor deja el lomo de canto y Portada gira el libro hasta mostrarlo de frente', async () => {
    const { view, tab } = await openEditor()
    const open = view.animations.at(-1)
    expect(open.frames.at(-1).transform.angle).toBe(90)
    const before = view.animations.length
    tab('Portada').click()
    expect(view.animations.length).toBe(before + 1)
    const turn = view.animations.at(-1)
    expect(turn.timing.duration).toBe(300)
    expect(turn.frames[0].transform.angle).toBe(90)
    const cover = turn.frames.at(-1).transform
    expect(cover.angle).toBe(0)
    expect(cover.pitch).toBe(0)
    expect(cover.scale).toBeGreaterThan(.4)
    expect(cover.scale).toBeLessThanOrEqual(1)
    tab('Lomo').click()
    const back = view.animations.at(-1)
    expect(back.timing.duration).toBe(300)
    expect(back.frames[0].transform.angle).toBe(0)
    expect(back.frames.at(-1).transform.angle).toBe(90)
  })

  it('con movimiento reducido el giro es instantáneo', async () => {
    reduceMotion(true)
    const { view, tab } = await openEditor()
    tab('Portada').click()
    expect(view.animations.at(-1).timing.duration).toBe(1)
  })

  it('cambiar de pestaña a media animación parte de donde está el libro', async () => {
    const { view, tab } = await openEditor()
    tab('Portada').click()
    tab('Lomo').click()
    tab('Portada').click()
    expect(view.animations.slice(-3).map(motion => motion.frames.at(-1).transform.angle)).toEqual([0, 90, 0])
  })

  it('Listo desde la portada devuelve el libro a la pose de vuelo y recuerda abrir en Lomo', async () => {
    const { editor, view, tab } = await openEditor()
    tab('Portada').click()
    document.querySelector('.ihr-spine-editor__done').click()
    const close = view.animations.at(-1)
    expect(close.frames.at(-1).transform).toEqual({ x: 0, y: 0, scale: 1, angle: 0, pitch: 0 })
    expect(close.frames[0].transform.angle).toBe(0)
    expect(editor.hidden).toBe(true)
    document.querySelector('.ihr-flyout__edit-button').click()
    expect(tab('Lomo').getAttribute('aria-selected')).toBe('true')
    expect(editor.querySelector('.ihr-spine-editor__heading').textContent).toBe('Editar el lomo')
  })

  it('Escape cierra el editor desde la pestaña Portada', async () => {
    const { editor, tab } = await openEditor()
    tab('Portada').click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(editor.hidden).toBe(true)
  })
})

describe('propuestas de relieve', () => {
  it('analiza la portada al entrar, con estado de carga, y ofrece exactamente tres tarjetas más Sin relieve', async () => {
    let finish
    vi.mocked(analyzeCoverRelief).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { editor, tab } = await openEditor()
    expect(analyzeCoverRelief).not.toHaveBeenCalled()
    tab('Portada').click()
    await vi.waitFor(() => expect(analyzeCoverRelief).toHaveBeenCalledTimes(1))
    const [url, options] = vi.mocked(analyzeCoverRelief).mock.calls[0]
    expect(url).toBe('blob:cover-relief')
    expect(options.title).toBe('La sombra del viento')
    expect(options.author).toBe('Carlos Ruiz Zafón')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    const status = editor.querySelector('.ihr-relief__status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('Buscando zonas con relieve…')
    expect(editor.querySelectorAll('.ihr-relief-card.is-skeleton')).toHaveLength(3)
    expect(editor.querySelectorAll('input[type="radio"]')).toHaveLength(1)

    finish({ proposals: PROPOSALS })
    await vi.waitFor(() => expect(editor.querySelectorAll('.ihr-relief-card:not(.is-skeleton)')).toHaveLength(3))
    const group = editor.querySelector('[role="radiogroup"]')
    expect(group.getAttribute('aria-label')).toBeTruthy()
    const radios = [...group.querySelectorAll('input[type="radio"]')]
    expect(radios.map(radio => radio.value)).toEqual(['foil', 'frame', 'varnish', ''])
    expect(new Set(radios.map(radio => radio.name)).size).toBe(1)
    const first = editor.querySelector('.ihr-relief-card')
    expect(first.textContent).toContain('Título y autor en relieve dorado')
    expect(first.textContent).toContain('Letras elevadas con lámina dorada.')
    expect(first.querySelector('img').getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(radios.at(-1).checked).toBe(true)
    expect(editor.querySelector('.ihr-relief-none').hidden).toBe(false)
    expect(editor.querySelector('.ihr-relief__strength input').disabled).toBe(true)
  })

  it('no repite el análisis al volver a la pestaña y lo reutiliza al reabrir el editor', async () => {
    const { tab } = await openEditor()
    tab('Portada').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.ihr-relief-card:not(.is-skeleton)')).toHaveLength(3))
    tab('Lomo').click()
    tab('Portada').click()
    document.querySelector('.ihr-spine-editor__done').click()
    document.querySelector('.ihr-flyout__edit-button').click()
    tab('Portada').click()
    await flush(20)
    expect(analyzeCoverRelief).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('.ihr-relief-card:not(.is-skeleton)')).toHaveLength(3)
  })

  it('cancela el análisis al cerrar el editor y lo vuelve a pedir al reabrir', async () => {
    vi.mocked(analyzeCoverRelief).mockImplementation(() => new Promise(() => {}))
    const { editor, tab } = await openEditor()
    tab('Portada').click()
    await vi.waitFor(() => expect(analyzeCoverRelief).toHaveBeenCalledTimes(1))
    const { signal } = vi.mocked(analyzeCoverRelief).mock.calls[0][1]
    expect(signal.aborted).toBe(false)
    document.querySelector('.ihr-spine-editor__done').click()
    expect(signal.aborted).toBe(true)
    expect(editor.querySelector('.ihr-relief__status').textContent).toBe('')
    document.querySelector('.ihr-flyout__edit-button').click()
    tab('Portada').click()
    await vi.waitFor(() => expect(analyzeCoverRelief).toHaveBeenCalledTimes(2))
  })

  it('cancela el análisis si se cierra el libro con el editor abierto', async () => {
    vi.mocked(analyzeCoverRelief).mockImplementation(() => new Promise(() => {}))
    const { tab } = await openEditor()
    tab('Portada').click()
    await vi.waitFor(() => expect(analyzeCoverRelief).toHaveBeenCalledTimes(1))
    const { signal } = vi.mocked(analyzeCoverRelief).mock.calls[0][1]
    document.querySelector('.ihr-flyout__close').click()
    expect(signal.aborted).toBe(true)
  })

  it('si falla muestra el aviso y permite reintentar', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(analyzeCoverRelief).mockRejectedValueOnce(new Error('boom'))
    const { editor, tab } = await openEditor()
    tab('Portada').click()
    await vi.waitFor(() => expect(editor.querySelector('.ihr-relief__status').textContent).toMatch(/No se pudo analizar/))
    const retry = editor.querySelector('.ihr-relief__retry')
    expect(retry.hidden).toBe(false)
    retry.click()
    await vi.waitFor(() => expect(editor.querySelectorAll('.ihr-relief-card:not(.is-skeleton)')).toHaveLength(3))
    expect(retry.hidden).toBe(true)
  })

  it('un libro sin imagen de portada no analiza nada y lo dice', async () => {
    const { editor, tab } = await openEditor([book({ cover: undefined })], { coverSrcFor: () => null })
    tab('Portada').click()
    await vi.waitFor(() => expect(editor.querySelector('.ihr-relief__status').textContent).toMatch(/no tiene imagen de portada/))
    expect(analyzeCoverRelief).not.toHaveBeenCalled()
  })
})

it('reserva las tarjetas antes del giro para que la hoja no crezca sobre la portada', async () => {
  const { editor } = await openEditor()
  expect(editor.querySelectorAll('.ihr-relief-card.is-skeleton')).toHaveLength(3)
})

describe('elegir un relieve', () => {
  async function ready() {
    const context = await openEditor()
    context.tab('Portada').click()
    await vi.waitFor(() => expect(context.editor.querySelectorAll('.ihr-relief-card:not(.is-skeleton)')).toHaveLength(3))
    context.cards = [...context.editor.querySelectorAll('.ihr-relief-card input')]
    return context
  }
  const choose = input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })) }

  it('espera a que los mapas estén aplicados antes de balancear el libro', async () => {
    const { view, cards } = await ready()
    let finish
    view.setCoverRelief.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    choose(cards[0])
    await flush(220)
    expect(view.animations.some(motion => motion.timing.duration === 2400)).toBe(false)
    finish(true)
    await vi.waitFor(() => expect(view.animations.some(motion => motion.timing.duration === 2400)).toBe(true))
  })

  it('no empieza un balanceo tardío después de cambiar de pestaña', async () => {
    const { view, cards, tab } = await ready()
    let finish
    view.setCoverRelief.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    choose(cards[0])
    tab('Lomo').click()
    finish(true)
    await flush(240)
    expect(view.animations.some(motion => motion.timing.duration === 2400)).toBe(false)
  })

  it('aplica el relieve en la vista, lo guarda con el libro y marca la tarjeta', async () => {
    const { editor, view, cards, onBookCustomizationChange } = await ready()
    choose(cards[1])
    expect(view.setCoverRelief).toHaveBeenCalledWith({ id: 'frame', strength: .6 })
    expect(cards[1].closest('.ihr-relief-card').classList.contains('is-selected')).toBe(true)
    expect(cards[0].closest('.ihr-relief-card').classList.contains('is-selected')).toBe(false)
    const slider = editor.querySelector('.ihr-relief__strength input')
    expect(slider.disabled).toBe(false)
    expect(slider.value).toBe('60')
    await vi.waitFor(() => expect(onBookCustomizationChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'local:relieve:1', coverRelief: { id: 'frame', strength: .6 } }),
      { coverRelief: { id: 'frame', strength: .6 } }))
  })

  it('el relieve no rehace el modelo del libro al cerrar el editor', async () => {
    const { view, cards } = await ready()
    choose(cards[0])
    await flush(5)
    view.updateAppearance = vi.fn()
    document.querySelector('.ihr-spine-editor__done').click()
    expect(view.updateAppearance).not.toHaveBeenCalled()
    expect(view.updateCoverAppearance).not.toHaveBeenCalled()
  })

  it('Sin relieve lo quita de la vista y del libro, sin balanceo', async () => {
    const { view, cards, editor, onBookCustomizationChange } = await ready()
    choose(cards[0])
    await flush(200)
    choose(editor.querySelector('.ihr-relief-none input'))
    expect(view.setCoverRelief).toHaveBeenLastCalledWith(null)
    const animations = view.animations.length
    await flush(250)
    expect(view.animations.length).toBe(animations)
    await vi.waitFor(() => expect(onBookCustomizationChange).toHaveBeenLastCalledWith(
      expect.anything(), { coverRelief: null }))
    expect(editor.querySelector('.ihr-relief__strength input').disabled).toBe(true)
  })

  it('el control de intensidad actualiza la vista una vez por fotograma y guarda el valor', async () => {
    const { editor, view, cards, onBookCustomizationChange } = await ready()
    choose(cards[0])
    view.setCoverRelief.mockClear()
    const slider = editor.querySelector('.ihr-relief__strength input')
    for (const value of ['40', '45', '50']) { slider.value = value; slider.dispatchEvent(new Event('input', { bubbles: true })) }
    await vi.waitFor(() => expect(view.setCoverRelief).toHaveBeenCalled())
    expect(view.setCoverRelief.mock.calls.length).toBeLessThanOrEqual(2)
    expect(view.setCoverRelief).toHaveBeenLastCalledWith({ id: 'foil', strength: .5 })
    await vi.waitFor(() => expect(onBookCustomizationChange).toHaveBeenLastCalledWith(
      expect.anything(), { coverRelief: { id: 'foil', strength: .5 } }))
  })

  it('restaura el relieve guardado: tarjeta marcada, intensidad y sin balanceo', async () => {
    const saved = book({ coverRelief: { id: 'varnish', strength: .4 } })
    const { editor, view, tab } = await openEditor([saved])
    tab('Portada').click()
    await vi.waitFor(() => expect(editor.querySelectorAll('.ihr-relief-card:not(.is-skeleton)')).toHaveLength(3))
    const radios = [...editor.querySelectorAll('.ihr-relief-card input')]
    expect(radios.map(radio => radio.checked)).toEqual([false, false, true])
    expect(editor.querySelector('.ihr-relief__strength input').value).toBe('40')
    const animations = view.animations.length
    await flush(250)
    expect(view.animations.length).toBe(animations)
    expect(view.setCoverRelief).not.toHaveBeenCalled()
  })

  it('con un relieve guardado Sin relieve sigue disponible aunque falle el análisis', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(analyzeCoverRelief).mockRejectedValue(new Error('boom'))
    const saved = book({ coverRelief: { id: 'varnish', strength: .4 } })
    const { editor, tab } = await openEditor([saved])
    tab('Portada').click()
    await vi.waitFor(() => expect(editor.querySelector('.ihr-relief__status').textContent).toMatch(/No se pudo analizar/))
    const none = editor.querySelector('.ihr-relief-none')
    expect(none.hidden).toBe(false)
  })
})

describe('balanceo del libro tras elegir', () => {
  async function ready() {
    const context = await openEditor()
    context.tab('Portada').click()
    await vi.waitFor(() => expect(context.editor.querySelectorAll('.ihr-relief-card:not(.is-skeleton)')).toHaveLength(3))
    context.cards = [...context.editor.querySelectorAll('.ihr-relief-card input')]
    return context
  }
  const choose = input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })) }
  const tiltOf = view => view.animations.find(motion => motion.timing.duration === 2400)

  it('oscila en guiñada y cabeceo unas tres veces alrededor de la pose de portada', async () => {
    const { view, cards } = await ready()
    choose(cards[0])
    await vi.waitFor(() => expect(tiltOf(view)).toBeTruthy())
    const { frames } = tiltOf(view)
    const yaw = frames.map(frame => frame.transform.angle)
    expect(Math.max(...yaw)).toBeGreaterThan(11)
    expect(Math.min(...yaw)).toBeLessThan(-11)
    expect(Math.max(...frames.map(frame => Math.abs(frame.transform.pitch)))).toBeGreaterThan(6)
    expect(frames[0].transform.angle).toBe(0)
    expect(frames.at(-1).transform.angle).toBe(0)
    const cover = view.animations.find(motion => motion.timing.duration === 300).frames.at(-1).transform
    expect(frames[0].transform).toEqual(cover)
  })

  it('un gesto del usuario corta el balanceo y devuelve la portada a su sitio', async () => {
    const { view, cards } = await ready()
    choose(cards[0])
    await vi.waitFor(() => expect(tiltOf(view)).toBeTruthy())
    const count = view.animations.length
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(view.animations.length).toBe(count + 1)
    const easeBack = view.animations.at(-1)
    expect(easeBack.timing.duration).toBeLessThan(400)
    expect(easeBack.frames.at(-1).transform.angle).toBe(0)
    expect(easeBack.frames.at(-1).transform.pitch).toBe(0)
    // Una vez cortado, otro gesto ya no vuelve a mandar nada.
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(view.animations.length).toBe(count + 1)
  })

  it('una tecla también corta el balanceo', async () => {
    const { view, cards } = await ready()
    choose(cards[2])
    await vi.waitFor(() => expect(tiltOf(view)).toBeTruthy())
    const count = view.animations.length
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
    expect(view.animations.length).toBe(count + 1)
  })

  it('al elegir otra tarjeta se repite y elegir con teclado rápido no acumula balanceos', async () => {
    const { view, cards } = await ready()
    choose(cards[0]); choose(cards[1]); choose(cards[2])
    await vi.waitFor(() => expect(view.animations.filter(motion => motion.timing.duration === 2400)).toHaveLength(1))
    await flush(300)
    expect(view.animations.filter(motion => motion.timing.duration === 2400)).toHaveLength(1)
    choose(cards[0])
    await vi.waitFor(() => expect(view.animations.filter(motion => motion.timing.duration === 2400)).toHaveLength(2))
  })

  it('no se repite al reabrir el editor ni al volver a la pestaña', async () => {
    const { view, cards, tab } = await ready()
    choose(cards[0])
    await vi.waitFor(() => expect(tiltOf(view)).toBeTruthy())
    tab('Lomo').click()
    tab('Portada').click()
    await flush(300)
    expect(view.animations.filter(motion => motion.timing.duration === 2400)).toHaveLength(1)
  })

  it('cambiar de pestaña antes de que arranque cancela el balanceo pendiente', async () => {
    const { view, cards, tab } = await ready()
    choose(cards[0])
    tab('Lomo').click()
    await flush(300)
    expect(tiltOf(view)).toBeUndefined()
  })

  it('con movimiento reducido no se balancea (el relieve se aprecia igual en reposo)', async () => {
    reduceMotion(true)
    const { view, cards } = await ready()
    choose(cards[0])
    await flush(300)
    expect(view.setCoverRelief).toHaveBeenCalled()
    expect(tiltOf(view)).toBeUndefined()
  })
})
