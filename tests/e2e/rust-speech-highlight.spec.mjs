import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {longReflowPDF,PDF_REFLOW_SENTENCES} from './fixtures/pdf-reflow-navigation.mjs'

test('compiled PDF narration paints and follows original text through Rust',async({page},info)=>{
 test.setTimeout(60000)
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({installed:['piper:en_US-lessac-high'],holdAfter:1}))
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({pdfMode:'text',fontSize:36,margin:64,voice:'piper:en_US-lessac-high'}))
  window.highlightProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.speech_paint)return result
   window.highlightProof.available=true;const exports={...actual}
   // The PDF speech source now does this work behind three exports of its own: pdf_speech_begin installs the style,
   // pdf_speech_highlight clears and paints the sentence, pdf_speech_follow keeps it on screen. speech_style/paint/
   // clear/follow are called from inside Rust, so they can no longer be counted at the boundary.
   for(const name of ['pdf_speech_begin','pdf_speech_highlight','pdf_speech_follow'])exports[name]=(...args)=>{window.highlightProof.calls[name]=(window.highlightProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles({name:'Rust narration.pdf',mimeType:'application/pdf',buffer:longReflowPDF()})
 await expect(page.locator('.pdf-reflow-page')).toBeVisible({timeout:45000})
 await expect(page.locator('.pdf-reflow-page')).toContainText(PDF_REFLOW_SENTENCES.at(-1))
 const before=await page.locator('.pdf-reflow-page').textContent()
 await page.getByRole('button',{name:'Escuchar el libro'}).click();await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.highlightProof.calls.pdf_speech_highlight||0)).toBeGreaterThan(0)
 const proof=await page.evaluate(()=>({proof:window.highlightProof,styles:document.querySelectorAll('style[data-inhouse-speech]').length,range:[...CSS.highlights.get('inhouse-speech')].map(r=>r.toString()).join('')}))
 expect(proof.proof.available).toBe(true);for(const name of ['pdf_speech_begin','pdf_speech_highlight','pdf_speech_follow'])expect(proof.proof.calls[name],name).toBeGreaterThan(0)
 expect(proof.styles).toBe(1);expect(proof.range.length).toBeGreaterThan(0);expect(await page.locator('.pdf-reflow-page').textContent()).toBe(before)
 expect(errors).toEqual([]);await info.attach('compiled-highlight',{body:JSON.stringify(proof),contentType:'application/json'})
})
