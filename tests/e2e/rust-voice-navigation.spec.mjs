import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {neuralVoices} from '../unit/helpers/reference-neural-catalog.js'
const LESSAC='piper:en_US-lessac-medium'
test('Rust keeps manual browsing separate from listening and seeks only after a hold',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({voices:neuralVoices.filter(v=>v.id===LESSAC),installed:[LESSAC],holdAfter:1}))
 await page.addInitScript(()=>{
  window.voiceNavigationProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.voice_browse)return result
   window.voiceNavigationProof.available=true;const exports={...actual}
   for(const name of ['voice_browse','voice_return_audio','voice_seek_point'])exports[name]=(...args)=>{window.voiceNavigationProof.calls[name]=(window.voiceNavigationProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await expect.poll(()=>page.evaluate(()=>window.voiceNavigationProof.available)).toBe(true)
 await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.getByRole('button',{name:'Escuchar el libro'}).click();await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(1)
 await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
 await page.getByRole('button',{name:'Página siguiente',exact:true}).click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 4/)
 expect(await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(1)
 await expect(page.locator('.reader-return')).toBeVisible();await page.locator('.reader-return').click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 expect(await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(1)
 await page.getByRole('button',{name:'Página siguiente',exact:true}).click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 4/)
 const box=await page.evaluate(()=>{
  const root=document.querySelector('.pdf-text-layer'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   const at=node.textContent.indexOf('Page 2');if(at<0)continue
   const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+6)
   const rect=range.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height}
  }
 });expect(box).toBeTruthy()
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up()
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(2)
 const request=await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.at(-1));expect(request.text).toContain('Page 2')
 const proof=await page.evaluate(()=>window.voiceNavigationProof)
 for(const name of ['voice_browse','voice_return_audio','voice_seek_point'])expect(proof.calls[name],name).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-voice-navigation',{body:JSON.stringify(proof),contentType:'application/json'})
})
