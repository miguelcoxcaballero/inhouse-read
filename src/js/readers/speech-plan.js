import {readerUI} from './rust-ui-required.js'
export function properties(code){const ch=String.fromCodePoint(code);return(/^[\p{L}\p{N}]$/u.test(ch)?1:0)|(/^\p{N}$/u.test(ch)?2:0)|(ch!==ch.toUpperCase()&&ch===ch.toLowerCase()?4:0)|(ch!==ch.toLowerCase()?8:0)}
export function units(text){const value=new Uint16Array(text.length);for(let i=0;i<text.length;i++)value[i]=text.charCodeAt(i);return value}
export const cjk=code=>/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(String.fromCodePoint(code))
export function clause(text,a,b,ui=readerUI()){return ui.speech_opening_clause(units(text.slice(a,b)),a,b,cjk)}
