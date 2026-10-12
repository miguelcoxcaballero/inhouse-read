import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
import {pickVoice} from './helpers/audio-menus.mjs'
const LESSAC='piper:en_US-lessac-medium'

test('a delayed Rust download preserves the existing voice session and adopts later playback without reinitializing it',async({page},info)=>{
 test.setTimeout(60000)
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({voices:neuralVoices.filter(voice=>voice.id===LESSAC),installed:[LESSAC],holdAfter:1}))
 await page.addInitScript(()=>{
  window.voiceSessionProof={available:false,initializations:0,plays:0}
  const observe=result=>{
   const instance=result.instance||result,actual=instance.exports;if(!actual.voice_initialize)return result
   window.voiceSessionProof.available=true
   const exports={...actual,voice_initialize:(...args)=>{window.voiceSessionProof.initializations++;return actual.voice_initialize(...args)},voice_play:(...args)=>{window.voiceSessionProof.plays++;return actual.voice_play(...args)}}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}})
   return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 let release;const gate=new Promise(resolve=>{release=resolve})
 await page.route(/inhouse_read_ui_bg-.*\.wasm$/,async route=>{await gate;await route.continue()})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 try{
  await page.goto(process.env.IHR_TEST_URL||'./')
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
  expect(await page.evaluate(()=>window.voiceSessionProof)).toEqual({available:false,initializations:0,plays:0})
  await page.locator('#reader-location').click();await page.getByRole('spinbutton',{name:'Ir a la página'}).fill('3');await page.getByRole('button',{name:'Ir',exact:true}).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 3 de 4/)
  release();await expect.poll(()=>page.evaluate(()=>window.voiceSessionProof.available)).toBe(true)
  await page.getByRole('button',{name:'Escuchar el libro'}).click();await pickVoice(page,LESSAC)
  await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBe(1)
  const first=await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls[0])
  expect(first.text).toBe('Reading journey.')
  expect(first.upcoming.map(item=>typeof item==='string'?item:item.text).join(' ')).toContain('Page 3')
  const proof=await page.evaluate(()=>window.voiceSessionProof)
  expect(proof.initializations).toBe(0);expect(proof.plays).toBe(1)
  expect(errors).toEqual([]);await info.attach('late-voice-session',{body:JSON.stringify(proof),contentType:'application/json'})
 }finally{release()}
})
