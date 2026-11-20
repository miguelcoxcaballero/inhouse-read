import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs'

// The pull-out: a spine tapped on a freshly loaded, settled shelf, and the first frames of the book leaving it.
// The tap's first paint of the lifted book comes once the pull-out has reserved the largest window of its flight
// (rust-ui/src/bookshelf/flyout.rs `reveal`, book_view_motion.rs `motionCapacity`): the flyout's drawing buffer is
// sized once, in the tap, at its final size, and no frame of the pull-out resizes it. Before, the tap sized it for
// the book still on the shelf and the first frame grew it, a reallocation that waited for the GPU to finish the
// tap's paint (35-680 ms at devicePixelRatio 3 on software GL).
//
// It is also the probe for before/after comparisons (PULLOUT_FIRST_FRAME in the output): the tap's handlers (Event
// Timing processing of pointerdown, pointerup and click, their microtasks included), every WebGL call that links,
// compiles, uploads, allocates, resizes or draws, outside frames until the pull-out's first frame and per animation
// frame after it, each frame's script time (the sum of its animation-frame callbacks) and the long animation frames.
// Knobs: IHR_PULLOUT_DPR (device pixel ratio, default 1), IHR_PULLOUT_FRAMES (frames printed, default 6),
// IHR_PULLOUT_IDLE (ms the settled shelf idles before the tap, default 4000), IHR_PULLOUT_PROFILE=<file> (a CPU
// profile of the tap and the pull-out, with its heaviest functions printed), IHR_PULLOUT_STRICT=0 (numbers only).

test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:Number(process.env.IHR_PULLOUT_DPR || 1) })
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
  return { name:'pullout.pdf', mimeType:'application/pdf', buffer:Buffer.from(output) }
}

function instrument() {
  const probe = window.__pulloutProbe = { on:false, events:[], frames:[], marks:[], current:null, contexts:new Set(), loaf:[], clicks:[] }
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
    for (const method of ['linkProgram', 'compileShader', 'texImage2D', 'texSubImage2D', 'texStorage2D', 'texImage3D',
      'texSubImage3D', 'compressedTexImage2D', 'generateMipmap', 'bufferData', 'readPixels', 'drawElements', 'drawArrays']) {
      const original = type.prototype[method]
      if (!original) continue
      type.prototype[method] = function (...args) {
        const start = now(), result = original.apply(this, args)
        const upload = method.startsWith('tex') || method === 'bufferData'
        log(method, start, { bytes:upload ? bytes(args) : 0, live:this.canvas?.className === 'ihr-book-live-canvas',
          args:method.startsWith('tex') ? args.map(arg => typeof arg === 'number' ? arg : arg?.constructor?.name ?? String(arg)).join(',') : undefined })
        return result
      }
    }
  }
  // A WebGL canvas resized reallocates its drawing buffer.
  for (const key of ['width', 'height']) {
    const property = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key)
    Object.defineProperty(HTMLCanvasElement.prototype, key, { ...property, set(value) {
      const start = now(), before = property.get.call(this)
      property.set.call(this, value)
      if (before !== value && probe.contexts.has(this.__probeContext)) log('resize', start, { args:`${this.className || 'canvas'}.${key}=${before}->${value}` })
    } })
  }
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = callback => raf(time => {
    let record = probe.on && probe.frames.at(-1)?.time === time ? probe.frames.at(-1) : null
    if (probe.on && !record) { record = { time, ran:now(), script:0, gl:[], callbacks:0 }; probe.frames.push(record) }
    const start = now(), previous = probe.current
    probe.current = record
    try { return callback(time) } finally {
      probe.current = previous
      if (record) { record.script += now() - start; record.callbacks++ }
    }
  })
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
  }, { bytes, geometry:await settledGeometryLength(78_000, 'pullout-probe') })
  await page.reload()
}

const report = page => page.evaluate(() => {
  const probe = window.__pulloutProbe; probe.on = false
  const at = name => probe.marks.find(([mark]) => mark === name)?.[1]
  const tap = at('tap')
  const count = (list, kind) => list.filter(event => event.kind === kind).length
  const total = (list, test, key) => +list.filter(test).reduce((sum, event) => sum + event[key], 0).toFixed(1)
  const texture = event => event.kind.startsWith('tex') || event.kind === 'compressedTexImage2D'
  const summary = list => ({ links:count(list, 'linkProgram'), compiles:count(list, 'compileShader'),
    uploads:list.filter(texture).length, uploadBytes:total(list, texture, 'bytes'),
    uploadMs:total(list, event => texture(event) || event.kind === 'generateMipmap', 'duration'),
    buffers:count(list, 'bufferData'), bufferBytes:total(list, event => event.kind === 'bufferData', 'bytes'),
    readPixels:count(list, 'readPixels'), resizes:count(list, 'resize'), resizeMs:total(list, event => event.kind === 'resize', 'duration'),
    draws:count(list, 'drawElements') + count(list, 'drawArrays') })
  // The pull-out's frames: those that drew the lifted book (its live canvas, rust-ui/src/book_view_host.rs).
  const frames = probe.frames.filter(frame => frame.time >= tap && frame.time < (at('ready') ?? Infinity) &&
    frame.gl.some(event => event.live && event.kind.startsWith('draw')))
  const input = name => probe.clicks.find(entry => entry.name === name && entry.start >= tap - 1)
  const click = input('click')
  const inFrame = new Set(probe.frames.flatMap(frame => frame.gl))
  const work = list => list.filter(event => texture(event) || ['bufferData', 'resize', 'linkProgram'].includes(event.kind))
    .map(event => `${event.kind}(${event.args ?? event.bytes})${event.duration >= 1 ? ` ${event.duration.toFixed(1)} ms` : ''}`)
  return {
    marks:probe.marks.map(([name, time]) => [name, Math.round(time - tap)]),
    click:click ? { processingMs:+click.processing.toFixed(1), durationMs:click.duration } : null,
    pointerdownMs:+(input('pointerdown')?.processing ?? 0).toFixed(1), pointerupMs:+(input('pointerup')?.processing ?? 0).toFixed(1),
    // The tap's handlers: pointerdown, pointerup and click (a touch opens the book from one of them).
    tapHandlersMs:+['pointerdown', 'pointerup', 'click'].reduce((sum, name) => sum + (input(name)?.processing ?? 0), 0).toFixed(1),
    // Everything outside animation frames from the tap to the pull-out's first frame: the tap and its continuations.
    beforeFirstFrame:summary(probe.events.filter(event => event.start >= tap && event.start < (frames[0]?.ran ?? Infinity) && !inFrame.has(event))),
    beforeFirstFrameWork:work(probe.events.filter(event => event.start >= tap && event.start < (frames[0]?.ran ?? Infinity) && !inFrame.has(event))),
    resizes:probe.events.filter(event => event.start >= tap && event.kind === 'resize').map(event => `${Math.round(event.start - tap)}: ${event.args} ${event.duration.toFixed(1)} ms`),
    firstFrameWork:frames[0] ? work(frames[0].gl) : [],
    all:summary(probe.events.filter(event => event.start >= tap)),
    frames:frames.map(frame => ({ at:Math.round(frame.time - tap), script:+frame.script.toFixed(1), ...summary(frame.gl) })),
    longFrames:probe.loaf.filter(entry => entry.start >= tap - 1).map(entry => ({ ...entry, start:Math.round(entry.start - tap) }))
  }
})

// The heaviest functions of a CPU profile, by self time.
function heaviest(profile, limit = 25) {
  const self = new Map(), byId = new Map(profile.nodes.map(node => [node.id, node]))
  const deltas = profile.timeDeltas
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]), { functionName, url, lineNumber } = node.callFrame
    const key = `${functionName || '(anonymous)'} ${url.split('/').pop()}:${lineNumber + 1}`
    self.set(key, (self.get(key) || 0) + (deltas[i] || 0) / 1000)
  }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, ms]) => `${ms.toFixed(1).padStart(7)} ms  ${name}`)
}

for (const [kind, setup] of [['never opened, lit BAGGEBO', seededShelf], ['read once', readShelf]]) {
  test(`${kind}: no frame of the pull-out resizes the flyout's drawing buffer`, async ({ page }) => {
    test.setTimeout(280_000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.emulateMedia({ reducedMotion:'no-preference' })
    await page.addInitScript(instrument)
    await setup(page)
    await expect(page.locator('.ihr-spine')).toHaveCount(1, { timeout:READY_TIMEOUT })
    // The shelf settles and its idle preparation runs before the user's tap.
    await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false', { timeout:READY_TIMEOUT })
    await page.waitForTimeout(Number(process.env.IHR_PULLOUT_IDLE || 4000))
    await page.evaluate(() => {
      const probe = window.__pulloutProbe; probe.on = true
      probe.marks.push(['tap', performance.now()])
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (/^(pointerdown|pointerup|click)$/.test(entry.name))
        probe.clicks.push({ name:entry.name, start:entry.startTime, processing:entry.processingEnd - entry.processingStart, duration:entry.duration }) })
        .observe({ type:'event', durationThreshold:16 })
      new PerformanceObserver(list => { for (const entry of list.getEntries()) probe.loaf.push({ start:entry.startTime, duration:+entry.duration.toFixed(1),
        blocking:+entry.blockingDuration.toFixed(1),
        scripts:entry.scripts.map(script => `${script.invoker}:${Math.round(script.duration)}`).slice(0, 4) }) }).observe({ type:'long-animation-frame' })
    })
    const profiling = process.env.IHR_PULLOUT_PROFILE
    const cdp = profiling ? await page.context().newCDPSession(page) : null
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval:100 }); await cdp.send('Profiler.start') }
    // A finger, as on the phone: touch pointer events, then the click.
    await page.locator('.ihr-spine').first().tap()
    await expect(page.locator('.ihr-flyout.is-ready')).toBeVisible({ timeout:READY_TIMEOUT })
    await page.evaluate(() => window.__pulloutProbe.marks.push(['ready', performance.now()]))
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop')
      await writeFile(`${profiling}.${kind.split(' ')[0]}.cpuprofile`, JSON.stringify(profile))
      console.log('PULLOUT_PROFILE', kind, '\n' + heaviest(profile).join('\n'))
    }
    // Late Event Timing entries are delivered with the next frames.
    await page.waitForTimeout(500)
    const result = await report(page)
    console.log('PULLOUT_FIRST_FRAME', JSON.stringify({ kind, ...result,
      frames:result.frames.slice(0, Number(process.env.IHR_PULLOUT_FRAMES || 6)) }, null, 1))
    expect(errors).toEqual([])
    if (process.env.IHR_PULLOUT_STRICT === '0') return
    expect(result.frames.length).toBeGreaterThan(0)
    expect(result.firstFrameWork, 'the pull-out\'s first frame found its drawing buffer and programs ready').toEqual([])
    expect(result.frames.filter(frame => frame.resizes), 'no frame of the pull-out resizes a drawing buffer').toEqual([])
  })
}
