import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
import {pickLanguage,selectedOption} from './helpers/audio-menus.mjs'
const LESSAC='piper:en_US-lessac-medium',DAVEFX='piper:es_ES-davefx-medium'
test('compiled audiobook selects the installed language and builds lookahead through Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({voices:neuralVoices.filter(voice=>[LESSAC,DAVEFX].includes(voice.id)),installed:[LESSAC,DAVEFX],holdAfter:1}))
 await page.addInitScript(()=>{
  window.voiceSelectionProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.voice_for)return result
   window.voiceSelectionProof.available=true;const exports={...actual}
   for(const name of ['voice_for','voice_upcoming','voice_audio_item','voice_needs_join'])exports[name]=(...args)=>{window.voiceSelectionProof.calls[name]=(window.voiceSelectionProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await expect.poll(()=>page.evaluate(()=>window.voiceSelectionProof.available)).toBe(true)
 await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.getByRole('button',{name:'Escuchar el libro'}).click();await pickLanguage(page,'es')
 await expect(selectedOption(page)).toHaveAttribute('data-value','')
 await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(1)
 const first=await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls[0]);expect(first.voiceId).toBe(DAVEFX)
 expect(first.text).toBe('Reading journey.');expect(first.upcoming.map(item=>typeof item==='string'?item:item.text).join(' ')).toContain('Page 1')
 await expect(page.locator('[data-play]')).toHaveAttribute('aria-label','Pausar');await page.locator('[data-play]').click()
 await pickLanguage(page,'en');await expect(selectedOption(page)).toHaveAttribute('data-value','')
 await page.locator('[data-play]').click();await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(2)
 const next=await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls[1]);expect(next.voiceId).toBe(LESSAC);expect(next.text).toBe(first.text)
 const proof=await page.evaluate(()=>window.voiceSelectionProof)
 for(const name of ['voice_for','voice_upcoming','voice_audio_item','voice_needs_join'])expect(proof.calls[name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-voice-selection',{body:JSON.stringify(proof),contentType:'application/json'})
})
