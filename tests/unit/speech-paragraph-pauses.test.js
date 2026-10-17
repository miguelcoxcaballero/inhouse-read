import {expect,it} from 'vitest'
import './helpers/rust-ui-ready.js'
import {mapSpeechText} from '../../src/js/readers/speech-map.js'
import {normalizeSpeech,planSpeech} from '../../src/js/readers/speech-text.js'
import {finishPiper,finishSupertonic} from '../../src/js/readers/neural-voice/synth-flow.js'
const map=html=>{const doc=new DOMParser().parseFromString(html,'text/html');return mapSpeechText(doc.body)}
it('pauses after titles written as ordinary paragraphs or divs without adding visible punctuation',()=>{
 const source=map('<p class="title">El arte de gobernar</p><p>Para jóvenes políticos y otros</p><div>Lee, escucha y mira</div><p>Conviene aprender.</p>')
 const items=planSpeech(source.text)
 expect(items.map(item=>item.text)).toEqual(['El arte de gobernar.','Para jóvenes políticos y otros.','Lee, escucha y mira.','Conviene aprender.'])
 expect(items.map(item=>source.rangeFor(item.start,item.end).toString())).toEqual(['El arte de gobernar','Para jóvenes políticos y otros','Lee, escucha y mira','Conviene aprender.'])
})
it.each(['\n\n','\r\n\r\n','\r\r','\n \t\n','\u2028\u2028'])('pauses on an extracted blank paragraph, %j, retaining source offsets',separator=>{
 const raw='Título sin punto'+separator+'Después comienza otro párrafo'
 const cleaned=normalizeSpeech(raw),items=planSpeech(raw)
 expect(cleaned.text).toBe('Título sin punto. Después comienza otro párrafo')
 expect(items.map(item=>item.text)).toEqual(['Título sin punto.','Después comienza otro párrafo'])
 expect(cleaned.map[cleaned.text.indexOf('Después')]).toBe(raw.indexOf('Después'))
 expect(items[1].start).toBe(raw.indexOf('Después'))
})
it('keeps ordinary wrapping and a physical page boundary inside a paragraph continuous',()=>{
 const source=map('<p>La frase comienza<br>y sigue en la misma oración sin interrumpirse.</p>')
 expect(planSpeech(source.text).map(item=>item.text)).toEqual(['La frase comienza y sigue en la misma oración sin interrumpirse.'])
 const raw='La frase comienza\ny sigue en la misma oración sin interrumpirse.'
 const pages=planSpeech(raw,{pageBreaks:[raw.indexOf('y sigue')]})
 expect(pages.map(item=>item.text).join(' ')).toBe('La frase comienza y sigue en la misma oración sin interrumpirse.')
 expect(normalizeSpeech('Una línea\r\ncontinúa.').text).toBe('Una línea continúa.')
})
it('generates a real punctuation rest for both Piper and Supertonic after an unpunctuated paragraph',()=>{
 const source=map('<p>Título sin punto</p><p>Después seguimos.</p>'),text=planSpeech(source.text)[0].text
 const raw=new Float32Array(100).fill(.1),sampleRate=1000
 const piper=finishPiper(raw,null,[],text,{sampleRate,model:'es_ES-davefx-medium',rate:1,base:0,count:1,last:true,first:true})
 const supertonic=finishSupertonic(raw,text,[],{sampleRate,rate:1})
 for(const result of [piper,supertonic]){
  expect(result.pcm.length).toBeGreaterThanOrEqual(340)
  expect([...result.pcm.slice(-240)].every(sample=>sample===0)).toBe(true)
 }
})

it('does not turn collapsed HTML source whitespace into an audible paragraph',()=>{
 const source=map('<p>Primera línea\n\ncontinúa dentro del mismo párrafo</p><p>Después otro</p>');
 expect(planSpeech(source.text).map(item=>item.text)).toEqual(['Primera línea continúa dentro del mismo párrafo.','Después otro']);
 expect(source.rangeFor(source.text.indexOf('continúa'),source.text.indexOf('continúa')+8).toString()).toBe('continúa');
})
it.each(['pre','pre-wrap','pre-line','break-spaces'])('retains actual preserved paragraph breaks with CSS %s',white=>{
 const source=map('<div style="white-space:'+white+'"><span>Título sin punto\n\nDespués seguimos</span></div>');
 expect(planSpeech(source.text).map(item=>item.text)).toEqual(['Título sin punto.','Después seguimos']);
})
it('retains a blank paragraph after a skipped CRLF running header',()=>{
 const raw='Header\r\nTítulo sin punto\r\n\r\nDespués seguimos\r\nHeader';
 const result=normalizeSpeech(raw,{skipHeaders:true});
 expect(result.text).toBe('Título sin punto. Después seguimos');
 expect(raw[result.map[result.text.indexOf('.')]]).toBe('\n');
})
