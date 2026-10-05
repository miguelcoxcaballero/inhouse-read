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
      updateEditorAppearance: vi.fn(),
      prepareCoverRelief: vi.fn(async () => true),
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
  { id:'color-1', color:'#d4a93c', tolerance:5, label:'Color #d4a93c', description:'Zonas amarillas de la portada.', strength:.75, thumbnail:'data:image/png;base64,AAAA' },
  { id:'color-2', color:'#2350b5', tolerance:4, label:'Color #2350b5', description:'Zonas azules de la portada.', strength:.6, thumbnail:'data:image/png;base64,BBBB' },
  { id:'color-3', color:'#fffaf0', tolerance:3, label:'Color #fffaf0', description:'Zonas claras de la portada.', strength:.5, thumbnail:'data:image/png;base64,CCCC' }
]
const selected = (index, strength = PROPOSALS[index].strength) => {
  const { id, color, tolerance } = PROPOSALS[index]
  return { id, color, tolerance, strength }
}
const selectedLayers = (...layers) => ({ layers })
const adjustColor = editor => editor.querySelector('select[aria-label="Color del relieve a ajustar"]')

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
  vi.useRealTimers()
  shelf = null
  container?.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})


describe('editor callers opt into one conservative material batch',() => {
  it('batches each title input synchronously and retains the exact 90ms spine and 180ms save deadlines',async () => {
    const {editor,view,onBookCustomizationChange}=await openEditor();
    view.updateSpineAppearance=vi.fn();view.updateEdgeAppearance=vi.fn();
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    const input=editor.querySelector('input[aria-label="Texto del lomo"]');
    input.value='Latest title';input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(view.updateEditorAppearance).toHaveBeenCalledOnce();
    expect(view.updateEditorAppearance).toHaveBeenCalledWith(expect.objectContaining({spineTitleOverride:'Latest title'}));
    expect(view.updateCoverAppearance).not.toHaveBeenCalled();expect(view.updateEdgeAppearance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(89);expect(view.updateSpineAppearance).not.toHaveBeenCalled();expect(onBookCustomizationChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(view.updateSpineAppearance).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(89);expect(onBookCustomizationChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(onBookCustomizationChange).toHaveBeenCalledOnce();
    expect(onBookCustomizationChange.mock.calls[0][1]).toEqual({spineTitleOverride:'Latest title'});
  });
  it('passes the complete current record for cover and edge controls instead of choosing by explicit patch fields',async () => {
    const {editor,view}=await openEditor();view.updateEdgeAppearance=vi.fn();
    const cover=editor.querySelector('select[aria-label="Brillo de la portada"]');
    cover.value='glossy';cover.dispatchEvent(new Event('change',{bubbles:true}));
    const edge=editor.querySelector('select[aria-label="Brillo del canto"]');
    edge.value='matte';edge.dispatchEvent(new Event('change',{bubbles:true}));
    expect(view.updateEditorAppearance).toHaveBeenCalledTimes(2);
    expect(view.updateEditorAppearance.mock.calls[1][0]).toMatchObject({coverFinish:'glossy',pageEdgeFinish:'matte'});
    expect(view.updateCoverAppearance).not.toHaveBeenCalled();expect(view.updateEdgeAppearance).not.toHaveBeenCalled();
  });
  it('retains the original two-call fallback for a view that does not expose the new optional batch',async () => {
    const {editor,view}=await openEditor();delete view.updateEditorAppearance;view.updateEdgeAppearance=vi.fn();
    const input=editor.querySelector('input[aria-label="Texto del lomo"]');
    input.value='Fallback title';input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(view.updateCoverAppearance).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({spineTitleOverride:'Fallback title'}));
    expect(view.updateEdgeAppearance).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({spineTitleOverride:'Fallback title'}));
  });
  it('keeps pure relief customization on its existing setCoverRelief path without a material batch',async () => {
    const {editor,view,tab}=await openEditor();view.updateEdgeAppearance=vi.fn();
    tab('Portada').click();
    const card=await vi.waitFor(()=>{const node=editor.querySelector('.ihr-relief__input');expect(node?.disabled).toBe(false);return node;});
    card.checked=true;card.dispatchEvent(new Event('change',{bubbles:true}));await flush(5);
    expect(view.setCoverRelief).toHaveBeenCalled();expect(view.updateEditorAppearance).not.toHaveBeenCalled();
    expect(view.updateCoverAppearance).not.toHaveBeenCalled();expect(view.updateEdgeAppearance).not.toHaveBeenCalled();
  });
  it('preserves the immediate latest-spine commit and original 220ms Done animation before the preview deadline',async () => {
    const {editor,view,onBookCustomizationChange}=await openEditor();view.updateAppearance=vi.fn();view.updateSpineAppearance=vi.fn();
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    const font=editor.querySelector('select[aria-label="Fuente del lomo"]');
    font.value=font.options[1].value;font.dispatchEvent(new Event('change',{bubbles:true}));
    expect(view.updateEditorAppearance).toHaveBeenCalledOnce();editor.querySelector('.ihr-spine-editor__done').click();
    expect(view.updateAppearance).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({fontFamily:font.value}),{reuseModel:true});
    expect(view.animations.at(-1).timing.duration).toBe(220);expect(onBookCustomizationChange).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(110);expect(view.updateSpineAppearance).not.toHaveBeenCalled();
  });
});
