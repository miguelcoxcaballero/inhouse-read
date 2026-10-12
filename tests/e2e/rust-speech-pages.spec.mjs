import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'

test('compiled mobile narration measures real page glyphs through Rust and retains cross-page marks',async({page},info)=>{
 test.setTimeout(60000)
 await page.setViewportSize({width:320,height:640});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({installed:['piper:es_ES-davefx-medium'],holdAfter:1}))
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({fontSize:36,lineHeight:2.4,voice:'piper:es_ES-davefx-medium'}))
  window.pageCutsProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.rustspeechpages_new)return result
   window.pageCutsProof.available=true;const exports={...actual}
   for(const name of ['rustspeechpages_new','rustspeechpages_step','rustspeechpages_result'])exports[name]=(...args)=>{window.pageCutsProof.calls[name]=(window.pageCutsProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/speech-page-boundary.epub')
 await expect(page.locator('foliate-view')).toBeVisible({timeout:45000});await page.getByRole('button',{name:'Escuchar el libro'}).click();await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBeGreaterThan(0)
 const result=await page.evaluate(()=>({proof:window.pageCutsProof,utterance:window.__inhouseNeuralTest.engine.calls[0]}))
 expect(result.proof.available).toBe(true);for(const name of ['new','step','result'])expect(result.proof.calls['rustspeechpages_'+name]).toBeGreaterThan(0)
 expect(result.utterance.marks.length).toBeGreaterThan(0);expect(errors).toEqual([])
 await info.attach('compiled-page-cuts',{body:JSON.stringify(result),contentType:'application/json'})
})
