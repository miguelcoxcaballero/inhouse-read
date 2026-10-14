export function properties(code){const ch=String.fromCodePoint(code);return(/^[\p{L}\p{N}]$/u.test(ch)?1:0)|(/^\p{N}$/u.test(ch)?2:0)|(ch!==ch.toUpperCase()&&ch===ch.toLowerCase()?4:0)|(ch!==ch.toLowerCase()?8:0)}
export function units(text){const value=new Uint16Array(text.length);for(let i=0;i<text.length;i++)value[i]=text.charCodeAt(i);return value}
export function clause(text,a,b){return [...text.slice(a,b).matchAll(/[,;:—–،、，；：](?:\s+|(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]))/gu)].map(m=>a+m.index+m[0].length).find(at=>at-a>=24&&at-a<=90&&b-at>=24)}
