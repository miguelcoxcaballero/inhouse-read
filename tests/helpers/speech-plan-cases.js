export function properties(code){const ch=String.fromCodePoint(code);return(/^[\p{L}\p{N}]$/u.test(ch)?1:0)|(/^\p{N}$/u.test(ch)?2:0)|(ch!==ch.toUpperCase()&&ch===ch.toLowerCase()?4:0)|(ch!==ch.toLowerCase()?8:0)}
export function units(text){const value=new Uint16Array(text.length);for(let i=0;i<text.length;i++)value[i]=text.charCodeAt(i);return value}
export function ends(ui,text,breaks=[]){return ui.speech_sentence_ends(units(text),breaks,properties,(a,b)=>text.slice(a,b).toLocaleLowerCase())}
export function clause(text,a,b){return [...text.slice(a,b).matchAll(/[,;:—–،、，；：](?:\s+|(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]))/gu)].map(m=>a+m.index+m[0].length).find(at=>at-a>=24&&at-a<=90&&b-at>=24)}
export function invoke(ui,normalized,options={},from=0){
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
export function makeCases(){
 const sources=['', 'Hola.', 'El Sr. Gómez vino. La Dra. Pérez no.', 'First one. Second one? Third!',
 'Mr. Smith met Dr. J. K. Brown at 5 p.m. on Jan. 3rd, i.e. the day after the U.S. holiday. He paid $3.50.',
 'Lee [12] esta\n\n información y con\u00adtinúa aquí. Informa-\ntion stays.',
 'Heading\u2029A\u2029B\u2029Dijo: "Voy."\u2029Más texto.', 'TÍTULO\u2029body\u2029título',
 'これは長い文章の最初の部分から次のページまで続いています。'.repeat(12),
 '中文很长，'.repeat(32)+'끝입니다。', 'Una frase larga que atraviesa varias líneas del texto y que termina justo aquí, para que podamos ver cómo se parte el resaltado entre dos páginas de la columna cuando el libro se reparte.',
 'x'.repeat(400)+'.','𐐀-\n𐐨. \ud800. \udc00!','İstanbul. I. Σ. ΟΣ.', 'word '.repeat(180)+'end.',
 ('Much more information here, including a clause, and another natural continuation; followed by more words, without dropping anything at the page boundary. ').repeat(5)]
 let seed=219;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),cases=[]
 for(let i=0;i<2400;i++){
  const raw=sources[i%sources.length],points=Array.from({length:i%17},()=>Math.floor(random()*(raw.length+40))-20)
  points.push(NaN,Infinity,-Infinity,0,raw.length,raw.length+.5)
  const options={pageBreaks:points,opening:i%2===0,footnotes:i%3!==0,skipHeaders:i%5===0,...(i%7===0?{headerRanges:[]}:{} )}
  const from=i%9===0?Infinity:i%13===0?NaN:Math.floor(random()*(raw.length+10))-5
  cases.push([raw,options,from])
 }
 for(const raw of sources)for(const opening of [true,false])for(const from of [-Infinity,-.5,0,.5,1,raw.length/2])cases.push([raw,{opening,pageBreaks:[0,1,24,60,90,120,180],footnotes:false},from])
 cases.push([('A sufficiently long sentence, which continues across an actual page boundary and must preserve every original offset. Another sentence here.\u2029').repeat(180),{opening:true,pageBreaks:Array.from({length:200},(_,i)=>i*110)},0])
 return cases
}
