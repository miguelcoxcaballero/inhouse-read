import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {longReflowPDF} from './fixtures/pdf-reflow-navigation.mjs'

test('a slow Rust download releases the reader then serves the next operation without reinitializing',async({page},info)=>{
 test.setTimeout(60000);await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({installed:['piper:en_US-lessac-high'],holdAfter:1}))
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({pdfMode:'text',voice:'piper:en_US-lessac-high'}))
  window.lateRust={instances:0,paints:0,maps:0}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.speech_paint)return result
   window.lateRust.instances++;const exports={...actual}
   exports.speech_paint=(...args)=>{window.lateRust.paints++;return actual.speech_paint(...args)}
   exports.speech_map=(...args)=>{window.lateRust.maps++;return actual.speech_map(...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 let release;const gate=new Promise(resolve=>{release=resolve});let requests=0
 await page.route(/inhouse_read_ui_bg.*\.wasm/,async route=>{requests++;await gate;await route.continue()})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 try{
  await page.goto(process.env.IHR_TEST_URL||'./')
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/speech-page-boundary.epub')
  await expect(page.locator('foliate-view')).toBeVisible({timeout:30000})
  await expect(page.getByRole('button',{name:'Escuchar el libro'})).toBeEnabled()
  expect(await page.evaluate(()=>window.lateRust.instances)).toBe(0);expect(requests).toBe(1)
  release();await expect.poll(()=>page.evaluate(()=>window.lateRust.instances)).toBe(1)
  await page.locator('#file-picker').setInputFiles({name:'Next Rust PDF.pdf',mimeType:'application/pdf',buffer:longReflowPDF()})
  await expect(page.locator('.pdf-reflow-page')).toBeVisible({timeout:30000})
  await page.getByRole('button',{name:'Escuchar el libro'}).click();await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.lateRust.paints)).toBeGreaterThan(0)
  const proof=await page.evaluate(()=>window.lateRust)
  expect(proof.instances).toBe(1);expect(proof.maps).toBeGreaterThan(0);expect(requests).toBe(1);expect(errors).toEqual([])
  await info.attach('late-module-adoption',{body:JSON.stringify(proof),contentType:'application/json'})
 }finally{release()}
})
