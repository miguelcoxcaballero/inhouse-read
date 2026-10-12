import {getRustCore} from '../rust-core.js';
const cjk=char=>/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char||'');
const listStart=text=>/^(?:[•●▪‣⁃]|\d{1,3}[.)]|[a-z][.)])\s/u.test(text.trimStart());
// Cache only Unicode classifications of bounded boundary characters. Use the
// browser's properties, including its UTF-16 treatment of CJK endpoints.
const starts=new Map(),ends=new Map();
function flags(text){
 const first=text.slice(0,text.codePointAt(0)>0xffff?2:1),last=text.at(-1)||'';
 let a=starts.get(first),b=ends.get(last);
 if(a===undefined){a=(/^\s/.test(first)?1:0)|(/^\p{Ll}/u.test(first)?4:0)|(cjk(first[0])?8:0);if(starts.size>=512)starts.clear();starts.set(first,a);}
 if(b===undefined){b=(/\s$/.test(last)?2:0)|(cjk(last)?16:0)|(/[-‐]/.test(last)?32:0)|(last==='\u00ad'?64:0);if(ends.size>=512)ends.clear();ends.set(last,b);}
 return a|b;
}
export function rustPDFTextStream(lines){
 const core=getRustCore(),count=lines.length;
 if(typeof core?.pdf_text_stream!=='function'||!count||count>32768)return undefined;
 let pointer,length;
 try{
  const entries=lines.flatMap(line=>line.entries),n=entries.length;
  if(n<count||n>32768)return undefined;
  const entryOffset=count*7,outOffset=entryOffset+n*6,lineOffset=outOffset+n*4;length=lineOffset+count*4;
  pointer=core.alloc_f64(length);if(!pointer)return undefined;
  const data=new Float64Array(core.memory.buffer,pointer,length),columns=new Map();let first=0;
  for(let i=0;i<count;i++){
   const line=lines[i],key=line.column;if(!columns.has(key))columns.set(key,columns.size);
   if(typeof line.y!=='number'||typeof line.height!=='number')return undefined;
   const at=i*7;data[at]=first;data[at+1]=line.entries.length;data[at+2]=line.y;data[at+3]=line.height;
   data[at+4]=columns.get(key);data[at+5]=line.rtl?1:0;data[at+6]=listStart(line.text)?1:0;first+=line.entries.length;
  }
  for(let i=0;i<n;i++){
   const entry=entries[i],text=entry.item.str;if(typeof text!=='string')return undefined;
   if(typeof entry.x0!=='number'||typeof entry.x1!=='number'||typeof entry.height!=='number')return undefined;
   const at=entryOffset+i*6;data[at]=entry.x0;data[at+1]=entry.x1;data[at+2]=entry.height;data[at+3]=text.length;
   data[at+4]=flags(text);data[at+5]=text.endsWith('\u00ad')?flags(text.slice(0,-1)):0;
  }
  const size=core.pdf_text_stream(pointer,count,columns.size,pointer+entryOffset*8,n,pointer+outOffset*8,pointer+lineOffset*8);
  if(!Number.isSafeInteger(size)||size<0||size>16_000_000+n*2)return undefined;
  const plan=new Float64Array(core.memory.buffer,pointer+outOffset*8,n*4+count*4);
  let position=0,paragraphStart=0,index=0;const spans=[],items=[],paragraphs=[],updates=[],parts=[];
  for(let i=0;i<count;i++){
   const line=lines[i],base=n*4+i*4,start=plan[base],end=plan[base+1],soft=plan[base+2],paragraph=plan[base+3];
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>size
    ||![0,1].includes(soft)||![0,1].includes(paragraph))return undefined;
   if(paragraph){
    if(position>paragraphStart)paragraphs.push({start:paragraphStart,end:position});
    paragraphStart=position+2;
   }
   for(let piece=0;piece<line.entries.length;piece++,index++){
    const entry=entries[index],at=index*4,prefix=plan[at],trim=plan[at+1],from=plan[at+2],to=plan[at+3];
    if(![0,1,2].includes(prefix)||![0,1].includes(trim)||prefix===2&&(piece!==0||!paragraph)
     ||trim&&!entry.item.str.endsWith('\u00ad'))return undefined;
    if(prefix){parts.push(prefix===2?'\n\n':' ');position+=prefix;}
    if(from!==position)return undefined;
    const stop=entry.item.str.length-trim,itemIndex=items.length;items.push({...entry.item,hasEOL:false});
    if(stop){parts.push(entry.item.str.slice(0,stop));position+=stop;spans.push({itemIndex,rawIndex:entry.rawIndex,start:from,end:to,sourceStart:0,sourceEnd:stop});}
    if(to!==position)return undefined;
   }
   if(end!==position)return undefined;
   items.at(-1).hasEOL=true;updates.push({start,end,sourceIndices:line.entries.map(entry=>entry.rawIndex),...(soft?{softHyphen:true}:{})});
  }
  if(position!==size)return undefined;
  if(position>paragraphStart)paragraphs.push({start:paragraphStart,end:position});
  // Join once. Slicing a growing rope at every line repeatedly flattens all
  // preceding text; long illustrated/scanned pages otherwise become quadratic.
  const text=parts.join('');
  for(const paragraph of paragraphs)paragraph.text=text.slice(paragraph.start,paragraph.end);
  for(let i=0;i<count;i++){const update=updates[i];update.text=text.slice(update.start,update.end);Object.assign(lines[i],update);}
  return {geometric:true,text,items,spans,lines,paragraphs};
 }catch{return undefined;}finally{if(pointer)core.free_f64(pointer,length);}
}
