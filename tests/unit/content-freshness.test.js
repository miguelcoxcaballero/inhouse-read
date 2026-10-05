import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractShellSignature } from '../../src/js/content-freshness.js'

const site = 'https://miguelcoxcaballero.github.io/inhouse-read/'
const deployed = (main, css = 'main-CSS1.css') => '<!doctype html><head><script>inline()</script>' +
  `<script type="module" crossorigin src="${site}assets/${main}"></script>` +
  `<link rel="modulepreload" crossorigin href="${site}assets/three-X.js">` +
  `<link rel="preload" as="font" href="${site}assets/font.woff2">` +
  `<link rel="stylesheet" crossorigin href="${site}assets/${css}"></head><body></body>`

describe('extractShellSignature', () => {
  it('lists the module script and the stylesheets, with crossorigin in between', () => {
    const html = '<script type="module" crossorigin src="/inhouse-read/assets/main-DyFkh1KR.js"></script>' +
      '<link rel="stylesheet" crossorigin href="/inhouse-read/assets/main-B4s2dRvI.css">'
    expect(extractShellSignature(html, site)).toBe(
      'https://miguelcoxcaballero.github.io/inhouse-read/assets/main-DyFkh1KR.js ' +
      'https://miguelcoxcaballero.github.io/inhouse-read/assets/main-B4s2dRvI.css'
    )
  })

  it('funciona con el orden de atributos invertido (src antes que type)', () => {
    const html = '<script src="/inhouse-read/assets/main-ABC123.js" type="module"></script><link href="/inhouse-read/assets/a.css" rel="stylesheet">'
    expect(extractShellSignature(html, site)).toBe(`${site}assets/main-ABC123.js ${site}assets/a.css`)
  })

  it('distingue un bundle o una hoja de estilos distintos entre dos versiones del HTML', () => {
    const before = extractShellSignature(deployed('main-AAA.js'), site)
    expect(extractShellSignature(deployed('main-BBB.js'), site)).not.toBe(before)
    expect(extractShellSignature(deployed('main-AAA.js', 'main-CSS2.css'), site)).not.toBe(before)
    expect(extractShellSignature(deployed('main-AAA.js'), site)).toBe(before)
  })

  it('ignora scripts clásicos, precargas y HTML vacío', () => {
    expect(extractShellSignature('<script src="legacy.js"></script><link rel="modulepreload" href="x.js">', site)).toBe('')
    expect(extractShellSignature('', site)).toBe('')
  })
})

describe('checking the deployed app at launch', () => {
  let location, listeners
  async function start(latestHtml, options = {}) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok:true, text:async () => latestHtml })))
    const { initContentFreshnessChecks } = await import('../../src/js/content-freshness.js')
    initContentFreshnessChecks({ location, ...options })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(location.href, { cache:'no-store' }))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  beforeEach(() => {
    vi.resetModules()
    document.documentElement.innerHTML = deployed('main-AAA.js')
    Object.defineProperty(document, 'visibilityState', { value:'visible', configurable:true })
    sessionStorage.clear()
    location = { href:`${site}?inhouse_app=1&t=1`, reload:vi.fn() }
    listeners = []
    const add = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, callback, options) => {
      listeners.push([type, callback, options]); return add(type, callback, options)
    })
    vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0)
  })
  afterEach(() => {
    for (const [type, callback, options] of listeners) window.removeEventListener(type, callback, options)
    vi.restoreAllMocks(); vi.unstubAllGlobals()
    delete document.visibilityState
  })

  it('reloads into a newer deploy while nobody has touched the shelf', async () => {
    await start(deployed('main-BBB.js'))
    expect(location.reload).toHaveBeenCalledOnce()
  })

  it('also reloads for a deploy that only changed a stylesheet', async () => {
    await start(deployed('main-AAA.js', 'main-CSS2.css'))
    expect(location.reload).toHaveBeenCalledOnce()
  })

  it('stays on the shelf when it already is the deployed app', async () => {
    await start(deployed('main-AAA.js'))
    expect(location.reload).not.toHaveBeenCalled()
  })

  it('leaves a newer deploy for the next resume once the shelf has been touched', async () => {
    let answer
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { answer = resolve })))
    const { initContentFreshnessChecks } = await import('../../src/js/content-freshness.js')
    initContentFreshnessChecks({ location })
    window.dispatchEvent(new Event('pointerdown'))
    answer({ ok:true, text:async () => deployed('main-BBB.js') })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(location.reload).not.toHaveBeenCalled()
  })

  it('leaves it while the app is busy or the page is in the background', async () => {
    await start(deployed('main-BBB.js'), { isIdle:() => false })
    expect(location.reload).not.toHaveBeenCalled()
    vi.resetModules()
    Object.defineProperty(document, 'visibilityState', { value:'hidden', configurable:true })
    await start(deployed('main-BBB.js'))
    expect(location.reload).not.toHaveBeenCalled()
  })

  it('decides before the shelf is built when the answer came in while the app was loading', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { initContentFreshnessChecks } = await import('../../src/js/content-freshness.js')
    const check = initContentFreshnessChecks({ location, deployed:{ html:deployed('main-BBB.js') } })
    expect(location.reload).toHaveBeenCalledOnce()
    expect(check.reloading()).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('builds the open shelf when the early answer is this deploy, or still on its way', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { initContentFreshnessChecks } = await import('../../src/js/content-freshness.js')
    expect(initContentFreshnessChecks({ location, deployed:{ html:deployed('main-AAA.js') } }).reloading()).toBe(false)
    vi.resetModules()
    let answer
    const late = await import('../../src/js/content-freshness.js')
    const check = late.initContentFreshnessChecks({ location, deployed:{ html:null, done:new Promise(resolve => { answer = resolve }) } })
    expect(check.reloading()).toBe(false)
    answer(deployed('main-BBB.js'))
    await vi.waitFor(() => expect(location.reload).toHaveBeenCalledOnce())
    expect(check.reloading()).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not reload again for a deploy that the last reload did not bring', async () => {
    const latest = extractShellSignature(deployed('main-BBB.js'), location.href)
    sessionStorage.setItem('inhouse-read-fresh-reload', JSON.stringify({ to:latest, at:Date.now() }))
    await start(deployed('main-BBB.js'))
    expect(location.reload).not.toHaveBeenCalled()
  })
})
