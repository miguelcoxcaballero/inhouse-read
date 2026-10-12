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
