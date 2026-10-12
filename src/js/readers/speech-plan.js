export function properties(code){const ch=String.fromCodePoint(code);return(/^[\p{L}\p{N}]$/u.test(ch)?1:0)|(/^\p{N}$/u.test(ch)?2:0)|(ch!==ch.toUpperCase()&&ch===ch.toLowerCase()?4:0)|(ch!==ch.toLowerCase()?8:0)}
export function units(text){const value=new Uint16Array(text.length);for(let i=0;i<text.length;i++)value[i]=text.charCodeAt(i);return value}
export function clause(text,a,b){return [...text.slice(a,b).matchAll(/[,;:—–،、，；：](?:\s+|(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]))/gu)].map(m=>a+m.index+m[0].length).find(at=>at-a>=24&&at-a<=90&&b-at>=24)}
export function rustSpeechPlan(ui,normalized,options={},from=0){
 const{text,map,breaks}=normalized
 const packed=ui.speech_plan(units(text),Uint32Array.from(map),Uint32Array.from(breaks),Float64Array.from((options.pageBreaks||[]).filter(Number.isFinite)),from,Boolean(options.opening),properties,(a,b)=>text.slice(a,b).toLocaleLowerCase(),(a,b)=>clause(text,a,b))
 if(packed===undefined)return undefined
 const items=[];let previous=0,sentence
 for(let at=0;at<packed.length;){
  const[a,b,start,end,wholeStart,wholeEnd,id,count]=packed.subarray(at,at+8);at+=8
  if(id!==previous){previous=id;sentence={start:wholeStart,end:wholeEnd}}
  const item={text:text.slice(a,b),start,end,sentence}
  if(count){item.marks=[];for(let i=0;i<count;i++){item.marks.push({offset:packed[at],start:packed[at+1]});at+=2}}
  items.push(item)
 }return items
}
