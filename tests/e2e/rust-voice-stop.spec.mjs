import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
import {pickVoice} from './helpers/audio-menus.mjs'
const LESSAC='piper:en_US-lessac-medium'
test('compiled audiobook preserves interruption and speed-change order through Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({voices:neuralVoices.filter(voice=>voice.id===LESSAC),installed:[LESSAC],holdAfter:1}))
 await page.addInitScript(()=>{
  window.voiceStopProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.voice_stop)return result
   window.voiceStopProof.available=true;const exports={...actual}
   for(const name of ['voice_pause','voice_stop','voice_cancel','voice_restart','voice_retry'])exports[name]=(...args)=>{window.voiceStopProof.calls[name]=(window.voiceStopProof.calls[name]||0)+1;return actual[name](...args)}
   // These members reach their Rust implementations through the class dispatchers (rustMethods): read each
   // dispatched member's name from the call and count it as the implementation it runs.
   const dispatched={"voice_method":{"retryNeural":"voice_retry","restart":"voice_restart","cancelUtterance":"voice_cancel","pause":"voice_pause","stop":"voice_stop"}};for(const dispatch in dispatched)if(actual[dispatch])exports[dispatch]=(...args)=>{const name=dispatched[dispatch][new TextDecoder().decode(new Uint8Array(actual.memory.buffer,args[2],args[3]))];if(name)window.voiceStopProof.calls[name]=(window.voiceStopProof.calls[name]||0)+1;return actual[dispatch](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await expect.poll(()=>page.evaluate(()=>window.voiceStopProof.available)).toBe(true)
 await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.getByRole('button',{name:'Escuchar el libro'}).click();await pickVoice(page,LESSAC)
 await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(1)
 await expect(page.locator('[data-play]')).toHaveAttribute('aria-label','Pausar')
 await page.getByRole('radio',{name:'1,5×',exact:true}).check()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(2)
 const requests=await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls)
 expect(requests[1].rate).toBe(1.5);expect(requests[1].text).toBe(requests[0].text)
 await page.locator('[data-play]').click();await expect(page.locator('[data-play]')).toHaveAttribute('aria-label','Continuar')
 await page.locator('[data-play]').click();await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(3)
 await page.getByRole('button',{name:'Detener',exact:true}).click()
 await expect(page.locator('[data-play]')).toHaveAttribute('aria-label','Reproducir')
 await expect(page.locator('#reader-audio')).not.toHaveClass(/is-playing/)
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 const proof=await page.evaluate(()=>window.voiceStopProof)
 for(const name of ['voice_pause','voice_stop','voice_cancel','voice_restart','voice_retry'])expect(proof.calls[name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-voice-stop',{body:JSON.stringify(proof),contentType:'application/json'})
})
