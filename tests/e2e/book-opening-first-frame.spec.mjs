import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { frameClockSince, watchFrames } from './helpers/frame-clock.mjs'
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs'

// The opening of a book pulled off a freshly loaded shelf. While the book waits in the hand its page is prepared
// (rust-ui/src/bookshelf/flyout_motion.rs warm_opening_page): page textures uploaded, programs linked and, once,
// the meshes only an open board shows drawn under the closed pose (book_view_host.rs book_view_warm_opening).
// The opening's frames then link no program, upload no texture and allocate no buffer.
//
// It is also the probe for before/after comparisons (OPENING_FIRST_FRAME in the output): every WebGL call that
// links, compiles, uploads, allocates, resizes or draws is counted per animation frame, a frame's script time is
// the sum of its animation-frame callbacks, long animation frames are listed, and the frame clock
// (helpers/frame-clock.mjs) times the whole opening. Knobs: IHR_OPENING_DPR (device pixel ratio, default 1),
// IHR_OPENING_SYNC=1 (each frame waits for the GPU, so its time includes the driver's work), IHR_OPENING_FRAMES
// (frames printed, default 6).

test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:Number(process.env.IHR_OPENING_DPR || 1) })
const READY_TIMEOUT = 120_000

function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  for (let i = 0; i < 2; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`)
    const stream = `.1 .3 .6 rg 0 0 400 600 re f\n1 1 1 rg BT /F1 23 Tf 32 540 Td (Page ${i + 1}.) Tj ET`
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  let output = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return { name:'first-frame.pdf', mimeType:'application/pdf', buffer:Buffer.from(output) }
}

function instrument({ sync }) {
  const probe = window.__openingProbe = { on:false, events:[], frames:[], marks:[], current:null, contexts:new Set(), loaf:[] }
  const now = () => performance.now()
  const log = (kind, start, extra) => {
    if (!probe.on) return
    const event = { kind, start, duration:now() - start, ...extra }
    probe.events.push(event)
    if (probe.current) probe.current.gl.push(event)
  }
  const getContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = getContext.call(this, type, ...rest)
    if (context && /webgl/.test(type)) { probe.contexts.add(context); this.__probeContext = context }
    return context
  }
  const bytes = args => {
    for (const arg of args) {
      if (arg && typeof arg === 'object' && 'byteLength' in arg) return arg.byteLength
      if (arg && typeof arg === 'object' && 'width' in arg) return arg.width * arg.height * 4 || 0
    }
    return 0
  }
  for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!type) continue
    for (const method of ['linkProgram', 'compileShader', 'getProgramParameter', 'texImage2D', 'texSubImage2D', 'texStorage2D',
      'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'generateMipmap', 'bufferData', 'readPixels', 'drawElements', 'drawArrays']) {
      const original = type.prototype[method]
      if (!original) continue
      type.prototype[method] = function (...args) {
        const start = now(), result = original.apply(this, args)
        const upload = method.startsWith('tex') || method === 'bufferData'
        log(method, start, { bytes:upload ? bytes(args) : 0,
          args:method.startsWith('tex') ? args.map(arg => typeof arg === 'number' ? arg : arg?.constructor?.name ?? String(arg)).join(',') : undefined })
        return result
      }
    }
  }
  // A WebGL canvas resized reallocates its drawing buffer.
  for (const key of ['width', 'height']) {
    const property = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key)
    Object.defineProperty(HTMLCanvasElement.prototype, key, { ...property, set(value) {
      const start = now(), changed = property.get.call(this) !== value
      property.set.call(this, value)
      if (changed && probe.contexts.has(this.__probeContext)) log('resize', start, { args:`${key}=${value}` })
    } })
  }
  // With `sync`, every frame ends by waiting for the GPU (getError is a round trip that runs every queued command):
  // the frame's time then includes the driver's work that the GPU process otherwise does after the frame.
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = callback => raf(time => {
    let record = probe.on && probe.frames.at(-1)?.time === time ? probe.frames.at(-1) : null
    if (probe.on && !record) { record = { time, script:0, gpuWait:0, gl:[], callbacks:0 }; probe.frames.push(record) }
    const start = now(), previous = probe.current
    probe.current = record
    try { return callback(time) } finally {
      const waiting = now()
      if (record && sync) for (const context of probe.contexts) context.getError()
      probe.current = previous
      if (record) { record.gpuWait += now() - waiting; record.script += now() - start; record.callbacks++ }
    }
  })
  const mark = performance.mark.bind(performance)
  performance.mark = (name, ...rest) => { if (probe.on) probe.marks.push([name, now()]); return mark(name, ...rest) }
}

// A book read once (it has a saved page and a ribbon), reloaded: nothing is retained from the reading.
async function readShelf(page) {
  await page.goto(process.env.IHR_TEST_URL || '/')
  await page.locator('#file-picker').setInputFiles(pdf())
  await expect(page.locator('#reader-toolbar')).toBeVisible({ timeout:READY_TIMEOUT })
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 2/, { timeout:READY_TIMEOUT })
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('.ihr-flyout--return')).toHaveCount(0, { timeout:READY_TIMEOUT })
  await page.reload()
}

// A book never opened, on a lit isometric BAGGEBO shelf with a lamp and a plant (as shelf-motion-performance).
async function seededShelf(page) {
  await page.addInitScript(() => {
    localStorage.setItem('inhouse-read-shelf-view', 'isometric')
    localStorage.setItem('inhouse-read-shelf-type', 'baggebo')
    localStorage.setItem('inhouse-read-shelf-plants', JSON.stringify([{ key:'plant:probe', seed:'probe', catalogId:'sansevieria',
      variant:'sansevieria', potId:'muskot', width:42, height:124, shelf:0, x:.76 }]))
    localStorage.setItem('inhouse-read-shelf-lamps', JSON.stringify([{ key:'lamp:probe', lampId:'tarnaby', shelf:1, x:.56, isOn:true }]))
  })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await expect(page.locator('.ihr-bookshelf')).toBeVisible({ timeout:READY_TIMEOUT })
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')]
  await page.evaluate(async ({ bytes, geometry }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600
    const context = canvas.getContext('2d'); context.fillStyle = '#713b42'; context.fillRect(0, 0, 400, 600)
    context.fillStyle = '#e8e2cf'; context.font = '32px serif'; context.fillText('LIBRO', 56, 112)
    const cover = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const transaction = db.transaction('books', 'readwrite')
    transaction.objectStore('books').put({ id:'probe:book', title:'Libro', name:'probe.pdf', format:'PDF', sourceType:'local',
      mimeType:'application/pdf', pageCount:260, ...geometry, content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }), cover,
      coverFinish:'glossy', spineSurfaceFinish:'glossy', spineColorOverride:'#713b42', shelfPosition:{ shelf:1, x:.3 }, shelfOrder:0,
      addedAt:Date.now(), lastOpenedAt:Date.now(), progressFraction:0 })
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error) })
    db.close()
  }, { bytes, geometry:await settledGeometryLength(78_000, 'opening-probe') })
  await page.reload()
}

const report = page => page.evaluate(() => {
  const probe = window.__openingProbe; probe.on = false
  const at = name => probe.marks.find(([mark]) => mark === name)?.[1]
  const pick = at('pick'), tap = at('tap'), installed = at('ihr:page-installed'), opening = at('phase:opening'), bookmark = at('phase:bookmark')
  const count = (list, kind) => list.filter(event => event.kind === kind).length
  const total = (list, test, key) => +list.filter(test).reduce((sum, event) => sum + event[key], 0).toFixed(1)
  const texture = event => event.kind.startsWith('tex') || event.kind === 'compressedTexImage2D'
  const summary = list => ({ links:count(list, 'linkProgram'), compiles:count(list, 'compileShader'),
    linkMs:total(list, event => ['linkProgram', 'compileShader', 'getProgramParameter'].includes(event.kind), 'duration'),
    uploads:list.filter(texture).length, uploadBytes:total(list, texture, 'bytes'),
    uploadMs:total(list, event => texture(event) || event.kind === 'generateMipmap', 'duration'),
    buffers:count(list, 'bufferData'), bufferBytes:total(list, event => event.kind === 'bufferData', 'bytes'),
    readPixels:count(list, 'readPixels'), resizes:count(list, 'resize'), draws:count(list, 'drawElements') + count(list, 'drawArrays') })
  const drew = frame => frame.gl.some(event => event.kind.startsWith('draw'))
  // The motion's frames, those that drew, from the page's installation to the bookmark phase.
  const motion = probe.frames.filter(frame => frame.time >= installed - 1 && (!bookmark || frame.time < bookmark) && drew(frame))
  const pullFrames = probe.frames.filter(frame => frame.time >= pick && frame.time < tap && drew(frame))
  return {
    marks:probe.marks.map(([name, time]) => [name, Math.round(time - pick)]),
    pull:summary(probe.events.filter(event => event.start >= pick && event.start < tap)),
    pullFirstFrames:pullFrames.slice(0, 3).map(frame => ({ script:+frame.script.toFixed(1), ...summary(frame.gl) })),
    startTask:+(opening - installed).toFixed(1), start:summary(probe.events.filter(event => event.start >= installed && event.start <= opening)),
    opening:summary(probe.events.filter(event => event.start >= installed && (!bookmark || event.start < bookmark))),
    firstFrameWork:motion[0]?.gl.filter(event => texture(event) || ['bufferData', 'resize', 'linkProgram'].includes(event.kind))
      .map(event => `${event.kind}(${event.args ?? event.bytes})`),
    frames:motion.map(frame => ({ at:Math.round(frame.time - installed), script:+frame.script.toFixed(1), gpuWait:+frame.gpuWait.toFixed(1),
      ...summary(frame.gl) })),
    longFrames:probe.loaf.filter(entry => entry.start >= tap).map(entry => ({ ...entry, start:Math.round(entry.start - installed) }))
  }
})

for (const [kind, setup] of [['never opened, lit BAGGEBO', seededShelf], ['read once', readShelf]]) {
  test(`${kind}: the opening's first frame links, uploads and allocates nothing`, async ({ page }) => {
    test.setTimeout(280_000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.emulateMedia({ reducedMotion:'no-preference' })
    await page.addInitScript(instrument, { sync:Boolean(process.env.IHR_OPENING_SYNC) })
    await watchFrames(page)
    await setup(page)
    await expect(page.locator('.ihr-spine')).toHaveCount(1, { timeout:READY_TIMEOUT })
    await page.evaluate(() => {
      const probe = window.__openingProbe; probe.on = true
      probe.marks.push(['pick', performance.now()])
      new MutationObserver(() => {
        const phase = document.querySelector('.ihr-flyout')?.dataset.openingPhase
        if (phase && !probe.marks.some(([name]) => name === `phase:${phase}`)) probe.marks.push([`phase:${phase}`, performance.now()])
      }).observe(document.body, { subtree:true, attributes:true, attributeFilter:['data-opening-phase'] })
      new PerformanceObserver(list => { for (const entry of list.getEntries()) probe.loaf.push({ start:entry.startTime, duration:+entry.duration.toFixed(1),
        scripts:entry.scripts.map(script => `${script.invoker}:${Math.round(script.duration)}`).slice(0, 4) }) }).observe({ type:'long-animation-frame' })
    })
    await page.locator('.ihr-spine').first().click()
    await expect(page.locator('.ihr-flyout.is-ready')).toBeVisible({ timeout:READY_TIMEOUT })
    await expect(page.locator('.ihr-flyout__readiness')).toHaveText('Listo para leer', { timeout:READY_TIMEOUT })
    // The page's preparation ends with its textures on the GPU; the tap comes once the hand has been still a moment.
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName('ihr:textures-uploaded').length), { timeout:READY_TIMEOUT }).toBe(1)
    await page.waitForTimeout(1000)
    await page.evaluate(() => window.__openingProbe.marks.push(['tap', performance.now()]))
    const since = Date.now()
    await page.locator('.ihr-flyout__cover-target').click()
    await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:READY_TIMEOUT })
    await expect(page.locator('#reader-toolbar')).toBeVisible({ timeout:READY_TIMEOUT })
    const clock = await frameClockSince([page], since)
    const result = await report(page)
    console.log('OPENING_FIRST_FRAME', JSON.stringify({ kind, frameClockMs:Math.round(clock), ...result,
      frames:result.frames.slice(0, Number(process.env.IHR_OPENING_FRAMES || 6)) }, null, 1))
    expect(result.frames.length).toBeGreaterThan(0)
    expect(result.firstFrameWork, 'the first frame of the opening found everything it draws ready').toEqual([])
    expect(result.opening, 'the opening links, uploads and allocates nothing').toMatchObject({ links:0, uploads:0, buffers:0, resizes:0 })
    expect(errors).toEqual([])
  })
}
