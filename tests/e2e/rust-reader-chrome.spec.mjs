import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
import {pickVoice} from './helpers/audio-menus.mjs'
const LESSAC='piper:en_US-lessac-medium'
test('compiled reader keeps audio controls and keyboard-aware panel geometry through Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({voices:neuralVoices.filter(voice=>voice.id===LESSAC),installed:[LESSAC],holdAfter:1}))
 await page.addInitScript(()=>{
  window.chromeProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.reader_create_chrome)return result
   window.chromeProof.available=true;const exports={...actual}
   for(const name of ['reader_create_chrome','reader_voice_state','reader_resize_panel','reader_reveal_field'])exports[name]=(...args)=>{window.chromeProof.calls[name]=(window.chromeProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await expect.poll(()=>page.evaluate(()=>window.chromeProof.available)).toBe(true)
 await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.getByRole('button',{name:'Escuchar el libro'}).click();await pickVoice(page,LESSAC)
 await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await expect(page.locator('[data-play]')).toHaveAttribute('aria-label','Pausar')
 await expect(page.locator('#reader-audio')).toHaveClass(/is-playing/)
 await page.locator('[data-play]').click();await expect(page.locator('[data-play]')).toHaveAttribute('aria-label','Continuar')
 await page.setViewportSize({width:390,height:540})
 await expect.poll(()=>page.locator('#reading-controls').evaluate(node=>node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(540)
 await expect.poll(()=>page.evaluate(()=>window.chromeProof.calls.reader_reveal_field||0)).toBeGreaterThan(0)
 const proof=await page.evaluate(()=>window.chromeProof)
 for(const name of ['reader_create_chrome','reader_voice_state','reader_resize_panel','reader_reveal_field'])expect(proof.calls[name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-reader-chrome',{body:JSON.stringify(proof),contentType:'application/json'})
})
