// The low-resolution painter remains identical. One batch expands all five
// channels, including f32 lattice rounding, into the existing texture arrays.
export function rustPlantPreview(core,width,height,columns,rows,lattice,pigment,data) {
  if(typeof core?.plant_surface_preview!=='function' || !Number.isInteger(width) || !Number.isInteger(height)
      || width<1 || height<1 || width>2048 || height>2048 || columns!==Math.ceil(width/8)+1 || rows!==Math.ceil(height/8)+1
      || !(lattice instanceof Float32Array) || lattice.length!==columns*rows*5
      || !(pigment instanceof Uint8Array) || !(data instanceof Uint8Array) || pigment.length!==width*height*4 || data.length!==pigment.length)return false;
  const outputAt=lattice.byteLength,length=Math.ceil((outputAt+pigment.length*2)/8);
  let p;try{p=core.alloc_f64(length);}catch{return false;}if(!p)return false;
  try {
    new Float32Array(core.memory.buffer,p,lattice.length).set(lattice);
    if(core.plant_surface_preview(width,height,columns,rows,p,p+outputAt)!==1)return false;
    pigment.set(new Uint8Array(core.memory.buffer,p+outputAt,pigment.length));
    data.set(new Uint8Array(core.memory.buffer,p+outputAt+pigment.length,data.length));
    return true;
  }catch{return false;}finally{core.free_f64(p,length);}
}
