/**
 * The shelf screen against its frozen JavaScript original. Both play the same scripted sessions on the same
 * doubles (book model, relief analysis, cover analysis); every call the screen makes on its host, every callback
 * it fires and the whole document after each step must be identical. The original lives in
 * helpers/reference-bookshelf.js; the production screen runs its flyout editor in the shelf module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf as production } from '../../src/js/bookshelf.js'
import { renderBookshelf as frozen } from './helpers/reference-bookshelf.js'
import { analyzeCoverRelief } from '../../src/js/cover-relief.js'
import { click, fire, firstDifference, flush, keydown, play, q, qa, recordingView, setValue, show } from './helpers/shelf-differential.js'

const state = vi.hoisted(() => ({ log: [], views: [] }))

vi.mock('../../src/js/book-model.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  return {
    getBookRenderer: () => null,
    planReadingBookPose: () => ({ x: 0, y: 0, scale: 1, angle: 0, pitch: 0, coverOpen: 1 }),
    fitCoverImage: (w, h) => ({ x: 0, y: 0, width: w, height: h }),
    bookView(host, book, style, dimensions) {
      const view = helper.recordingView(state.log, host, book, style, dimensions)
      state.views.push(view)
      state.log.push(`bookView(${helper.show(book.id)},${helper.show(style)},${helper.show(dimensions)})`)
      return view
    }
  }
})
vi.mock('../../src/js/cover-relief.js', async importOriginal => ({ ...await importOriginal(), analyzeCoverRelief: vi.fn(), buildReliefMaps: vi.fn() }))
vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(),
  readCoverAspectRatio: vi.fn(async () => 0.66),
  analyzeCoverAppearance: vi.fn(async () => null)
}))

const PROPOSALS = [
  { id: 'color-1', color: '#d4a93c', tolerance: 5, label: 'Color #d4a93c', description: 'Zonas amarillas de la portada.', strength: 0.75, thumbnail: 'data:image/png;base64,AAAA' },
  { id: 'color-2', color: '#2350b5', tolerance: 4, label: 'Color #2350b5', description: 'Zonas azules de la portada.', strength: 0.6, thumbnail: 'data:image/png;base64,BBBB' },
  { id: 'color-3', color: '#fffaf0', tolerance: 3, label: 'Color #fffaf0', description: 'Zonas claras de la portada.', strength: 0.5, thumbnail: '' }
]

let container, shelf
beforeEach(() => {
  state.log.length = 0; state.views.length = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  localStorage.clear()
  vi.stubGlobal('matchMedia', query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  vi.mocked(analyzeCoverRelief).mockReset()
  vi.mocked(analyzeCoverRelief).mockImplementation(async () => ({ proposals: PROPOSALS, analysis: {} }))
})
afterEach(() => {
  shelf?.destroy(); shelf = null
  container?.remove(); container = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const mount = (render, books, extra = {}) => {
  container = document.createElement('div')
  document.body.append(container)
  const callbacks = ['onBookCustomizationChange', 'onBookDismiss', 'onPrepareBook', 'onBookOrderChange', 'onShelfPlacementChange']
  const options = { shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, autoOpen: true, coverSrcFor: () => 'blob:cover', ...extra }
  for (const name of callbacks) options[name] ??= (...args) => { state.log.push(`${name}(${args.map(arg => show(arg)).join(',')})`); return Promise.resolve() }
  shelf = render(container, books, options)
  return shelf
}
const book = (extra = {}) => ({
  id: 'local:diff:1', title: 'La sombra del viento', author: 'Carlos Ruiz Zafón', format: 'EPUB', sourceType: 'local',
  addedAt: 1, lastOpenedAt: 1, progressFraction: 0.3, cover: new Blob(['x'], { type: 'image/jpeg' }), ...extra
})
const ready = async () => { await vi.waitFor(() => expect(q('.ihr-flyout__cover-target.is-ready')).not.toBeNull()) }
const field = label => q(`[aria-label="${label}"]`, q('.ihr-spine-editor'))
const tab = name => qa('[role="tab"]').find(item => item.textContent === name)

/** The spine editor: open, every control, the cover tab with its relief cards, close. */
const editorScript = () => [
  ['open the flyout', async () => { q('.ihr-spine').click(); await ready() }],
  ['open the editor', async () => { const edit = q('.ihr-flyout__edit-button'); await vi.waitFor(() => expect(edit.disabled).toBe(false)); click(edit) }],
  ['font family', () => setValue(field('Fuente del lomo'), 'Lora', 'change')],
  ['title size', () => setValue(field('Tamaño del título del lomo'), '22')],
  ['author size', () => setValue(field('Tamaño del autor del lomo'), '9')],
  ['spine text', () => setValue(field('Texto del lomo'), 'Mi título')],
  ['author', () => setValue(field('Autor del libro'), '  Otra  Autora ')],
  ['second swatch', () => click(qa('.ihr-flyout__swatch')[1])],
  ['third swatch', () => click(qa('.ihr-flyout__swatch')[2])],
  ['custom colour', () => setValue(field('Elegir otro color para el lomo'), '#336699', 'change')],
  ['gold binding', () => setValue(field('Acabado del lomo'), 'gold', 'change')],
  ['silver ink finish', () => setValue(field('Acabado del texto'), 'silver', 'change')],
  ['ink colour', () => setValue(field('Color del texto'), '#112233', 'change')],
  ['engraved', () => { const box = field('Texto grabado'); box.checked = true; fire(box, 'change') }],
  ['gloss of the cover', () => setValue(field('Brillo de la portada'), 'glossy', 'change')],
  ['gloss of the edge', () => setValue(field('Brillo del canto'), 'matte', 'change')],
  ['gloss of the spine', () => setValue(field('Brillo del lomo'), 'satin', 'change')],
  ['material sample', () => click(qa('.ihr-spine-editor__material[data-value="glossy"]')[2])],
  ['auto ink', () => click(q('.ihr-spine-editor__auto'))],
  ['cover tab', () => click(tab('Portada'))],
  ['relief cards', async () => { await vi.waitFor(() => expect(qa('.ihr-relief-card:not(.is-skeleton)').length).toBe(3)) }],
  ['first relief', () => { const input = qa('.ihr-relief__input')[0]; input.checked = true; fire(input, 'change') }],
  ['second relief', () => { const input = qa('.ihr-relief__input')[1]; input.checked = true; fire(input, 'change') }],
  ['intensity', () => setValue(field('Intensidad del relieve'), '40')],
  ['adjust colour', () => setValue(field('Color del relieve a ajustar'), '#d4a93c', 'change')],
  ['uncheck first', () => { const input = qa('.ihr-relief__input')[0]; input.checked = false; fire(input, 'change') }],
  ['no relief', () => click(q('.ihr-relief-none'))],
  ['spine tab by keyboard', () => keydown(tab('Portada'), 'Home')],
  ['done', () => click(q('.ihr-spine-editor__done'))],
  ['reopen', () => click(q('.ihr-flyout__edit-button'))],
  ['escape closes the editor', () => keydown(document.body, 'Escape')],
  ['escape closes the flyout', () => keydown(document.body, 'Escape')]
]

async function session(render, script, makeBooks = () => [book()], extra = {}) {
  document.body.innerHTML = ""; state.views.length = 0
  mount(render, makeBooks(), extra)
  await flush(10)
  const log = await play(state.log, script(), { settle: 200 })
  shelf.destroy(); shelf = null
  return [...log]
}

describe('the lifted book\'s editor against the frozen original', () => {
  it('plays the whole editor script identically', async () => {
    const expected = await session(frozen, editorScript)
    state.log.length = 0; state.views.length = 0; document.body.innerHTML = ''
    const actual = await session(production, editorScript)
    expect(firstDifference(expected, actual)).toBeNull()
    // A script that never saved, previewed or animated would certify nothing.
    const text = expected.join('\n')
    expect(text).toContain('onBookCustomizationChange')
    expect(text).toContain('view.setCoverRelief')
    expect(text).toContain('view.updateEditorAppearance')
    expect(expected.length).toBeGreaterThan(60)
  }, 60_000)

  it('plays it identically for a book without cover, author or progress and for a customised one', async () => {
    const bare = () => [book({ id: 'bare', author: undefined, cover: undefined, progressFraction: 0, title: 'Sin portada' })]
    const dressed = () => [book({ id: 'dressed', spineColorOverride: '#884422', spineFinish: 'gold', spineTextFinish: 'silver', spineTextColor: '#abcdef',
      spineFontFamily: 'Oswald', spineFontSize: 30, spineAuthorFontSize: 14, spineEngraved: true, coverFinish: 'glossy', pageEdgeFinish: 'matte',
      spineSurfaceFinish: 'satin', spineTitleOverride: 'Título a medida', coverRelief: { id: 'color-2', color: '#2350b5', tolerance: 4, strength: 0.6 } })]
    for (const books of [bare, dressed]) {
      const options = books === bare ? { coverSrcFor: () => null } : {}
      state.log.length = 0
      const expected = await session(frozen, editorScript, books, options)
      state.log.length = 0; state.views.length = 0; document.body.innerHTML = ''
      const actual = await session(production, editorScript, books, options)
      expect(firstDifference(expected, actual)).toBeNull()
    }
  }, 60_000)

  it('plays the dropper identically, including a cover that cannot be read', async () => {
    const droppers = () => [
      ['open the flyout', async () => { q('.ihr-spine').click(); await ready() }],
      ['open the editor', async () => { const edit = q('.ihr-flyout__edit-button'); await vi.waitFor(() => expect(edit.disabled).toBe(false)); click(edit) }],
      ['pipette', async () => { click(q('.ihr-spine-editor__pipette')); await flush(50) }],
      ['cancel', () => click(q('.ihr-color-pick__cancel'))],
      ['pipette again', async () => { click(q('.ihr-spine-editor__pipette')); await flush(50) }],
      ['escape', () => keydown(document.body, 'Escape')]
    ]
    const expected = await session(frozen, droppers)
    state.log.length = 0; state.views.length = 0; document.body.innerHTML = ''
    const actual = await session(production, droppers)
    expect(firstDifference(expected, actual)).toBeNull()
  }, 60_000)
})
