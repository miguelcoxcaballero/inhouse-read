import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'

const views = vi.hoisted(() => [])
vi.mock('../../src/js/book-model.js', () => ({
  getBookRenderer:() => null,
  planReadingBookPose:() => ({ x:0, y:0, scale:1, angle:0, pitch:0 }),
  bookView(host) {
    const canvas = document.createElement('canvas'); host.append(canvas)
    canvas.dataset.renderer = 'three-mesh'
    let pose = { x:0, y:0, scale:1, angle:0, pageTheme:1 }, snapshot
    const done = () => ({ finished:Promise.resolve(), cancel() {} })
    const view = {
      canvas, ready:Promise.resolve(),
      draw:vi.fn(next => { pose = { ...pose, ...next, pageTheme:next.pageTheme ?? pose.pageTheme }; canvas.dataset.pageTheme = String(pose.pageTheme) }),
      getPose:() => ({ ...pose }), getPageTheme:() => pose.pageTheme,
      hasPageSnapshot:next => snapshot === next,
      setPageSnapshot:vi.fn((next, { pageTheme = 1, redraw = true } = {}) => {
        snapshot = next; pose.pageTheme = pageTheme
        if (redraw) view.draw(pose)
        return true
      }),
      setPageTheme:mix => view.draw({ ...pose, pageTheme:mix }),
      animate:frames => { view.draw({ ...pose, ...frames.at(-1).transform }); return done() },
      animateCoverOpen:vi.fn(() => { view.draw({ ...pose, coverOpen:1 }); return done() }),
      animateBookmark:done,
      pageTextures:() => [], compilePage() {}, uploadPageTexture() {}, dispose() {}
    }
    view.draw(pose); views.push(view)
    return view
  }
}))

let shelf
afterEach(() => { shelf?.destroy(); shelf = null; document.body.innerHTML = ''; views.length = 0; vi.unstubAllGlobals() })

describe('opening a page whose idle warm-up was interrupted', () => {
  it('draws the already installed white page before announcing the opening phase', async () => {
    vi.stubGlobal('matchMedia', query => ({ matches:/reduce/.test(query), addEventListener() {}, removeEventListener() {} }))
    const container = document.createElement('div'); document.body.append(container)
    const book = { id:'opening-paper', title:'Night PDF', format:'PDF' }
    const snapshot = { source:document.createElement('canvas'), paper:{ source:document.createElement('canvas') } }
    let observed
    const onOpenBook = vi.fn(async (_book, context) => {
      const view = views.at(-1)
      view.animateCoverOpen.mockImplementationOnce(() => {
        observed = { phase:document.querySelector('.ihr-flyout').dataset.openingPhase, theme:canvasTheme(view) }
        return { finished:Promise.resolve(), cancel() {} }
      })
      return context.finish({ pageSnapshot:snapshot })
    })
    shelf = renderBookshelf(container, [book], { shelfWidth:390, revealDuration:0, holdMs:0, autoOpen:true, onOpenBook })
    container.querySelector('.ihr-spine').click()
    await vi.waitFor(() => expect(document.querySelector('.ihr-flyout__cover-target.is-ready')).toBeTruthy())
    const view = views.at(-1)
    let releaseIdle
    const warming = shelf.prepareOpeningPage(book.id, snapshot, () => new Promise(resolve => { releaseIdle = resolve }))
    await vi.waitFor(() => expect(releaseIdle).toBeTypeOf('function'))
    expect(view.hasPageSnapshot(snapshot)).toBe(true)
    expect(view.getPageTheme()).toBe(0)
    expect(canvasTheme(view)).toBe(1) // installed while hidden, not drawn yet
    document.querySelector('.ihr-flyout__cover-target').click()
    await vi.waitFor(() => expect(observed).toEqual({ phase:'opening', theme:0 }))
    expect(view.setPageSnapshot).toHaveBeenCalledTimes(1) // no duplicate textures
    releaseIdle()
    await expect(warming).resolves.toBe(false)
    await vi.waitFor(() => expect(document.querySelector('.ihr-flyout')).toBeNull())
  })
})

function canvasTheme(view) { return Number(view.canvas.dataset.pageTheme) }
