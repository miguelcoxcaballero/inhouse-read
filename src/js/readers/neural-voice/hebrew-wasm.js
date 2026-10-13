// Unicode normalization/combining classes belong to the browser's existing
// glyph parser. Rust owns syllables, consonants, vowels, sheva and stress.
const WHITESPACE=/[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/u
const TAAMIM=/[\u0591-\u05AF]/gu
const BITS=new Map(Array.from({length:13},(_,i)=>[0x5b0+i,1<<i]).concat([[0x5bf,1<<13],[0x5c1,1<<14],[0x5c2,1<<15],[0x5c7,1<<16]]))
const MAX_PAIRS=32768,MAX_RETAINED=8192
let arena=null
export function releaseHebrewArena(){if(arena){arena.core.free_f64(arena.pointer,arena.length);arena=null}}
export function rustHebrewToIpa(core,text,glyphsOf){
 if(typeof core?.hebrew_ipa_words!=='function'||typeof core.alloc_f64!=='function'||typeof core.free_f64!=='function'||!core.memory||arena?.inUse)return undefined
 const words=text.replace(TAAMIM,'').normalize('NFC').split(WHITESPACE).filter(Boolean),packet=[]
 for(let i=0;i<words.length;i++){
  if(i)packet.push(0xfffffffe,0)
  for(const glyph of glyphsOf(words[i])){let marks=0;for(const mark of glyph.marks)marks|=BITS.get(mark.codePointAt(0))||0;packet.push(glyph.base.length===1?glyph.base.codePointAt(0):0,marks)}
 }
 const pairs=packet.length/2;if(!pairs)return '';if(pairs>MAX_PAIRS)return undefined
 const required=pairs*5,keep=required<=MAX_RETAINED
 let current,failed=false
 try{
  if(arena?.core!==core||arena.length<required||!keep)releaseHebrewArena()
  if(arena)current=arena
  else{let length=32;while(length<required)length*=2;const pointer=core.alloc_f64(length);if(!pointer)return undefined;current={core,pointer,length,inUse:false};if(keep)arena=current}
  current.inUse=true
  const offset=current.pointer+packet.length*4,capacity=pairs*8
  new Uint32Array(core.memory.buffer,current.pointer,packet.length).set(packet)
  const count=core.hebrew_ipa_words(current.pointer,pairs,offset,capacity)
  if(!Number.isInteger(count)||count<0||count>capacity){failed=true;return undefined}
  const result=new Uint32Array(core.memory.buffer,offset,count),parts=[]
  for(let i=0;i<result.length;i+=4096)parts.push(String.fromCodePoint(...result.subarray(i,i+4096)))
  return parts.join('')
 }catch{failed=true;return undefined}
 finally{if(current){current.inUse=false;if(current!==arena||failed){if(current===arena)arena=null;core.free_f64(current.pointer,current.length)}}}
}
