// Raw-ABI callers of the two text kernels of the app core, as the differential tests use them. Production reaches the
// same Rust code through rust-ui (speech_normalized, speech_sentences, speech_pipeline); these hold the kernels to the
// frozen JavaScript on their own. (The `1_000_000` guards are those of these callers: the kernels have no limit.)
// UTF-16 is deliberate: reader offsets count code units, including lone
// surrogates. Encoding as UTF-8 would silently change those source positions.
export function rustNormalizeSpeech(core, raw, removed) {
  if (typeof core?.speech_normalize !== 'function' || typeof raw !== 'string'
      || raw.length > 1_000_000 || !(removed instanceof Uint8Array) || removed.length !== raw.length) return null;
  const n=raw.length, outputAt=Math.ceil(n*3/4)*4, mapAt=outputAt+n*4;
  const breaksAt=mapAt+n*8, countsAt=breaksAt+n*4, length=Math.ceil((countsAt+8)/8);
  let p;
  try { p=core.alloc_f64(length); } catch { return null; }
  if (!p) return null;
  try {
    const input=new Uint16Array(core.memory.buffer,p,n);
    for (let i=0;i<n;i++) input[i]=raw.charCodeAt(i);
    new Uint8Array(core.memory.buffer,p+n*2,n).set(removed);
    if (core.speech_normalize(p,p+n*2,n,p+outputAt,p+mapAt,p+breaksAt,p+countsAt)!==1) return null;
    const memory=core.memory.buffer, counts=new Uint32Array(memory,p+countsAt,2);
    if (counts[0]>n*2 || counts[1]>n) return null;
    const chars=new Uint16Array(memory,p+outputAt,counts[0]), chunks=[];
    for (let i=0;i<chars.length;i+=16384) chunks.push(String.fromCharCode.apply(null,chars.subarray(i,i+16384)));
    const sourceMap=new Uint32Array(memory,p+mapAt,counts[0]), sourceBreaks=new Uint32Array(memory,p+breaksAt,counts[1]);
    const map=new Array(sourceMap.length), breaks=new Array(sourceBreaks.length);
    for(let i=0;i<map.length;i++)map[i]=sourceMap[i];
    for(let i=0;i<breaks.length;i++)breaks[i]=sourceBreaks[i];
    return {text:chunks.join(''),map,breaks};
  } catch { return null; }
  finally { core.free_f64(p,length); }
}
export function rustSpeechFragments(core,text,ends) {
  if(typeof core?.speech_fragments!=='function' || typeof text!=='string' || text.length>1_000_000 || !Array.isArray(ends) || ends.length>text.length)return null;
  let previous=0;
  for(const end of ends){if(!Number.isInteger(end)||end<=previous||end>text.length)return null;previous=end;}
  const n=text.length,endsAt=Math.ceil(n*2/4)*4,outputAt=endsAt+ends.length*4;
  const capacity=ends.length+Math.ceil(n/50),length=Math.ceil((outputAt+(capacity*4+1)*4)/8);
  let p;try{p=core.alloc_f64(length);}catch{return null;}if(!p)return null;
  try {
    const input=new Uint16Array(core.memory.buffer,p,n);for(let i=0;i<n;i++)input[i]=text.charCodeAt(i);
    new Uint32Array(core.memory.buffer,p+endsAt,ends.length).set(ends);
    if(core.speech_fragments(p,n,p+endsAt,ends.length,p+outputAt,capacity)!==1)return null;
    const result=new Uint32Array(core.memory.buffer,p+outputAt,capacity*4+1),count=result[0];if(count>capacity)return null;
    const sentences=[];let sentence;
    for(let i=0;i<count;i++){
      const at=1+i*4,start=result[at],end=result[at+1],a=result[at+2],b=result[at+3];
      if(!sentence||sentence.start!==start){sentence={start,end,fragments:[]};sentences.push(sentence);}
      sentence.fragments.push({start:a,end:b,text:text.slice(a,b)});
    }
    return sentences;
  }catch{return null;}finally{core.free_f64(p,length);}
}
