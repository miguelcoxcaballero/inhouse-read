import './helpers/rust-ui-ready.js'
import {expect,it} from 'vitest';
import {firstCompleteSentenceOffset,planSpeech} from '../../src/js/readers/speech-text.js';
it('skips only the sentence crossing a visible page boundary',()=>{const text='La primera frase continúa aquí. Nueva frase completa. Otra.';expect(firstCompleteSentenceOffset(text,text.indexOf('continúa'))).toBe(text.indexOf('Nueva'));expect(firstCompleteSentenceOffset(text,text.indexOf('Nueva'))).toBe(text.indexOf('Nueva'));expect(firstCompleteSentenceOffset(text,0)).toBe(0);});
it('uses the previous PDF page instead of guessing from capitals',()=>{const text='Madrid para terminarla. Ahora empieza otra.';expect(firstCompleteSentenceOffset(text,0,'La frase empezó en')).toBe(text.indexOf('Ahora'));expect(firstCompleteSentenceOffset(text,0,'La anterior termina.')).toBe(0);});
it('keeps abbreviation and decimal rules, and skips every fragment of the partial sentence',()=>{const text='Sr. García consultó 3.5 documentos '+ 'largos '.repeat(80) + '. Primera completa.';expect(firstCompleteSentenceOffset(text,0,'Hablaron con el')).toBe(text.indexOf('Primera'));});
it('does not invent a sentence when the entire page is a continuation',()=>{const text='que todavía no termina';expect(firstCompleteSentenceOffset(text,0,'Una frase')).toBe(text.length);});
it('matches the previous complete-plan selection across prefixes, offsets and footnotes',()=>{
 const reference=(raw,from=0,previousText='',options={})=>{
  const prefix=previousText?String(previousText).trimEnd()+' ':'';
  const start=prefix.length+Math.max(0,Number(from)||0);
  const item=planSpeech(prefix+raw,{footnotes:options.footnotes},0).find(item=>item.sentence.start>=start);
  return item?item.sentence.start-prefix.length:String(raw).length;
 };
 const pages=['','A short sentence. Another one.','Sr. García consultó 3.5 documentos. Nueva frase.',
  '漢字の文章。次の文です。','A long sentence with '+ 'many words '.repeat(90)+'. A complete ending.',
  'Words [1] followed by notes. More text.','Emoji 🙂 continue here\u2029A heading\u2029Next paragraph.'];
 for(const raw of pages)for(const prefix of ['', 'A partial sentence', 'Complete sentence.\n', 'Anterior 🙂 ', '漢字。']){
  for(const from of [undefined,null,0,-20,3.5,20,'24',NaN,Infinity,-Infinity])for(const footnotes of [undefined,true,false]){
   const options={footnotes};
   expect(firstCompleteSentenceOffset(raw,from,prefix,options)).toBe(reference(raw,from,prefix,options));
  }
 }
});
