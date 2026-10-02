import { test, expect } from '@playwright/test'
import { startHuggingFaceMirror, haveVoice } from './helpers/hf-mirror.mjs'
import { openAudioMenu } from './helpers/audio-menus.mjs'

const MODEL = 'es_ES-davefx-medium', ID = `piper:${MODEL}`
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
