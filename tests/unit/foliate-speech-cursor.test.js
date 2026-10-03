import { afterEach, describe, expect, it, vi } from 'vitest'
import * as CFI from 'foliate-js/epubcfi.js'
import { FoliateSpeechCursor } from '../../src/js/readers/foliate-speech-cursor.js'
import { mapSpeechText } from '../../src/js/readers/speech-map.js'

const parse = text => new DOMParser().parseFromString(`<html><head></head><body>${text}</body></html>`, 'text/html')
const pending = () => { let resolve; const promise = new Promise(finish => { resolve = finish }); return {promise,resolve} }
const cursors = []
afterEach(() => { for (const cursor of cursors.splice(0)) cursor.close(); vi.restoreAllMocks() })
function setup(markup = ['<p>Chapter one.</p>', '<p>Chapter two. Another sentence.</p>', '<p>Chapter three.</p>']) {
  const env = new EventTarget(); env.hidden = true
  const docs = markup.map(parse)
  const sections = docs.map(doc => ({ size:100, createDocument:vi.fn(async () => doc) }))
  const live = parse(markup[0])
  const view = { book:{sections}, lastLocation:{section:{current:0}},
    renderer:{getContents:() => [{index:0,doc:live}]}, goTo:vi.fn(async () => {}),
    getCFI:(index, range) => CFI.joinIndir(CFI.fake.fromIndex(index), CFI.fromRange(range)),
    resolveCFI:cfi => {
      const parts = CFI.parse(cfi); (parts.parent ?? parts).shift()
      return {anchor:doc => CFI.toRange(doc, parts)}
    } }
  const onRelocate = vi.fn(), cursor = new FoliateSpeechCursor(view, {env,onRelocate})
  cursors.push(cursor)
  return {env,view,docs,sections,live,onRelocate,cursor}
}
async function adopt(cursor) {
  const source = await cursor.next()
  expect(source.activate()).toBe(true)
  source.highlight(0,Math.min(source.text.length,10))
  source.follow(0,Math.min(source.text.length,10))
  return source
}

describe('detached Foliate chapters use the real file text while the screen is off', () => {
  it('prepares a chapter without navigating, rendering, waiting for a load event or allocating any timer', async () => {
    const h = setup(), timer = vi.spyOn(globalThis,'setTimeout')
    const source = await h.cursor.next()
    expect(source.text).toBe('Chapter two. Another sentence.')
    expect(h.sections[1].createDocument).toHaveBeenCalledOnce()
    expect(h.view.goTo).not.toHaveBeenCalled()
    expect(h.onRelocate).not.toHaveBeenCalled()
    expect(timer).not.toHaveBeenCalled()
    expect(source.activate()).toBe(true)
    source.follow(13,source.text.length)
    expect(h.onRelocate).toHaveBeenCalledOnce()
    expect(h.onRelocate.mock.calls[0][0].index).toBe(1)
    expect(h.view.goTo).not.toHaveBeenCalled()
  })
  it('advances across several chapters independently of the unchanged visible iframe', async () => {
    const h = setup()
    expect((await adopt(h.cursor)).text).toContain('Chapter two')
    expect((await adopt(h.cursor)).text).toContain('Chapter three')
    expect(await h.cursor.next()).toBeNull()
    expect(h.view.lastLocation.section.current).toBe(0)
    expect(h.onRelocate.mock.calls.map(([value]) => value.index)).toEqual([1,2])
    expect(h.view.goTo).not.toHaveBeenCalled()
  })
  it('keeps actual CFI offsets and resumes from the last audible fragment rather than the old visible page', async () => {
    const h = setup(), source = await adopt(h.cursor)
    const start = source.text.indexOf('Another')
    source.follow(start,source.text.length)
    const saved = h.onRelocate.mock.calls.at(-1)[0]
    const range = h.view.resolveCFI(saved.cfi).anchor(h.docs[1])
    expect(range.startContainer.nodeValue.slice(range.startOffset)).toBe('Another sentence.')
    expect(h.cursor.currentSource().start).toBe(start)
    expect(saved.fraction).toBeGreaterThan(1/3)
    expect(saved.fraction).toBeLessThan(2/3)
  })
  it('skips non-linear and empty chapters but never returns an invented generic page', async () => {
    const h = setup(['<p>Start.</p>','<p>Not in the spine.</p>','<img src="cover.jpg">','<p>Real next chapter.</p>'])
    h.sections[1].linear = 'no'
    const source = await adopt(h.cursor)
    expect(source.text).toBe('Real next chapter.')
    expect(h.sections[1].createDocument).not.toHaveBeenCalled()
    expect(h.onRelocate.mock.calls[0][0].index).toBe(3)
  })
  it('retains the visible paginator and fixed-layout reader paths', async () => {
    const h = setup(); h.env.hidden = false
    expect(await h.cursor.next()).toBeUndefined()
    h.env.hidden = true; h.view.book.rendition = {layout:'pre-paginated'}
    expect(await h.cursor.next()).toBeUndefined()
    expect(h.sections[1].createDocument).not.toHaveBeenCalled()
  })
  it('rejects cancellation after the detached parser resolves and cannot activate its old text', async () => {
    const h = setup(), parsing = pending(); let active = true
    h.sections[1].createDocument = () => parsing.promise
    const preparation = h.cursor.next({isActive:() => active})
    active = false; parsing.resolve(h.docs[1])
    await expect(preparation).rejects.toMatchObject({name:'AbortError'})
    expect(h.onRelocate).not.toHaveBeenCalled()
    expect(h.view.goTo).not.toHaveBeenCalled()
  })
  it('rejects a prepared chapter when manual navigation resets the cursor', async () => {
    const h = setup(), source = await h.cursor.next()
    h.cursor.reset()
    expect(source.isValid()).toBe(false)
    expect(source.activate()).toBe(false)
    expect(h.onRelocate).not.toHaveBeenCalled()
  })
  it('does not treat a parser failure as end of book', async () => {
    const h = setup()
    h.sections[1].createDocument = async () => { throw new Error('Unreadable chapter') }
    await expect(h.cursor.next()).rejects.toThrow('Unreadable chapter')
  })
  it('reveals the exact latest CFI on return and leaves synthesis independent of a pending visual navigation', async () => {
    const h = setup(), source = await adopt(h.cursor), rendering = pending()
    h.view.goTo.mockImplementationOnce(() => rendering.promise)
    h.env.hidden = false; h.env.dispatchEvent(new Event('visibilitychange'))
    expect(h.view.goTo).toHaveBeenCalledOnce()
    source.follow(13,source.text.length)
    expect(h.onRelocate.mock.calls.at(-1)[0].cfi).not.toBe(h.view.goTo.mock.calls[0][0])
    expect(source.isValid()).toBe(true)
    rendering.resolve(); await h.cursor.revealing
    expect(h.view.goTo).toHaveBeenCalledTimes(2)
    expect(h.view.goTo.mock.calls.at(-1)[0]).toBe(h.onRelocate.mock.calls.at(-1)[0].cfi)
  })
  it('does not replay a canceled visual catch-up when its earlier navigation settles', async () => {
    const h = setup(), rendering = pending()
    await adopt(h.cursor); h.env.hidden = false
    h.view.goTo.mockImplementationOnce(() => rendering.promise)
    const reveal = h.cursor.reveal()
    h.cursor.reset(); rendering.resolve(); await reveal
    expect(h.view.goTo).toHaveBeenCalledOnce()
    expect(h.cursor.currentSource()).toBeNull()
  })
  it('retains ordinary page-boundary following when visible and uses actual text CFI when hidden', async () => {
    const h = setup(), map = mapSpeechText(h.live.body), follow = vi.fn(), highlight = vi.fn(), clear = vi.fn()
    const source = h.cursor.wrap({text:map.text,start:0,follow,highlight,clear},map,0)
    h.env.hidden = false; source.highlight(0,7); source.follow(0,7)
    expect(follow).toHaveBeenCalledOnce(); expect(highlight).toHaveBeenCalledOnce()
    h.env.hidden = true; source.highlight(0,7); source.follow(0,7)
    expect(follow).toHaveBeenCalledOnce(); expect(highlight).toHaveBeenCalledOnce()
    expect(h.onRelocate.mock.calls.at(-1)[0].index).toBe(0)
    source.clear(); expect(clear).toHaveBeenCalledOnce()
  })
  it('releases its visibility listener and rejects late extraction after the book closes', async () => {
    const h = setup(), parsing = pending(), remove = vi.spyOn(h.env,'removeEventListener')
    h.sections[1].createDocument = () => parsing.promise
    const preparation = h.cursor.next()
    h.cursor.close(); parsing.resolve(h.docs[1])
    await expect(preparation).rejects.toMatchObject({name:'AbortError'})
    expect(remove).toHaveBeenCalledWith('visibilitychange',h.cursor.onVisibility)
    h.env.hidden = false; h.env.dispatchEvent(new Event('visibilitychange'))
    expect(h.view.goTo).not.toHaveBeenCalled()
  })
})
