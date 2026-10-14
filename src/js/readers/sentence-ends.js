import {readerUI} from './rust-ui-required.js'
function properties(code){
 const ch=String.fromCodePoint(code)
 return (/^[\p{L}\p{N}]$/u.test(ch)?1:0)|(/^\p{N}$/u.test(ch)?2:0)|(ch!==ch.toUpperCase()&&ch===ch.toLowerCase()?4:0)|(ch!==ch.toLowerCase()?8:0)
}
// Rust answers any length. It leaves boundaries it cannot trust (not integers inside the text)
// unanswered instead of coercing them; the normalizer never produces such a list.
export function sentenceEnds(text,breaks=[]){
 const units=new Uint16Array(text.length);for(let i=0;i<text.length;i++)units[i]=text.charCodeAt(i)
 const result=readerUI().speech_sentence_ends(units,breaks,properties,(a,b)=>text.slice(a,b).toLocaleLowerCase())
 if(result===undefined)throw new TypeError('Unsupported sentence boundaries')
 return result
}
