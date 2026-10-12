import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
import {pickVoice} from './helpers/audio-menus.mjs'
const LESSAC='piper:en_US-lessac-medium'
test('compiled audiobook starts and resumes at the newly visible page through Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({voices:neuralVoices.filter(voice=>voice.id===LESSAC),installed:[LESSAC],holdAfter:1}))
 await page.addInitScript(()=>{
  window.voiceStartProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.voice_play)return result
   window.voiceStartProof.available=true;const exports={...actual}
   for(const name of ['voice_play','voice_restart_visible'])exports[name]=(...args)=>{window.voiceStartProof.calls[name]=(window.voiceStartProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await expect.poll(()=>page.evaluate(()=>window.voiceStartProof.available)).toBe(true)
 await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.getByRole('button',{name:'Escuchar el libro'}).click();await pickVoice(page,LESSAC)
 await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(1)
 const first=await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls[0]);expect(first.text).toBe('Reading journey.')
 expect(first.upcoming.map(item=>typeof item==='string'?item:item.text).join(' ')).toContain('Page 1')
 await expect(page.locator('[data-play]')).toHaveAttribute('aria-label','Pausar');await page.locator('[data-play]').click()
 await expect(page.locator('[data-play]')).toHaveAttribute('aria-label','Continuar')
 await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
 await page.locator('#reader-location').click();await page.getByRole('spinbutton',{name:'Ir a la página'}).fill('3');await page.getByRole('button',{name:'Ir',exact:true}).click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 3 de 4/)
 expect(await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(1)
 await page.getByRole('button',{name:'Escuchar el libro'}).click();await page.locator('[data-play]').click()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(2)
 const resumed=await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls[1]);expect(resumed.text).toBe('Reading journey.')
 const upcoming=resumed.upcoming.map(item=>typeof item==='string'?item:item.text).join(' ')
 expect(upcoming).toContain('Page 3');expect(upcoming).not.toContain('Page 1')
 const proof=await page.evaluate(()=>window.voiceStartProof)
 for(const name of ['voice_play','voice_restart_visible'])expect(proof.calls[name]).toBeGreaterThanOrEqual(2)
 expect(errors).toEqual([]);await info.attach('compiled-voice-start',{body:JSON.stringify(proof),contentType:'application/json'})
})
