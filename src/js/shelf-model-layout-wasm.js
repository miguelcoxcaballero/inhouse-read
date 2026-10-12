// One cabinet operation crosses the boundary; browser references stay here.
const plain = value => value && [Object.prototype,null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
export function rustShelfModelLayout(core, layout, spec, shelfType, bookHeight, measured = false) {
  if (typeof core?.shelf_model !== 'function' || !layout || (!measured && !plain(layout))
      || !Array.isArray(layout.rows) || !Array.isArray(layout.entries)
      || layout.rows.length > 3000 || layout.entries.length > 8192
      || !Number.isFinite(layout.width) || layout.width <= 0) return null;
  const count=layout.entries.length, slots=spec.shelfBottoms.length;
  const rows=Math.max(1,Math.ceil(layout.rows.length/slots))*slots;
  const config=[spec.width,spec.height,spec.depth,spec.postSize,spec.shelfRimHeight,
    spec.ceilingOffset,spec.usableDepth,bookHeight,slots,...spec.shelfBottoms];
  const input=new Float64Array(count*8);
  for(let i=0;i<count;i++) {
    const e=layout.entries[i];if(!e || (!measured && !plain(e)))return null;
    const kind=e.kind==='lamp'?2:e.kind==='plant'?1:0;
    if(!kind && (!e.style || (!measured && !plain(e.style))))return null;
    const p=i*8;
    if(measured) {
      // These numeric records come from our own DOM measurement, not library
      // metadata or an external API. Rust validates the complete numeric slab.
      input[p]=e.shelf??0;input[p+1]=e.x;input[p+2]=e.height;input[p+3]=e.width;
      input[p+4]=e.depth??0;input[p+5]=kind?1:e.style.heightRatio;input[p+6]=kind;input[p+7]=e.mount==='undershelf'?1:0;
    } else {
      const values=[e.shelf??0,e.x,e.height,e.width,e.depth??0,kind?1:e.style.heightRatio,kind,e.mount==='undershelf'?1:0];
      if(!values.every(Number.isFinite) || !Number.isInteger(values[0]) || values[2]<=0 || values[3]<=0 || values[4]<0 || values[5]<=0)return null;
      input.set(values,p);
    }
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
      if(core.shelf_model(layout.width,layout.rows.length,count,pointer,pointer+config.length*8,pointer+outputAt*8,outputLength)!==1)return null;
      data=new Float64Array(core.memory.buffer,pointer+outputAt*8,outputLength);
    } catch { return null; }
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
