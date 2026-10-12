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
