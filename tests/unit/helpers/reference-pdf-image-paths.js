// Frozen geometry from pdf-page-theme.js at 67c4671; no WASM/production imports.
export function referenceImagePaths(coordinates,width,height) {
 const out=[];
 for(let i=0;i+5<coordinates.length;i+=6){
  const [ax,ay,bx,by,cx,cy]=Array.from(coordinates.slice(i,i+6));
  if(![ax,ay,bx,by,cx,cy].every(Number.isFinite))continue;
  const mirrored=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax)<0;
  out.push(ax*width,ay*height,(mirrored?cx:bx)*width,(mirrored?cy:by)*height,
   (bx+cx-ax)*width,(by+cy-ay)*height,(mirrored?bx:cx)*width,(mirrored?by:cy)*height);
 }
 return Float64Array.from(out);
}
export function referencePaintTheme(source,target,filter,coordinates=[]) {
 const c=target.getContext('2d');c.clearRect(0,0,target.width,target.height);c.filter=filter;
 c.drawImage(source,0,0,target.width,target.height);c.filter='none';if(filter==='none'||!coordinates.length)return;
 c.save();c.beginPath();
 for(let i=0;i+5<coordinates.length;i+=6){
  const [ax,ay,bx,by,cx,cy]=Array.from(coordinates.slice(i,i+6));
  if(![ax,ay,bx,by,cx,cy].every(Number.isFinite))continue;
  const mirrored=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax)<0;
  c.moveTo(ax*target.width,ay*target.height);
  c.lineTo((mirrored?cx:bx)*target.width,(mirrored?cy:by)*target.height);
  c.lineTo((bx+cx-ax)*target.width,(by+cy-ay)*target.height);
  c.lineTo((mirrored?bx:cx)*target.width,(mirrored?by:cy)*target.height);c.closePath();
 }
 c.clip();c.drawImage(source,0,0,target.width,target.height);c.restore();
}
