function ranges(value){
 if(value===undefined)return undefined
 if(!Array.isArray(value))return new Float64Array(0)
 const result=new Float64Array(value.length*2);let index=0
 for(const item of value){const start=item?.start,end=item?.end;result[index++]=typeof start==='number'?start:NaN;result[index++]=typeof end==='number'?end:NaN}
 return result
}
import {units,properties,clause} from './speech-plan.js'
const letters=code=>{const ch=String.fromCodePoint(code);return(/^\p{L}$/u.test(ch)?1:0)|(/^\p{Ll}$/u.test(ch)?2:0)}
export function rustSpeechPipeline(ui,raw,{footnotes=true,skipHeaders=false,headerRanges,pageBreaks,opening}={},from=0){
 raw=String(raw||'');if(raw.length>1_000_000)return undefined;let text
 const expose=chars=>{const chunks=[];for(let i=0;i<chars.length;i+=16384)chunks.push(String.fromCharCode.apply(null,chars.subarray(i,i+16384)));text=chunks.join('')}
 const packed=ui.speech_pipeline(units(raw),Boolean(footnotes),Boolean(skipHeaders),skipHeaders?ranges(headerRanges):undefined,Float64Array.from((pageBreaks||[]).filter(Number.isFinite)),from,Boolean(opening),(a,b)=>raw.slice(a,b).toLocaleLowerCase(),letters,expose,properties,(a,b)=>text.slice(a,b).toLocaleLowerCase(),(a,b)=>clause(text,a,b))
 if(packed===undefined)return undefined
 const items=[];let previous=0,sentence
 for(let at=0;at<packed.length;){
  const a=packed[at],b=packed[at+1],start=packed[at+2],end=packed[at+3],wholeStart=packed[at+4],wholeEnd=packed[at+5],id=packed[at+6],count=packed[at+7];at+=8
  if(id!==previous){previous=id;sentence={start:wholeStart,end:wholeEnd}}
  const item={text:text.slice(a,b),start,end,sentence}
  if(count){item.marks=[];for(let i=0;i<count;i++){item.marks.push({offset:packed[at],start:packed[at+1]});at+=2}}
  items.push(item)
 }return items
}
