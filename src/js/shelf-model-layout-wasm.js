// One cabinet operation crosses the boundary; browser references stay here. The numeric core is
// the only implementation: measured geometry of a hidden or collapsed shelf (zero, negative or NaN
// sizes) is laid out with the original arithmetic, not rejected.
const MAX_ENTRIES = 1 << 17, MAX_ROWS = 1 << 17;
export function rustShelfModelLayout(core, layout, spec, shelfType, bookHeight) {
  if (typeof core?.shelf_model !== 'function' || !layout || !Array.isArray(layout.rows) || !Array.isArray(layout.entries)
      || layout.rows.length > MAX_ROWS || layout.entries.length > MAX_ENTRIES || typeof layout.width !== 'number') return null;
  const count=layout.entries.length, slots=spec.shelfBottoms.length;
  const rows=Math.max(1,Math.ceil(layout.rows.length/slots))*slots;
  const config=[spec.width,spec.height,spec.depth,spec.postSize,spec.shelfRimHeight,
    spec.ceilingOffset,spec.usableDepth,bookHeight,slots,...spec.shelfBottoms];
  const input=new Float64Array(count*8);
  for(let i=0;i<count;i++) {
    const e=layout.entries[i], kind=e.kind==='lamp'?2:e.kind==='plant'?1:0, p=i*8;
    // A string offset would concatenate in the original; our own measurement never produces one.
    if(typeof e.x!=='number')return null;
    // Float64Array stores apply ToNumber, which is what the original's `*`, `/`, `<` and Math.min did.
    input[p]=e.shelf??0;input[p+1]=e.x;input[p+2]=e.height;input[p+3]=e.width;
    input[p+4]=e.depth;input[p+5]=kind?1:e.style.heightRatio;input[p+6]=kind;input[p+7]=e.mount==='undershelf'?1:0;
  }
  const outputAt=config.length+input.length, outputLength=4+rows*7+count*7, length=outputAt+outputLength;
  let pointer;
  try { pointer=core.alloc_f64(length); } catch { return null; }
  if(!pointer)return null;
  try {
    let data;
    try {
      const arena=new Float64Array(core.memory.buffer,pointer,length);
      arena.set(config);arena.set(input,config.length);
      const status=core.shelf_model(layout.width,layout.rows.length,count,pointer,pointer+config.length*8,pointer+outputAt*8,outputLength);
      // The original read `.bottom` of an undefined row for a bay that is not a whole row number.
      if(status===2)throw new TypeError("Cannot read properties of undefined (reading 'bottom')");
      if(status!==1)return null;
      data=new Float64Array(core.memory.buffer,pointer+outputAt*8,outputLength);
    } catch (error) { if(error instanceof TypeError)throw error; return null; }
    return hydrate(layout,shelfType,rows,data);
  }
  finally { core.free_f64(pointer,length); }
}
function hydrate(layout,shelfType,rows,data) {
  const modeledRows=Array.from({length:rows},(_,i)=>{
    const p=4+i*7;return {left:data[p],right:data[p+1],unit:data[p+2],padding:data[p+3],top:data[p+4],ceiling:data[p+5],bottom:data[p+6]};
  });
  const entries=layout.entries.map((entry,i)=>{
    const p=4+rows*7+i*7;
    return {...entry,x:data[p],height:data[p+1],width:data[p+2],
      ...(entry.kind==='lamp'||entry.kind==='plant'&&entry.depth?{depth:data[p+3]}:{}),
      y:data[p+4],...(entry.kind==='lamp'?{}:{rooftop:Boolean(data[p+5])}),depthInset:data[p+6]};
  });
  return {...layout,entries,rows:modeledRows,shelfType,unitWidth:layout.width,unitCount:data[3],width:data[0],height:data[1],depth:data[2]};
}
