import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {observeDurationKernel,durationKernelProof} from './helpers/duration-kernel-proof.mjs'
import { test, expect } from '@playwright/test'
import { startHuggingFaceMirror, haveVoice } from './helpers/hf-mirror.mjs'
import { openAudioMenu } from './helpers/audio-menus.mjs'

const MODEL = 'es_ES-davefx-medium', ID = `piper:${MODEL}`

// Public HTTPS pages cannot fetch a loopback fixture server under Chromium's
// local-network policy. Route only model downloads through the test transport;
// application/WASM bytes still come from the published site, and these remain
// the same real ONNX weights used by local verification.
async function fixtureBase(page,mirror){
  if(!process.env.IHR_TEST_URL)return mirror.base
  const base='https://huggingface.co/rhasspy/piper-voices/resolve/main/'
  await page.route(`${base}**`,async route=>{
    const response=await route.fetch({url:mirror.base+route.request().url().slice(base.length)})
    await route.fulfill({response})
  })
  return base
}

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
    const base=await fixtureBase(page,mirror)
    await page.setViewportSize({width:320,height:640})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.addInitScript(({base, id}) => {
      window.INHOUSE_NEURAL_VOICE_BASE = base
      localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({fontSize:36,lineHeight:2.4,voice:id}))
      const evidence = window.__pageSpeech = {requests:[],starts:[],boundaries:[],turns:[],pcm:[],device:0}
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
        if (event.detail.type === 'boundary') evidence.boundaries.push({...event.detail,at:performance.now()})
      })
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function(...args) {
        const data = this.buffer.getChannelData(0)
        evidence.pcm.push({finite:data.every(Number.isFinite), peak:data.reduce((best,x) => Math.max(best, Math.abs(x)),0)})
        return start.apply(this,args)
      }
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak:()=>evidence.device++,cancel(){}}})
      window.InhouseSpeech={getVoices:()=> '[]',speak:()=>evidence.device++,stop(){}}
    },{base,id:ID})
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
    await expect.poll(() => page.evaluate(() => window.__pageSpeech.boundaries.length),{timeout:90_000}).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => window.__pageSpeech.turns.filter(turn => turn.offset > 0).length),{timeout:10_000}).toBeGreaterThan(0)
    await page.getByRole('button',{name:'Pausar',exact:true}).click()
    const evidence = await page.evaluate(() => window.__pageSpeech)
    await testInfo.attach('actual-audio-page-boundary',{body:JSON.stringify(evidence),contentType:'application/json'})
    expect(evidence.requests).toHaveLength(1)
    expect(evidence.requests[0].text).toBe('Esta frase empieza en la primera página y sigue en la siguiente mientras la voz lee cada palabra sin repetir ni perder ninguna parte del texto.')
    const start = evidence.boundaries[0]
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

for(const multilingual of [false,true])test('PDF mantiene la página anterior durante la preparación y cambia al PCM audible de la continuación'+(multilingual?' con detección de idioma Rust':''), async ({page}, testInfo) => {
  test.setTimeout(180_000)
  expect(haveVoice(MODEL), 'real Davefx model must be available').toBe(true)
  const mirror = await startHuggingFaceMirror({voices:[MODEL], sliceMs:0})
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  // This first variant observes the compiled worker over the network. The
  // multilingual variant retains the original service-worker/cache path;
  // Chromium can serve its worker outside Playwright routing (trace retained).
  if(!multilingual)await observeDurationKernel(page)
  try {
    const base=await fixtureBase(page,mirror)
    await page.setViewportSize({width:390,height:844})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.addInitScript(({base, id, multilingual}) => {
      window.INHOUSE_NEURAL_VOICE_BASE = base
      localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify({voice:id,voiceLang:'es',multilingual}))
      const evidence = window.__pdfSpeech = {requests:[],events:[],frames:[],pcm:[],jobs:[],previews:[],device:0}
      evidence.rustJoin={available:false,calls:0,preparations:0,presentations:0,adoptions:0,starts:0,plans:0,opening:0,dispatches:0,synthesis:0,advances:0,sessions:0,sessionEvents:0,textPlans:0,warmContexts:0,attachments:0,warmUps:0,installStarts:0,installCompletions:0,pickerClicks:0,availability:0,offers:0,languages:0,pickerRenders:0,voiceOrders:0,voiceRecommendations:0,sentenceEnds:0,speechPlans:0,speechPipelines:0}
      const observe=result=>{
        const instance=result.instance||result,actual=instance.exports
        if(!actual.voice_join_sentence)return result
        evidence.rustJoin.available=true
        const exports={...actual,voice_join_sentence:(...args)=>{evidence.rustJoin.calls++;return actual.voice_join_sentence(...args)}}
        for(const [name,key] of [['voice_prepare_ahead','preparations'],['voice_adopt_plan','adoptions'],['voice_present','presentations'],['voice_engine_started','starts'],['voice_prepare','plans'],['voice_prepare_opening','opening'],['voice_speak_current','dispatches'],['voice_speak_neural','synthesis'],['voice_advance','advances'],['voice_initialize','sessions'],['voice_event','sessionEvents'],['voice_prepare_text','textPlans'],['picker_warm_context','warmContexts'],['picker_attach','attachments'],['picker_warm_up','warmUps'],['picker_install_begin','installStarts'],['picker_install_done','installCompletions'],['picker_click','pickerClicks'],['picker_state','availability'],['picker_offer_for','offers'],['detect_voice_language','languages'],['rustneuralview_renderPicker','pickerRenders'],['voice_order','voiceOrders'],['voice_recommended','voiceRecommendations'],['speech_sentence_ends','sentenceEnds'],['speech_plan','speechPlans'],['speech_pipeline','speechPipelines']]){
          if(actual[name])exports[name]=(...args)=>{evidence.rustJoin[key]++;return actual[name](...args)}
        }
        const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}})
        return result.instance?{...result,instance:proxy}:proxy
      }
      for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
        const original=WebAssembly[name]
        WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}
      }
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
        if(event.detail.type==='start'||event.detail.type==='boundary') queueMicrotask(() => {
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
    },{base,id:ID,multilingual})
    await openCompiledReaderApp(page)
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
    await expect.poll(() => page.evaluate(() => window.__pdfSpeech.events.filter(event => event.type==='done').length),{timeout:90_000}).toBe(1)
    await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 2/)
    const evidence=await page.evaluate(() => { window.__stopPdfFrames=true; window.__pdfSpeech.stats={...window.__pdfEngine.stats}; return window.__pdfSpeech })
    await testInfo.attach('actual-pdf-audio-page-boundary',{body:JSON.stringify(evidence),contentType:'application/json'})
    expect(evidence.requests.map(request => request.text)).toEqual([PDF_PARTS.join(' ')])
    expect(evidence.rustJoin.available).toBe(true)
    expect(evidence.rustJoin.calls).toBeGreaterThan(0)
    expect(evidence.rustJoin.preparations).toBeGreaterThan(0)
    expect(evidence.rustJoin.adoptions).toBeGreaterThan(0)
    expect(evidence.rustJoin.presentations).toBeGreaterThan(0)
    expect(evidence.rustJoin.starts).toBeGreaterThan(0)
    expect(evidence.rustJoin.plans).toBeGreaterThan(0)
    expect(evidence.rustJoin.opening).toBeGreaterThan(0)
    expect(evidence.rustJoin.dispatches).toBeGreaterThan(0)
    expect(evidence.rustJoin.synthesis).toBeGreaterThan(0)
    expect(evidence.rustJoin.advances).toBeGreaterThan(0)
    expect(evidence.rustJoin.sessions).toBeGreaterThan(0)
    expect(evidence.rustJoin.sessionEvents).toBeGreaterThan(0)
    expect(evidence.rustJoin.warmContexts).toBeGreaterThan(0)
    expect(evidence.rustJoin.attachments).toBeGreaterThan(0)
    expect(evidence.rustJoin.warmUps).toBeGreaterThan(0)
    expect(evidence.rustJoin.installStarts).toBeGreaterThan(0)
    expect(evidence.rustJoin.installCompletions).toBeGreaterThan(0)
    expect(evidence.rustJoin.pickerClicks).toBeGreaterThan(0)
    // Availability and offers are now direct Rust calls owned by the view;
    // observe its public entrypoint instead of requiring nested JS round trips.
    expect(evidence.rustJoin.pickerRenders).toBeGreaterThan(0)
    expect(evidence.rustJoin.voiceOrders).toBeGreaterThan(0)
    expect(evidence.rustJoin.voiceRecommendations).toBeGreaterThan(0)
    // Cleanup and sentence planning now run inside one raw-to-plan native call.
    expect(evidence.rustJoin.speechPipelines).toBeGreaterThan(0)
    if(multilingual)expect(evidence.rustJoin.languages).toBeGreaterThan(0)
    // PDF's prepared speech items retain their original offsets and bypass the
    // plain-text cleaner. Its compiled path is checked by the text parity suite.
    const [first]=evidence.requests
    const firstStart=evidence.events.find(event=>event.type==='start'&&event.id===first.id)
    const done=evidence.events.find(event=>event.type==='done'&&event.id===first.id)
    const start=evidence.events.find(event=>event.type==='boundary'&&event.id===first.id)
    expect(done).toBeTruthy();expect(start).toBeTruthy()
    expect(start.at).toBeGreaterThan(firstStart.at);expect(start.at).toBeLessThan(done.at)
    expect(start.offset).toBe(PDF_PARTS[0].length+1)
    expect(evidence.pcm).toHaveLength(1)
    expect(evidence.jobs.filter(job=>job.text===PDF_PARTS.join(' '))).toHaveLength(1)
    // Every visible frame stays on the old physical sheet until this marker
    // inside the SAME synthesized waveform reaches the output audio clock.
    const waiting=evidence.frames.filter(frame=>frame.at>=firstStart.at&&frame.at<start.at)
    expect(waiting.length).toBeGreaterThan(3)
    for(const frame of waiting){
      expect(frame.label).toMatch(/Página 1 de 2/)
      expect(frame.text).toBe(PDF_PARTS[0]);expect(frame.pixels).toBe(evidence.initial.pixels)
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
    if(!multilingual){const durations=await durationKernelProof(page);expect(durations).toBeTruthy();expect(durations.instances).toBe(1);expect(durations.calls).toBeGreaterThan(0)
      await testInfo.attach('compiled-duration-marks',{body:JSON.stringify(durations),contentType:'application/json'})}
    const firstSecondPage=evidence.frames.find(frame => /Página 2 de 2/.test(frame.label))
    expect(firstSecondPage?.at).toBeGreaterThanOrEqual(start.at)
    expect(evidence.pcm.every(chunk => chunk.finite && chunk.peak>.05 && chunk.peak<=1)).toBe(true)
    expect(evidence.device).toBe(0)
    expect(evidence.events.filter(event => event.type==='error')).toEqual([])
    expect(errors).toEqual([])
  } finally { await mirror.close() }
})
