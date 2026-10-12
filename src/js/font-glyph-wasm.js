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
