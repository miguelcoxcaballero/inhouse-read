import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
import {pickVoice,pickLanguage,selectedOption,openAudioMenu} from './helpers/audio-menus.mjs'
const LESSAC='piper:en_US-lessac-medium',ALBA='piper:en_GB-alba-medium',DAVEFX='piper:es_ES-davefx-medium'
test('compiled reader keeps language selection and installed natural voice menus in Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({voices:neuralVoices.filter(voice=>[LESSAC,ALBA,DAVEFX].includes(voice.id)),installed:[LESSAC,DAVEFX],manual:true,holdAfter:1}))
 await page.addInitScript(()=>{
  window.voiceFlowProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.reader_populate_voices)return result
   window.voiceFlowProof.available=true;const exports={...actual}
   for(const name of ['reader_book_language','reader_choose_language','reader_voice_base','reader_populate_voices'])exports[name]=(...args)=>{window.voiceFlowProof.calls[name]=(window.voiceFlowProof.calls[name]||0)+1;return actual[name](...args)}
   // These members reach their Rust implementations through the class dispatchers (rustMethods): read each
   // dispatched member's name from the call and count it as the implementation it runs.
   const dispatched={"flow_method":{"bookLanguage":"reader_book_language","chooseLanguage":"reader_choose_language","voiceBase":"reader_voice_base","populateVoices":"reader_populate_voices"}};for(const dispatch in dispatched)if(actual[dispatch])exports[dispatch]=(...args)=>{const name=dispatched[dispatch][new TextDecoder().decode(new Uint8Array(actual.memory.buffer,args[2],args[3]))];if(name)window.voiceFlowProof.calls[name]=(window.voiceFlowProof.calls[name]||0)+1;return actual[dispatch](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.getByRole('button',{name:'Escuchar el libro'}).click()
 await pickVoice(page,LESSAC);await expect(selectedOption(page)).toHaveAttribute('data-value',LESSAC)
 await pickLanguage(page,'es');await expect(selectedOption(page)).toHaveAttribute('data-value','')
 await pickVoice(page,DAVEFX);await expect(selectedOption(page)).toHaveAttribute('data-value',DAVEFX)
 await pickLanguage(page,'en');await expect(selectedOption(page)).toHaveAttribute('data-value','')
 await openAudioMenu(page,'Voz');const alba=page.locator(`[data-neural-voice="${ALBA}"]`)
 await alba.getByRole('button',{name:/Descargar la voz Alba/}).click()
 await expect(alba.getByRole('progressbar')).toHaveAttribute('aria-valuenow','0')
 await page.evaluate(id=>window.__inhouseNeuralTest.engine.finish(id),ALBA)
 await expect(selectedOption(page)).toHaveAttribute('data-value',ALBA)
 await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBeGreaterThan(0)
 expect(await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls[0].voiceId)).toBe(ALBA)
 const proof=await page.evaluate(()=>window.voiceFlowProof);expect(proof.available).toBe(true)
 for(const name of ['reader_book_language','reader_choose_language','reader_voice_base','reader_populate_voices'])expect(proof.calls[name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-voice-flow',{body:JSON.stringify(proof),contentType:'application/json'})
})
