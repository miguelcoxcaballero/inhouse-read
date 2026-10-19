// undefined requests the host fallback; null is a valid empty/rejected glyph.
export function rustGlyphMask(core,raw,width,rows,stride=width){
 if(typeof core?.font_glyph_mask!=='function'||!core.memory||typeof core.alloc_f64!=='function'||typeof core.free_f64!=='function'
  ||!(raw instanceof Uint8Array||raw instanceof Uint8ClampedArray)||![width,rows,stride].every(Number.isSafeInteger)
  ||width<1||rows<1||width>2048||rows>2048||width*rows>1048576||stride<1||stride>65535||raw.length<width*rows*4)return undefined;
 const pixels=width*rows,maskOffset=pixels*4,pointsOffset=Math.ceil((maskOffset+pixels)/4)*4,metaOffset=pointsOffset+1280*4,length=Math.ceil((metaOffset+24)/8);let pointer=0;
 try{
  pointer=core.alloc_f64(length);if(!pointer)return undefined;
  new Uint8Array(core.memory.buffer,pointer,pixels*4).set(raw.subarray(0,pixels*4));
  const status=core.font_glyph_mask(pointer,width,rows,stride,pointer+maskOffset,pointer+pointsOffset,pointer+metaOffset);
  if(status===1)return null;if(status!==2)return undefined;
  const [w,h,area,np,nf,nb]=new Uint32Array(core.memory.buffer,pointer+metaOffset,6);
  if(!w||!h||w>width||h>rows||area>w*h||np>280||nf>500||nb>500)return undefined;
  const points=new Int32Array(core.memory.buffer,pointer+pointsOffset,np+nf+nb);
  return{width:w,height:h,area,mask:new Uint8Array(core.memory.buffer,pointer+maskOffset,w*h).slice(),perimeter:points.slice(0,np),foreground:points.slice(np,np+nf),background:points.slice(np+nf)};
 }catch{return undefined;}finally{if(pointer)core.free_f64(pointer,length);}
}

/** Prepare font-matching planes together. Callers keep the original image. */
export function rustPrepareCoverPixels(core,raw,width,height,includeEdges=true){
 if(typeof core?.font_prepare_pixels!=='function'||!core.memory||typeof core.alloc_f64!=='function'||typeof core.free_f64!=='function'
  ||!(raw instanceof Uint8Array||raw instanceof Uint8ClampedArray)||![width,height].every(Number.isSafeInteger)
  ||width<1||height<1||width>2048||height>2048||width*height>1048576||raw.length<width*height*4)return null;
 const n=width*height,grayOffset=n*4,nearOffset=Math.ceil(n*5/4)*4,length=Math.ceil((nearOffset+(includeEdges?n*4:0))/8);let pointer=0;
 try{
  pointer=core.alloc_f64(length);if(!pointer)return null;
  new Uint8Array(core.memory.buffer,pointer,n*4).set(raw.subarray(0,n*4));
  const status=core.font_prepare_pixels(pointer,width,height,includeEdges?1:0,pointer+grayOffset,pointer+nearOffset);
  if(status!==1&&status!==2)return null;
  return {gray:new Uint8Array(core.memory.buffer,pointer+grayOffset,n).slice(),near:includeEdges?new Float32Array(core.memory.buffer,pointer+nearOffset,n).slice():null,busy:status===2};
 }catch{return null;}finally{if(pointer)core.free_f64(pointer,length);}
}

export function rustNearEdgeMap(core, edges, width) {
 if (!(edges instanceof Float32Array) || !Number.isSafeInteger(width) || width < 1) throw new Error('Invalid edge plane');
 const length=Math.max(1,edges.length),pointer=core.alloc_f64(length);
 if (!pointer) throw new Error('Edge plane allocation failed');
 try {
  new Float32Array(core.memory.buffer,pointer,edges.length).set(edges);
  core.font_near_edges(pointer,edges.length,width,pointer+edges.byteLength);
  return new Float32Array(core.memory.buffer,pointer+edges.byteLength,edges.length).slice();
 } finally { core.free_f64(pointer,length); }
}
