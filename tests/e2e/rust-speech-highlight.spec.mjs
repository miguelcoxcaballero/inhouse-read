import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {longReflowPDF,PDF_REFLOW_SENTENCES} from './fixtures/pdf-reflow-navigation.mjs'
import {observeRustExports} from './helpers/rust-export-probe.mjs'
import {observeSpeechPaint} from './helpers/speech-paint-probe.mjs'

// The fifth sentence is held while it sounds: on this phone it lies below the first screen, so reaching it proves the
// reader followed the voice, not only that it painted where the page already was.
const HELD=5
test('compiled PDF narration paints and follows original text through Rust',async({page},info)=>{
 test.setTimeout(60000)
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(fakeEngineScript({installed:['piper:en_US-lessac-high'],holdAfter:HELD}))
 await page.addInitScript(()=>localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({pdfMode:'text',fontSize:36,margin:64,voice:'piper:en_US-lessac-high'})))
 // The handlers of a spoken source (clear, highlight, follow) are Rust closures bound in rust-ui pdf_sources.rs: the
 // page no longer calls pdf_speech_begin/highlight/follow as exports. What crosses the boundary by name is the
 // reader's dispatcher making the source; what the closures do is read from the page itself (speech-paint-probe).
 await observeRustExports(page,{store:'highlightProof',marker:'speech_paint',exports:['pdf_speech_begin','pdf_speech_highlight','pdf_speech_follow'],methods:{pdf_method:['getSpeechSource'],voice_method:['play']}})
 await observeSpeechPaint(page,{store:'paintProof'})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles({name:'Rust narration.pdf',mimeType:'application/pdf',buffer:longReflowPDF()})
 await expect(page.locator('.pdf-reflow-page')).toBeVisible({timeout:45000})
 await expect(page.locator('.pdf-reflow-page')).toContainText(PDF_REFLOW_SENTENCES.at(-1))
 const before=await page.locator('.pdf-reflow-page').textContent()
 expect(await page.locator('#reader-viewport').evaluate(element=>element.scrollTop)).toBe(0)
 await page.getByRole('button',{name:'Escuchar el libro'}).click();await page.getByRole('button',{name:'Reproducir',exact:true}).click()
 const painted=()=>page.evaluate(()=>[...(CSS.highlights.get('inhouse-speech')||[])].map(range=>range.toString()).join(''))
 await expect.poll(painted,{timeout:20000}).toBe(PDF_REFLOW_SENTENCES[HELD-1])
 const proof=await page.evaluate(()=>{
  const range=[...CSS.highlights.get('inhouse-speech')][0],rects=[...range.getClientRects()],viewport=document.querySelector('#reader-viewport'),bounds=viewport.getBoundingClientRect()
  return {exports:window.highlightProof,paint:window.paintProof,spoken:window.__inhouseNeuralTest.engine.calls.map(call=>call.text),styles:document.querySelectorAll('style[data-inhouse-speech]').length,
   css:document.querySelector('style[data-inhouse-speech]')?.textContent||'',scrollTop:viewport.scrollTop,inside:rects.length>0&&rects.every(rect=>rect.top>=bounds.top&&rect.bottom<=bounds.bottom),
   within:document.querySelector('.pdf-reflow-page').contains(range.commonAncestorContainer)}
 })
 // One Rust UI instance; it made the source and started the voice.
 expect(proof.exports.available).toBe(true);expect(proof.exports.instances).toBe(1)
 expect(proof.exports.calls['pdf_method:getSpeechSource']).toBeGreaterThan(0);expect(proof.exports.calls['voice_method:play']).toBeGreaterThan(0)
 // No JavaScript handler stands between the audiobook and the painting any more.
 for(const name of ['pdf_speech_begin','pdf_speech_highlight','pdf_speech_follow'])expect(proof.exports.calls[name]||0,name).toBe(0)
 // pdf_speech_begin installed the one style; pdf_speech_highlight cleared and painted each spoken sentence, in order,
 // over the page's own text; every one of those calls came out of the Rust UI module.
 expect(proof.styles).toBe(1);expect(proof.css).toContain('::highlight(inhouse-speech)')
 const paints=proof.paint.paints.filter(paint=>paint.key==='inhouse-speech')
 // A re-mapped layer may repaint the sentence it is on: the order of distinct sentences is what narration fixes.
 expect(paints.map(paint=>paint.text).filter((text,index,all)=>text!==all[index-1])).toEqual(PDF_REFLOW_SENTENCES.slice(0,HELD));expect(proof.spoken).toEqual(PDF_REFLOW_SENTENCES.slice(0,HELD))
 for(const paint of paints)expect(paint.native,paint.text).toMatch(/^inhouse_read_ui_bg/)
 const clears=proof.paint.clears.filter(clear=>clear.key==='inhouse-speech')
 expect(clears.length).toBeGreaterThanOrEqual(paints.length);for(const clear of clears)expect(clear.native).toMatch(/^inhouse_read_ui_bg/)
 expect(proof.within).toBe(true)
 // pdf_speech_follow scrolled the reader from Rust until the held sentence was wholly on screen.
 const follows=proof.paint.follows.filter(follow=>follow.id==='reader-viewport')
 expect(follows.length).toBeGreaterThan(0);for(const follow of follows){expect(follow.native).toMatch(/^inhouse_read_ui_bg/);expect(follow.top).toBeGreaterThan(0);expect(follow.behavior).toBe('instant')}
 expect(proof.scrollTop).toBeGreaterThan(0);expect(proof.inside).toBe(true)
 expect(await page.locator('.pdf-reflow-page').textContent()).toBe(before)
 expect(errors).toEqual([]);await info.attach('compiled-highlight',{body:JSON.stringify(proof),contentType:'application/json'})
})
