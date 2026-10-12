import {rustPDFImageRects} from './pdf-images-wasm.js';

export function legacyPDFImageRects(coordinates, width, height) {
  const rects = []
  for (let index = 0; index + 5 < coordinates.length; index += 6) {
    const [ax, ay, bx, by, cx, cy] = Array.from(coordinates.slice(index,index + 6))
    if (![ax,ay,bx,by,cx,cy].every(Number.isFinite)) continue
    const dx=bx+cx-ax, dy=by+cy-ay
    const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx,dx)*width+1e-7))
    const y0=Math.max(0,Math.floor(Math.min(ay,by,cy,dy)*height+1e-7))
    const x1=Math.min(width,Math.ceil(Math.max(ax,bx,cx,dx)*width-1e-7))
    const y1=Math.min(height,Math.ceil(Math.max(ay,by,cy,dy)*height-1e-7))
    if (x1>x0 && y1>y0) rects.push({x0,y0,x1,y1})
  }
  // Layered/overlapping image tiles are one composite illustration. Preserve
  // disconnected photographs separately, including repeated uses of an image.
  rects.sort((a,b)=>a.y0-b.y0 || a.x0-b.x0)
  for (let a=0;a<rects.length;a++) for (let b=a+1;b<rects.length;) {
    const left=rects[a],right=rects[b]
    // Sorted top edges cannot overlap after the current composite's bottom.
    // Restart after a merge: its enlarged box can still reach earlier pictures.
    if (right.y0>=left.y1) break
    if (Math.min(left.x1,right.x1)>Math.max(left.x0,right.x0)
      && Math.min(left.y1,right.y1)>Math.max(left.y0,right.y0)) {
      rects[a]={x0:Math.min(left.x0,right.x0),y0:Math.min(left.y0,right.y0),
        x1:Math.max(left.x1,right.x1),y1:Math.max(left.y1,right.y1)}
      rects.splice(b,1); a=-1; break
    }
    b++
  }
  return rects.sort((a,b)=>a.y0-b.y0 || a.x0-b.x0)
}

export function pdfImageRects(coordinates,width,height) {
  return (coordinates.length>=48?rustPDFImageRects(coordinates,width,height):undefined)
    ??legacyPDFImageRects(coordinates,width,height);
}
