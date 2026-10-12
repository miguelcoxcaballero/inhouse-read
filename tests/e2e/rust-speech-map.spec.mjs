import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'

test('compiled mobile reader maps original nodes and highlights narration through Rust',async({page},info)=>{
 test.setTimeout(60000)
 await page.setViewportSize({width:320,height:640});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({installed:['piper:es_ES-davefx-medium'],holdAfter:2}))
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({fontSize:36,lineHeight:2.4,voice:'piper:es_ES-davefx-medium'}))
  window.textMapProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.speech_map)return result
   window.textMapProof.available=true;const exports={...actual}
   for(const name of ['speech_map','speech_range','speech_offset'])exports[name]=(...args)=>{window.textMapProof.calls[name]=(window.textMapProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/speech-page-boundary.epub')
 await expect(page.locator('foliate-view')).toBeVisible({timeout:45000})
 await page.getByRole('button',{name:'Escuchar el libro'}).click();await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBeGreaterThan(0)
 const proof=await page.evaluate(()=>window.textMapProof)
 expect(proof.available).toBe(true);for(const name of ['speech_map','speech_range','speech_offset'])expect(proof.calls[name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-text-map',{body:JSON.stringify(proof),contentType:'application/json'})
})
