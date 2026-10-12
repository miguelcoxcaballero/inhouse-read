export function rustPlantFoliageRows(core,kind,width,height,row,count,config,pigment,data) {
  if(typeof core?.plant_foliage_rows!=='function' || (!Number.isInteger(kind)||kind<0||kind>3) || ![width,height,row,count].every(Number.isInteger)
      || width<1 || height<1 || width>2048 || height>2048 || row<0 || count<1 || count>4 || row+count>height
      || !(config instanceof Float64Array) || config.length!==5
      || !(pigment instanceof Uint8Array) || !(data instanceof Uint8Array) || pigment.length!==width*height*4 || data.length!==pigment.length)return false;
  const size=width*count*4,length=(40+size*2)/8;
  let p;try{p=core.alloc_f64(length);}catch{return false;}if(!p)return false;
  try {
    new Float64Array(core.memory.buffer,p,5).set(config);
    if(core.plant_foliage_rows(kind,width,height,row,count,p,p+40)!==1)return false;
    pigment.set(new Uint8Array(core.memory.buffer,p+40,size),row*width*4);
    data.set(new Uint8Array(core.memory.buffer,p+40+size,size),row*width*4);
    return true;
  }catch{return false;}finally{core.free_f64(p,length);}
}
