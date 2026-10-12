export function ranges(value){
 if(value===undefined)return undefined
 if(!Array.isArray(value))return new Float64Array(0)
 const result=new Float64Array(value.length*2);let index=0
 for(const item of value){const start=item?.start,end=item?.end;result[index++]=typeof start==='number'?start:NaN;result[index++]=typeof end==='number'?end:NaN}
 return result
}
export function properties(code){const ch=String.fromCodePoint(code);return(/^\p{L}$/u.test(ch)?1:0)|(/^\p{Ll}$/u.test(ch)?2:0)}
export function invoke(ui,raw,{footnotes=true,skipHeaders=false,headerRanges}={}){
 raw=String(raw||'');const units=new Uint16Array(raw.length);for(let i=0;i<raw.length;i++)units[i]=raw.charCodeAt(i)
 return ui.speech_removal_mask(units,Boolean(footnotes),Boolean(skipHeaders),skipHeaders?ranges(headerRanges):undefined,(a,b)=>raw.slice(a,b).toLocaleLowerCase(),properties)
}
export function decode(chars){const chunks=[];for(let i=0;i<chars.length;i+=16384)chunks.push(String.fromCharCode.apply(null,chars.subarray(i,i+16384)));return chunks.join('')}
export function marshal(chars,sourceMap,sourceBreaks){
 const text=decode(chars),map=new Array(sourceMap.length),breaks=new Array(sourceBreaks.length)
 for(let i=0;i<map.length;i++)map[i]=sourceMap[i];for(let i=0;i<breaks.length;i++)breaks[i]=sourceBreaks[i]
 return{text,map,breaks}
}
export function complete(ui,raw,{footnotes=true,skipHeaders=false,headerRanges}={}){
 raw=String(raw||'')
 return ui.speech_normalize_complete(raw.length,units=>{for(let i=0;i<raw.length;i++)units[i]=raw.charCodeAt(i)},Boolean(footnotes),Boolean(skipHeaders),skipHeaders?ranges(headerRanges):undefined,(a,b)=>raw.slice(a,b).toLocaleLowerCase(),properties,marshal)
}
export function makeCases(){
 const rawCases=[
  '',null,false,0,42,'Palabra[1], otra[123], no [1234]. [*] [†] [‡] [１２] [١٢].',
  'Text (note 1) other (NOTA\n123456) and ( noTE ９ ). (notas 1) (note1) (note 1x) (note  001\ufeff)',
  'informa-\ntion continúa. Informa‐\nción. Άλ-\nφα. 𐐀-\n𐐨. 𐐀-\n𐐀. a-\n1. 1-\na. a‐\nb.',
  'yes\nBody\nyes\nAnother', 'TITLE\r\n body\r\nTITLE\r\nrest', 'TÍTULO\u2029body\u2029título',
  'a\u2028b\nc\nd', '\ud800\nbody\n\udc00', '\ud800\nbody\n\ud800', 'a-\n\ud800. \ud800-\na.',
  '  Header  \r\n Paragraph body.\r\n Header\r\nThe end', 'İ\ncontent\nİ',
  '𐐀'.repeat(44)+'\nbody\n'+'𐐀'.repeat(44),'İ'.repeat(45)+'\nbody\n'+'İ'.repeat(45),
  '[1][12][123][1234][0][999][†][**]( note 1 )(NoTa\t2)(note\r\n4)',
  'H\n'+Array.from({length:39},(_,i)=>'body '+i).join('\n')+'\nH',
  'H\n'+Array.from({length:40},(_,i)=>'body '+i).join('\n')+'\nH',
  'ΟΣ\n Σ\nΟΣ\n Σ', 'I\n\u0307\nI\n\u0307', 'I\u0307\nİ\nI\u0307\nİ',
  'Α\u2029Σ\u2029Α\u2029Σ', 'I\u2029\u0307\u2029I\u2029\u0307',
  'header\n'+(' '.repeat(20)+'\n').repeat(45)+'header'
 ]
 const cases=[]
 for(const raw of rawCases){const text=String(raw||'');for(const footnotes of [true,false,null,0,''])for(const skipHeaders of [true,false])for(const headerRanges of [undefined,[],null,[{start:0,end:text.indexOf('\n')<0?text.length:text.indexOf('\n')}],[null,0,false,'range',{}, {start:0,end:Infinity},{start:-1,end:1},{start:'0',end:1},{start:.5,end:2},{start:0,end:text.length}]])cases.push([raw,{footnotes,skipHeaders,headerRanges}])}
 let seed=219;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
 const words=['Header','Texto','the body','[3]','(note 2)','Title','a-\nb','header','𐐀-\n𐐨','İstanbul','  ','',';']
 for(let i=0;i<2400;i++){
  const lines=[];for(let j=0,n=1+Math.floor(random()*70);j<n;j++)lines.push(words[Math.floor(random()*words.length)])
  const raw=lines.join(['\n','\r\n','\u2029','\u2028'][i%4]);let headerRanges
  if(i%3===1)headerRanges=[]
  if(i%3===2)headerRanges=Array.from({length:8},()=>{const start=Math.floor(random()*(raw.length+1)),end=start+Math.floor(random()*30);return{start,end}})
  cases.push([raw,{footnotes:i%2===0,skipHeaders:i%5!==0,headerRanges}])
 }
 cases.push([('Header\nThis is a long para-\ngraph[13] with a (note 2) marker.\n').repeat(1000),{footnotes:false,skipHeaders:true}])
 return cases
}
