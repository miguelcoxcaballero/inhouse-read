import {getRustUI} from '../rust-ui.js'
import {sentenceEnds as legacy} from './sentence-ends-legacy.js'
function properties(code){
 const ch=String.fromCodePoint(code)
 return (/^[\p{L}\p{N}]$/u.test(ch)?1:0)|(/^\p{N}$/u.test(ch)?2:0)|(ch!==ch.toUpperCase()&&ch===ch.toLowerCase()?4:0)|(ch!==ch.toLowerCase()?8:0)
}
export function sentenceEnds(text,breaks=[]){
 const ui=getRustUI();if(!ui?.speech_sentence_ends||text.length>1_000_000)return legacy(text,breaks)
 const units=new Uint16Array(text.length);for(let i=0;i<text.length;i++)units[i]=text.charCodeAt(i)
 const result=ui.speech_sentence_ends(units,breaks,properties,(a,b)=>text.slice(a,b).toLocaleLowerCase())
 return result===undefined?legacy(text,breaks):result
}
