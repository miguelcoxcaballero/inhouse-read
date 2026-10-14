// Frozen from the commit before the Rust voice core took over the text side of the Supertonic recipe (supertonic-runtime.js).
import { SUPERTONIC_LANGUAGES } from '../../../src/js/readers/neural-voice/supertonic-catalog.js';

export function normalizeSupertonicText(text,lang) {
  if(!SUPERTONIC_LANGUAGES.includes(lang))throw new Error(`Idioma Supertonic no disponible: ${lang}`);
  let value=String(text||'').normalize('NFKD')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,'')
    .replace(/[–‑—]/g,'-').replace(/[_\[\]|\/#→←]/g,' ').replace(/[“”]/g,'"').replace(/[‘’´`]/g,"'").replace(/[♥☆♡©\\]/g,'')
    .replaceAll('@',' at ').replaceAll('e.g.,','for example, ').replaceAll('i.e.,','that is, ')
    .replace(/\s+([,.!?;:'])/g,'$1').replace(/"{2,}/g,'"').replace(/'{2,}/g,"'").replace(/\s+/g,' ').trim();
  if(!value)return '';
  if(!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(value))value+='.';
  return `<${lang}>${value}</${lang}>`;
}

/** Small chunks bound latent/audio memory. Upstream recommends <=300 chars
 * (120 for Korean/Japanese); the reader usually already supplies one sentence. */
export function supertonicTextChunks(text,lang) {
  const chars=Array.from(String(text||'').trim()),limit=['ko','ja'].includes(lang)?120:300,chunks=[];
  for(let start=0;start<chars.length;) {
    let end=Math.min(chars.length,start+limit);
    if(end<chars.length)for(let i=end;i>start+limit/2;i--)if(/[\s.!?;。！？]/u.test(chars[i-1])){end=i;break;}
    const chunk=chars.slice(start,end).join('').trim();if(chunk)chunks.push(chunk);start=end;
  }
  return chunks;
}
