import { test, expect } from '@playwright/test'
import { startHuggingFaceMirror, haveVoice } from './helpers/hf-mirror.mjs'
import { openAudioMenu } from './helpers/audio-menus.mjs'

const MODEL = 'es_ES-davefx-medium', ID = `piper:${MODEL}`

// A deterministic, two-page PDF. Its one sentence crosses the physical page
// boundary; there are no headers or hidden duplicate text to read around it.
const PDF_PARTS = [
  'Esta frase empieza en la primera página',
  'y sigue en la siguiente mientras la voz lee cada palabra sin repetir ni perder ninguna parte del texto.'
]
function boundaryPDF() {
  const escape = text => [...Buffer.from(text, 'latin1')].map(byte => byte < 32 || byte > 126
    ? `\\${byte.toString(8).padStart(3, '0')}` : /[()\\]/.test(String.fromCharCode(byte))
      ? `\\${String.fromCharCode(byte)}` : String.fromCharCode(byte)).join('')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ]
  PDF_PARTS.forEach((text, index) => {
    const lines = text.match(/.{1,46}(?:\s|$)/g).map(line => line.trim())
    const content = `BT /F1 16 Tf 28 520 Td 24 TL ${lines.map((line, index) => `${index ? 'T* ' : ''}(${escape(line)}) Tj`).join('\n')} ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  })
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}
test('una frase entre páginas avanza al inicio audible de su continuación natural', async ({page}, testInfo) => {
  test.setTimeout(180_000)
  expect(haveVoice(MODEL), 'real Davefx model must be available').toBe(true)
  const mirror = await startHuggingFaceMirror({voices:[MODEL], sliceMs:0})
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await page.setViewportSize({width:320,height:640})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.addInitScript(({base, id}) => {
      window.INHOUSE_NEURAL_VOICE_BASE = base
      localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({fontSize:36,lineHeight:2.4,voice:id}))
      const evidence = window.__pageSpeech = {requests:[],starts:[],turns:[],pcm:[],device:0}
      const firstOffset = () => {
        const view = document.querySelector('foliate-view'), visible = view?.lastLocation?.range
        const doc = visible?.startContainer?.ownerDocument, node = doc?.querySelector('p')?.firstChild
        if (!node || !visible) return null
        const range = doc.createRange(); range.setStart(node,0)
        try { range.setEnd(visible.startContainer,visible.startOffset); return range.toString().length } catch { return null }
      }
      window.__firstOffset = firstOffset
      window.addEventListener('inhouse-tts', event => {
        if (event.detail.type === 'start') evidence.starts.push({id:event.detail.id, at:performance.now(), offset:firstOffset()})
      })
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function(...args) {
        const data = this.buffer.getChannelData(0)
        evidence.pcm.push({finite:data.every(Number.isFinite), peak:data.reduce((best,x) => Math.max(best, Math.abs(x)),0)})
        return start.apply(this,args)
      }
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak:()=>evidence.device++,cancel(){}}})
      window.InhouseSpeech={getVoices:()=> '[]',speak:()=>evidence.device++,stop(){}}
    },{base:mirror.base,id:ID})
    await page.goto(process.env.IHR_TEST_URL || './')
    await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/speech-page-boundary.epub')
    await expect(page.locator('foliate-view')).toBeVisible()
    await page.evaluate(() => {
      const view = document.querySelector('foliate-view')
      view.addEventListener('relocate', () => window.__pageSpeech.turns.push({at:performance.now(),offset:window.__firstOffset()}))
    })
    await page.getByRole('button',{name:'Escuchar el libro'}).click()
    await openAudioMenu(page,'Voz')
    await page.locator(`[data-neural-voice="${ID}"]`).getByRole('button',{name:/Descargar la voz/}).click()
    await expect(page.locator(`[data-neural-voice="${ID}"]`)).toContainText('Instalada',{timeout:90_000})
    await page.evaluate(async () => {
      for (const url of performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/assets\/index-[\w-]+\.js$/.test(name))) {
        const module = await import(url)
        const facade = module.getNeuralEngine ? module : Object.values(module).find(value => typeof value?.getNeuralEngine === 'function')
        if (!facade) continue
        const engine = facade.getNeuralEngine(), speak = engine.speak.bind(engine)
        engine.speak = request => { window.__pageSpeech.requests.push({...request,at:performance.now()}); return speak(request) }
        return
      }
      throw new Error('The real engine loaded by the application was not observed')
    })
    await page.getByRole('button',{name:'Reproducir',exact:true}).click()
    await expect.poll(() => page.evaluate(() => window.__pageSpeech.starts.length),{timeout:90_000}).toBeGreaterThan(1)
    await expect.poll(() => page.evaluate(() => window.__pageSpeech.turns.filter(turn => turn.offset > 0).length),{timeout:10_000}).toBeGreaterThan(0)
    await page.getByRole('button',{name:'Pausar',exact:true}).click()
    const evidence = await page.evaluate(() => window.__pageSpeech)
    await testInfo.attach('actual-audio-page-boundary',{body:JSON.stringify(evidence),contentType:'application/json'})
    expect(evidence.requests.length).toBeGreaterThan(1)
    expect(evidence.requests[0].text.length).toBeLessThan(143)
    expect([evidence.requests[0].text,...evidence.requests[0].upcoming].join(' ')).toBe('Esta frase empieza en la primera página y sigue en la siguiente mientras la voz lee cada palabra sin repetir ni perder ninguna parte del texto.')
    const start = evidence.starts.find(event => event.id === evidence.requests[1].id)
    expect(start).toBeTruthy()
    const turn = evidence.turns.find(turn => turn.offset > 0)
    expect(turn.at).toBeGreaterThanOrEqual(start.at)
    expect(turn.at - start.at).toBeLessThan(1000)
    expect(evidence.starts[0].offset).toBe(0)
    expect(evidence.pcm.length).toBeGreaterThan(0)
    expect(evidence.pcm.every(chunk => chunk.finite && chunk.peak > .05 && chunk.peak <= 1)).toBe(true)
    expect(evidence.device).toBe(0)
    expect(errors).toEqual([])
  } finally { await mirror.close() }
})

test('PDF mantiene la página anterior durante la preparación y cambia al PCM audible de la continuación', async ({page}, testInfo) => {
  test.setTimeout(180_000)
  expect(haveVoice(MODEL), 'real Davefx model must be available').toBe(true)
  const mirror = await startHuggingFaceMirror({voices:[MODEL], sliceMs:0})
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await page.setViewportSize({width:390,height:844})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.addInitScript(({base, id}) => {
      window.INHOUSE_NEURAL_VOICE_BASE = base
      localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify({voice:id,voiceLang:'es'}))
      const evidence = window.__pdfSpeech = {requests:[],events:[],frames:[],pcm:[],jobs:[],previews:[],device:0}
      const sample = document.createElement('canvas'); sample.width=32; sample.height=48
      const context = sample.getContext('2d', {willReadFrequently:true})
      const visible = () => {
        const canvas = document.querySelector('.pdf-page-canvas')
        const layer = document.querySelector('.pdf-text-layer')
        let pixels = null
        if (canvas?.width && canvas?.height) {
          context.drawImage(canvas,0,0,32,48)
          const bytes=context.getImageData(0,0,32,48).data
          let hash=2166136261
          for (const value of bytes) hash=Math.imul(hash ^ value,16777619)
          pixels=hash >>> 0
        }
        return {at:performance.now(),label:document.querySelector('#reader-location')?.getAttribute('aria-label'),
          text:layer ? [...layer.querySelectorAll('span')].map(span => span.textContent).join(' ').replace(/\s+/g,' ').trim() : null,
          pixels, width:canvas?.width,height:canvas?.height}
      }
      window.__pdfVisible=visible
      const highlight = () => [...(CSS.highlights?.get('inhouse-speech') || [])].map(range => range.toString()).join('')
      window.addEventListener('inhouse-tts', event => {
        const core=window.__pdfEngine?.core, player=core?.player
        const unit=core?.run?.entries.find(entry => entry.id === event.detail.id)
        const audio=player?.units.get(unit?.n)
        const entry={...event.detail,...visible(),audio:audio ? {now:player.now,start:audio.start,end:audio.end,
          started:audio.started,context:core.audio.context()?.state} : null}
        evidence.events.push(entry)
        // Registered before the reader's listener: this records the page on
        // arrival of the REAL audio event and the committed page after it.
        if(event.detail.type==='start') queueMicrotask(() => {
          entry.after={...visible(),highlight:highlight()}
        })
      })
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function(when,...rest) {
        const data=this.buffer.getChannelData(0)
        let peak=0,finite=true
        for(const value of data) { finite=finite && Number.isFinite(value); peak=Math.max(peak,Math.abs(value)) }
        evidence.pcm.push({...visible(),at:performance.now(),id:window.__pdfEngine?.core?.currentId,
          when:when || 0,now:this.context.currentTime,duration:this.buffer.duration,finite,peak})
        return start.call(this,when,...rest)
      }
      window.__recordPdfFrames = () => {
        const record=() => { evidence.frames.push(visible()); if(!window.__stopPdfFrames) requestAnimationFrame(record) }
        requestAnimationFrame(record)
      }
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak:()=>evidence.device++,cancel(){}}})
      window.InhouseSpeech={getVoices:()=> '[]',speak:()=>evidence.device++,stop(){}}
    },{base:mirror.base,id:ID})
    await page.goto(process.env.IHR_TEST_URL || './')
    await page.locator('#file-picker').setInputFiles({name:'speech-page-boundary.pdf',mimeType:'application/pdf',buffer:boundaryPDF()})
    await expect(page.locator('.pdf-text-layer')).toHaveText(PDF_PARTS[0])
    await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 2/)
    await page.getByRole('button',{name:'Escuchar el libro'}).click()
    await openAudioMenu(page,'Voz')
    await expect(page.locator(`[data-neural-voice="${ID}"]`)).toBeVisible()
    await page.locator(`[data-neural-voice="${ID}"]`).getByRole('button',{name:/Descargar la voz/}).click()
    await expect(page.locator(`[data-neural-voice="${ID}"]`)).toContainText('Instalada',{timeout:90_000})
    await page.evaluate(async () => {
      for(const url of performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/assets\/index-[\w-]+\.js$/.test(name))) {
        const module=await import(url)
        const facade=module.getNeuralEngine ? module : Object.values(module).find(value => typeof value?.getNeuralEngine==='function')
        if(!facade) continue
        const engine=window.__pdfEngine=facade.getNeuralEngine(), speak=engine.speak.bind(engine)
        const core=engine.core
        const observeClient=client => {
          const synth=client.synth.bind(client)
          client.synth=(request,handlers) => {
            const job={...request,at:performance.now(),visible:window.__pdfVisible(),currentId:core.currentId}
            window.__pdfSpeech.jobs.push(job)
            return synth(request,{...handlers,onChunk:chunk=>{
              job.chunkAt=performance.now();job.visibleAtChunk=window.__pdfVisible()
              return handlers.onChunk(chunk)
            },onEnd:()=>{job.doneAt=performance.now();return handlers.onEnd()}})
          }
          return client
        }
        if(core.client) observeClient(core.client)
        const createClient=core.createClient.bind(core)
        core.createClient=()=>observeClient(createClient())
        const extend=engine.extendUpcoming.bind(engine)
        engine.extendUpcoming=request=>{
          const preview={...request,at:performance.now(),visible:window.__pdfVisible()}
          window.__pdfSpeech.previews.push(preview)
          return preview.accepted=extend(request)
        }
        engine.speak=request => {
          window.__pdfSpeech.requests.push({...request,at:performance.now(),visible:window.__pdfVisible()})
          return speak(request)
        }
        window.__pdfSpeech.initial=window.__pdfVisible()
        window.__recordPdfFrames()
        return
      }
      throw new Error('The real engine loaded by the application was not observed')
    })
    await page.getByRole('button',{name:'Reproducir',exact:true}).click()
    await expect.poll(() => page.evaluate(() => window.__pdfSpeech.events.filter(event => event.type==='done').length),{timeout:90_000}).toBe(2)
    await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 2/)
    const evidence=await page.evaluate(() => { window.__stopPdfFrames=true; window.__pdfSpeech.stats={...window.__pdfEngine.stats}; return window.__pdfSpeech })
    await testInfo.attach('actual-pdf-audio-page-boundary',{body:JSON.stringify(evidence),contentType:'application/json'})
    expect(evidence.requests.map(request => request.text)).toEqual(PDF_PARTS)
    expect(evidence.requests.map(request => request.text).join(' ')).toBe(PDF_PARTS.join(' '))
    expect(evidence.requests.every(request => request.voiceId===ID)).toBe(true)
    const [first,second]=evidence.requests
    const firstStart=evidence.events.find(event => event.type==='start' && event.id===first.id)
    const done=evidence.events.find(event => event.type==='done' && event.id===first.id)
    const start=evidence.events.find(event => event.type==='start' && event.id===second.id)
    expect(done).toBeTruthy(); expect(start).toBeTruthy()
    expect(second.at).toBeGreaterThanOrEqual(done.at)
    expect(start.at).toBeGreaterThanOrEqual(second.at)
    const prepared=evidence.previews.find(preview=>preview.accepted && preview.upcoming.includes(PDF_PARTS[1]))
    expect(prepared).toBeTruthy()
    expect(prepared.at).toBeGreaterThanOrEqual(firstStart.at)
    expect(prepared.at).toBeLessThan(done.at)
    expect(prepared.deferAfter).toBe(0)
    const nextJob=evidence.jobs.find(job=>job.text===PDF_PARTS[1])
    expect(nextJob).toBeTruthy()
    expect(nextJob.currentId).toBe(first.id)
    expect(nextJob.at).toBeGreaterThanOrEqual(prepared.at)
    expect(nextJob.at).toBeLessThan(done.at)
    expect(nextJob.doneAt).toBeLessThan(done.at)
    expect(evidence.jobs.map(job=>job.text)).toEqual(PDF_PARTS)
    expect(evidence.stats.prefetchHits).toBe(1)
    // Detached preparation and cached PCM happen during the previous page's
    // real audio. No deferred sample reaches Web Audio before adoption, and
    // all mapped text/pixels stay on page one until the actual next start.
    const waiting=[prepared.visible,nextJob.visible,nextJob.visibleAtChunk,done,second.visible,start,
      ...evidence.frames.filter(frame => frame.at>=firstStart.at && frame.at<start.at)]
    expect(waiting.length).toBeGreaterThan(3)
    for(const frame of waiting) {
      expect(frame.label).toMatch(/Página 1 de 2/)
      expect(frame.text).toBe(PDF_PARTS[0])
      expect(frame.pixels).toBe(evidence.initial.pixels)
      expect([frame.width,frame.height]).toEqual([evidence.initial.width,evidence.initial.height])
    }
    expect(start.audio?.started).toBe(true)
    expect(start.audio.context).toBe('running')
    expect(start.audio.now).toBeGreaterThanOrEqual(start.audio.start)
    expect(start.audio.now).toBeLessThan(start.audio.end)
    expect(start.after.label).toMatch(/Página 2 de 2/)
    expect(start.after.text).toBe(PDF_PARTS[1])
    expect(start.after.pixels).not.toBe(evidence.initial.pixels)
    expect(start.after.highlight.replace(/\s+/g,'')).toBe(PDF_PARTS[1].replace(/\s+/g,''))
    expect(start.after.at-start.at).toBeLessThan(1000)
    const firstSecondPage=evidence.frames.find(frame => /Página 2 de 2/.test(frame.label))
    expect(firstSecondPage?.at).toBeGreaterThanOrEqual(start.at)
    expect(evidence.pcm.filter(chunk => chunk.id===second.id).length).toBeGreaterThan(0)
    expect(evidence.pcm.filter(chunk=>chunk.id===second.id).every(chunk=>chunk.at>=second.at)).toBe(true)
    expect(evidence.pcm.every(chunk => chunk.finite && chunk.peak>.05 && chunk.peak<=1)).toBe(true)
    expect(evidence.device).toBe(0)
    expect(evidence.events.filter(event => event.type==='error')).toEqual([])
    expect(errors).toEqual([])
  } finally { await mirror.close() }
})
