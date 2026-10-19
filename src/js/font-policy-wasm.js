// Canvas measurement and locale case conversion are browser operations. The
// wrapping/search decisions and retained text state belong to the native core.
const stringFromUnits = units => {
  let text = '';
  for (let start=0; start<units.length; start+=8192) text+=String.fromCharCode(...units.subarray(start,start+8192));
  return text;
};
export function rustTitleLines(core, context, value, maxWidth, cache=0, key=0) {
  const text=String(value??''), length=Math.max(1,Math.ceil(text.length/4));
  const readLines=handle=>{
    const size=core.font_wrap_text_len(handle);
    const normalized=stringFromUnits(new Uint16Array(core.memory.buffer,core.font_wrap_text(handle),size));
    const count=core.font_wrap_result_len(handle),result=new Uint32Array(core.memory.buffer,core.font_wrap_result(handle),count),lines=[];
    for(let at=0;at<count;at+=2)lines.push(normalized.slice(result[at],result[at+1]));
    return lines;
  };
  const cached=cache?core.font_wrap_cache_get(cache,key):0;
  if(cached)return readLines(cached);
  let pointer=0,handle=0;
  try {
    pointer=core.alloc_f64(length);
    if(!pointer)throw new Error('Font title allocation failed');
    const input=new Uint16Array(core.memory.buffer,pointer,text.length);
    for(let i=0;i<text.length;i++)input[i]=text.charCodeAt(i);
    handle=core.font_wrap_new(pointer,text.length);
    core.free_f64(pointer,length);pointer=0;
    if(!handle)throw new Error('Invalid font title');
    const size=core.font_wrap_text_len(handle);
    const normalized=stringFromUnits(new Uint16Array(core.memory.buffer,core.font_wrap_text(handle),size));
    let measured=NaN,code;
    while((code=core.font_wrap_step(handle,measured,maxWidth))!==0){
      const measure=code>=4398046511104,span=code%4398046511104;
      const start=span%2097152,end=Math.floor(span/2097152);
      measured=measure?context.measureText(normalized.slice(start,end)).width:NaN;
    }
    const count=core.font_wrap_result_len(handle),result=new Uint32Array(core.memory.buffer,core.font_wrap_result(handle),count),lines=[];
    for(let at=0;at<count;at+=2)lines.push(normalized.slice(result[at],result[at+1]));
    if(cache && core.font_wrap_cache_store(cache,key,handle))handle=0;
    return lines;
  } finally { if(handle)core.font_wrap_free(handle);if(pointer)core.free_f64(pointer,length); }
}
export function rustFontSearchPlan(core,title,width){
  const text=String(title),length=24*8,pointer=core.alloc_f64(length);
  if(!pointer)throw new Error('Font plan allocation failed');
  try {
    const count=core.font_search_plan(text.toLocaleUpperCase()===text?0:1,width,pointer);
    const values=new Float64Array(core.memory.buffer,pointer,count*8);
    return Array.from({length:count},(_,index)=>Array.from(values.subarray(index*8,index*8+8)));
  }finally{core.free_f64(pointer,length);}
}
function withScores(core,scores,operation){
  const length=Math.max(1,scores.length),pointer=core.alloc_f64(length);
  if(!pointer)throw new Error('Font score selection allocation failed');
  try{new Float64Array(core.memory.buffer,pointer,scores.length).set(scores);return core[operation](pointer,scores.length);}
  finally{core.free_f64(pointer,length);}
}
export const rustFontFamilyMax=(core,scores)=>withScores(core,scores,'font_family_max');
export const rustFontFamilySelect=(core,scores)=>withScores(core,scores,'font_family_select');

export function createRustFontWrapCache(core){
  let handle=core.font_wrap_cache_new();
  if(!handle)throw new Error('Font wrapping cache allocation failed');
  return {
    lines(context,title,width,key){if(!handle)throw new Error('Font wrapping cache disposed');return rustTitleLines(core,context,title,width,handle,key);},
    dispose(){if(handle){core.font_wrap_cache_free(handle);handle=0;}}
  };
}
