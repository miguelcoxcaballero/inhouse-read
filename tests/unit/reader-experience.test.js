import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderExperience } from '../../src/js/readers/reader-experience.js'

vi.mock('../../src/js/readers/reading-voice.js', () => ({
  ReadingVoice:class { state = 'stopped'; stop = vi.fn() }
}))

const place = (value, fraction) => ({ locator:{ kind:'cfi', value }, fraction })
const quiet = place('epubcfi(/6/2)', .1)
const beyond = place('epubcfi(/6/4)', .6)
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = '<section id="reader-screen"><div id="reader-toolbar"></div></section>'
  for (const id of ['reader-location', 'reader-settings', 'reader-audio', 'reader-save-bookmark',
    'reader-rotate', 'reader-search-shortcut', 'reader-toc-shortcut', 'reader-more-shortcut',
    'reader-top-title', 'reader-top-byline']) {
    const button = document.createElement('button')
    button.id = id
    if (id === 'reader-location') button.innerHTML = '<span class="reader-location-label"></span>'
    document.getElementById('reader-screen').append(button)
  }
})
afterEach(() => { document.body.innerHTML = '' })

async function setup(persist = vi.fn(async () => {})) {
  const reader = {
    location:{ ...beyond }, format:{ engine:'foliate' }, toc:[], pageCount:null,
    applyPreferences:vi.fn(async () => {}), addQuoteAnnotation:vi.fn(), getSelection:vi.fn(),
    next:vi.fn(async () => {}), prev:vi.fn(async () => {})
  }
  const experience = new ReaderExperience(reader, { persist })
  experience.panel.close = vi.fn()
  reader.goToLocator = vi.fn(async (locator, fraction) => {
    reader.location = { locator, fraction }
    experience.relocate()
  })
  reader.goToTarget = vi.fn(async () => {
    reader.location = { ...beyond }
    experience.relocate()
  })
  await experience.open({ id:'book-a', title:'Book A', readingHistory:[quiet] })
  return { reader, experience, persist }
}

describe('reader navigation during asynchronous history writes', () => {
  it('keeps an internal link tapped after the previous section appears but before its history is saved', async () => {
    const saved = deferred()
    const persist = vi.fn().mockImplementationOnce(() => saved.promise).mockResolvedValue(undefined)
    const { experience, reader } = await setup(persist)
    const returning = experience.returnToReading()
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    expect(experience.location.locator).toEqual(quiet.locator)

    const following = experience.jump(null, 'beyond.xhtml')
    expect(reader.goToTarget).not.toHaveBeenCalled()
    saved.resolve()
    await Promise.all([returning, following])

    expect(reader.goToTarget).toHaveBeenCalledWith('beyond.xhtml')
    expect(experience.location.locator).toEqual(beyond.locator)
    expect(experience.history[0].locator).toEqual(quiet.locator)
  })

  it.each(['reset', 'open'])('drops queued old-book links after %s without holding up the new book', async action => {
    const saved = deferred()
    const persist = vi.fn().mockImplementationOnce(() => saved.promise).mockResolvedValue(undefined)
    const { experience, reader } = await setup(persist)
    const returning = experience.returnToReading()
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    const obsolete = experience.jump(null, 'old-book-link.xhtml')
    if (action === 'reset') experience.reset()
    await experience.open({ id:'book-b', title:'Book B', readingHistory:[] })
    await experience.jump(null, 'new-book-link.xhtml')
    saved.resolve()
    await Promise.all([returning, obsolete])

    expect(reader.goToTarget.mock.calls).toEqual([['new-book-link.xhtml']])
    expect(experience.book.id).toBe('book-b')
    expect(experience.navigating).toBe(false)
    expect(persist.mock.calls.map(([id]) => id)).toEqual(['book-a', 'book-b'])
  })

  it('lets a subsequent jump run after a page turn fails', async () => {
    const { experience, reader } = await setup()
    reader.next.mockRejectedValueOnce(new Error('page unavailable'))
    const turn = experience.step(1)
    const jump = experience.jump(null, 'next-section.xhtml')
    await expect(turn).rejects.toThrow('page unavailable')
    await jump
    expect(reader.goToTarget).toHaveBeenCalledWith('next-section.xhtml')
    expect(experience.navigating).toBe(false)
  })
})
