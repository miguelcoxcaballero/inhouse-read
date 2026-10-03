import { expect, test } from '@playwright/test'
import { fakeEngineScript } from '../helpers/fake-neural-engine.js'

const EPUB = 'tests/e2e/fixtures/reading-journey.epub'
const compact = value => String(value).replace(/\s+/g, '')

// Native Foliate pagination, DOM mapping, sentence planning, follow turns,
// reader controller and playback lifecycle. Only synthesis/audio is controlled:
// completion can precede the real animated paginator's lock release.
test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.addInitScript(fakeEngineScript({ installed:['piper:en_US-lessac-high'], hold:true }))
})

async function openAndPlay(page) {
  await page.goto('./')
  await page.locator('#file-picker').setInputFiles(EPUB)
  await expect(page.locator('foliate-view')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body)), {timeout:30_000}).toBe(true)
  await page.getByRole('button', { name:'Escuchar el libro' }).click()
  await page.evaluate(() => {
    const view = document.querySelector('foliate-view'), renderer = view.renderer
    const doc = renderer.getContents()[0].doc
    const engine = window.__inhouseNeuralTest.engine
    const evidence = window.__chapterContinuity = {
      expected:[...doc.body.querySelectorAll('h1,p')].map(element => element.textContent.trim() + (element.localName === 'h1' ? '.' : '')).join(' '),
      animated:renderer.hasAttribute('animated'), initialPages:renderer.pages,
      started:[], done:[], nativeTurns:[], relocations:[], stops:0, activeTurns:0
    }
    const next = renderer.next.bind(renderer)
    renderer.next = async (...args) => {
      const entry = { startedAt:performance.now(), beforeIndex:view.lastLocation?.index, beforePage:renderer.page }
      evidence.nativeTurns.push(entry); evidence.activeTurns++
      try { return await next(...args) }
      finally {
        entry.finishedAt = performance.now(); entry.afterIndex = view.lastLocation?.index; entry.afterPage = renderer.page
        evidence.activeTurns--
      }
    }
    view.addEventListener('relocate', event => evidence.relocations.push({ at:performance.now(), index:event.detail.index, heading:renderer.getContents()[0]?.doc?.querySelector('h1')?.textContent }))
    const emit = engine.emit.bind(engine), stop = engine.stop.bind(engine)
    engine.emit = (type, id, reason) => {
      const call = engine.calls.find(call => call.id === id)
      if (type === 'start') evidence.started.push({id,text:call?.text,at:performance.now()})
      if (type === 'done') evidence.done.push({id,text:call?.text,at:performance.now()})
      return emit(type,id,reason)
    }
    engine.stop = () => { evidence.stops++; return stop() }
  })
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await page.getByRole('button', { name:'Cerrar opciones de lectura' }).click()
  await expect(page.getByRole('button', { name:'Pausar lectura', exact:true })).toBeVisible()
}

async function completeFirstChapter(page, cancel = '') {
  return page.evaluate(async action => {
    const engine = window.__inhouseNeuralTest.engine, evidence = window.__chapterContinuity
    const sleep = ms => new Promise(resolve => setTimeout(resolve,ms))
    for (let fragment = 0; fragment < 2000; fragment++) {
      const call = engine.current
      if (!call) throw new Error('Natural playback stopped before the next chapter')
      if (call.text.startsWith('Beyond the window')) return { reachedNext:true, calls:engine.calls.length }
      engine.emit('start',call.id)
      // Fast deterministic fragments expose a final follow still in flight;
      // the paginator itself retains its native animation and lock behavior.
      await sleep(2)
      if (action && !call.upcoming.length) {
        for (let attempt = 0; attempt < 40 && !evidence.activeTurns; attempt++) await sleep(5)
        if (!evidence.activeTurns) throw new Error('Fixture did not exercise an in-flight native follow at the chapter boundary')
        evidence.cancel = { action, at:performance.now(), activeTurns:evidence.activeTurns, callId:call.id, callCount:engine.calls.length }
        engine.emit('done',call.id)
        await sleep(0)
        const control = document.querySelector(action === 'pause' ? '[data-mini-play]' : '[data-mini-stop]')
        if (!control || control.hidden) throw new Error('Reader playback control missing at cancellation')
        control.click()
        await sleep(1800)
        return { reachedNext:false, calls:engine.calls.length }
      }
      engine.emit('done',call.id)
      const expires = performance.now() + 10_000
      while (engine.current?.id === call.id && performance.now() < expires) await sleep(5)
      if (engine.current?.id === call.id) throw new Error('Playback failed to progress after a completed fragment')
    }
    throw new Error('First chapter exceeded the bounded fixture fragment count')
  },cancel)
}

test('EPUB: the final animated follow settles before entering the next chapter, with all text in order', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror',error => errors.push(error.message))
  await openAndPlay(page)
  const result = await completeFirstChapter(page)
  expect(result.reachedNext).toBe(true)
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0].doc.querySelector('h1')?.textContent)).toBe('Beyond the window')
  await expect(page.getByRole('button', {name:'Pausar lectura',exact:true})).toBeVisible()
  const evidence = await page.evaluate(() => window.__chapterContinuity)
  expect(evidence.animated).toBe(true)
  expect(evidence.initialPages).toBeGreaterThan(4)
  expect(evidence.started.length).toBeGreaterThan(20)
  expect(compact(evidence.started.map(entry => entry.text).join(' '))).toBe(compact(evidence.expected))
  expect(evidence.done.map(entry => entry.id)).toEqual(evidence.started.map(entry => entry.id))
  expect(evidence.nativeTurns.some(entry => entry.finishedAt - entry.startedAt > 100)).toBe(true)
  expect(evidence.relocations.some(entry => entry.heading === 'Beyond the window')).toBe(true)
  expect(evidence.stops).toBe(0)
  await testInfo.attach('native-chapter-follow-continuity', {body:JSON.stringify({ result,evidence,errors }),contentType:'application/json'})
  expect(errors).toEqual([])
})

for (const action of ['pause','stop']) test(`EPUB: ${action} cancels a chapter turn queued behind the final animated follow`, async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror',error => errors.push(error.message))
  await openAndPlay(page)
  const result = await completeFirstChapter(page,action)
  expect(result.reachedNext).toBe(false)
  const evidence = await page.evaluate(() => window.__chapterContinuity)
  expect(evidence.animated).toBe(true)
  expect(evidence.cancel.activeTurns).toBeGreaterThan(0)
  expect(result.calls).toBe(evidence.cancel.callCount)
  expect(compact(evidence.started.map(entry => entry.text).join(' '))).toBe(compact(evidence.expected))
  expect(evidence.relocations.some(entry => entry.heading === 'Beyond the window')).toBe(false)
  expect(await page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0].doc.querySelector('h1')?.textContent)).not.toBe('Beyond the window')
  if (action === 'pause') await expect(page.getByRole('button', {name:'Continuar lectura',exact:true})).toBeVisible()
  else await expect(page.getByRole('button', {name:'Pausar lectura',exact:true})).toHaveCount(0)
  await testInfo.attach(`native-chapter-follow-${action}`, {body:JSON.stringify({result,evidence,errors}),contentType:'application/json'})
  expect(errors).toEqual([])
})
