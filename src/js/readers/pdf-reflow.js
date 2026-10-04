// Render illustrations from PDF.js's original composite pixels: transforms,
// transparency, clipping and colour profiles remain the renderer's job.
// Text stays in its exact source-offset stream even when a picture splits it.
export function clearPDFReflow(root) {
  for (const canvas of root.querySelectorAll('canvas')) canvas.width = canvas.height = 0
  root.replaceChildren()
}

export function pdfImageRects(coordinates, width, height) {
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

function figureGeometry(layout, source, viewport) {
  if (!layout.geometric || !layout.lines.length) return null
  // Project the picture into the same axes used to order PDF text. This also
  // handles PDFs whose entire page is rotated by 90/180/270 degrees.
  const dominant=layout.lines.flatMap(line=>line.entries)
    .reduce((a,b)=>a.item.str.length>=b.item.str.length?a:b)
  const transform=viewport.transform || [1,0,0,-1,0,viewport.height]
  const t=dominant.item.transform
  const angle=Math.atan2(transform[1]*t[0]+transform[3]*t[1],transform[0]*t[0]+transform[2]*t[1])
  const cos=Math.cos(angle),sin=Math.sin(angle)
  const columns=new Map()
  for (const line of layout.lines) {
    const box=columns.get(line.column) || {x0:Infinity,x1:-Infinity}
    box.x0=Math.min(box.x0,line.x0);box.x1=Math.max(box.x1,line.x1);columns.set(line.column,box)
  }
  return {cos,sin,columns:[...columns],scaleX:viewport.width/source.width,scaleY:viewport.height/source.height}
}

function figureOffset(rect, layout, geometry) {
  if (!geometry) return layout.text.length
  const {cos,sin,columns,scaleX,scaleY}=geometry
  const points=[[rect.x0,rect.y0],[rect.x1,rect.y0],[rect.x0,rect.y1],[rect.x1,rect.y1]]
    .map(([x,y])=>{x*=scaleX;y*=scaleY;return [x*cos+y*sin,-x*sin+y*cos]})
  const x0=Math.min(...points.map(p=>p[0])),x1=Math.max(...points.map(p=>p[0]))
  const y1=Math.max(...points.map(p=>p[1]))
  const matching=new Set(columns.filter(([,box])=>Math.min(box.x1,x1)>Math.max(box.x0,x0)).map(([key])=>key))
  const following=layout.lines.find(line=>line.y>=y1-line.height*.3
    && (!matching.size || matching.has(line.column)))
  return following?.start ?? layout.text.length
}

export function pdfFigureOffset(rect, layout, source, viewport) {
  return figureOffset(rect,layout,figureGeometry(layout,source,viewport))
}

function* reflowNodes(doc, layout, source, rects, viewport) {
  const text=layout.text,geometry=rects.length ? figureGeometry(layout,source,viewport) : null
  const figures=rects.map(rect=>({rect,offset:figureOffset(rect,layout,geometry)}))
    .sort((a,b)=>a.offset-b.offset || a.rect.y0-b.rect.y0)
  let offset=0
  for (const {rect,offset:at} of figures) {
    if (at>offset) yield doc.createTextNode(text.slice(offset,at))
    const canvas=doc.createElement('canvas')
    canvas.className='pdf-reflow-image'
    canvas.width=rect.x1-rect.x0;canvas.height=rect.y1-rect.y0
    canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Ilustración de la página')
    canvas.style.width=`${Math.min(100,canvas.width/source.width*100)}%`
    try { canvas.getContext('2d').drawImage(source,rect.x0,rect.y0,canvas.width,canvas.height,0,0,canvas.width,canvas.height) }
    catch (error) { canvas.width=canvas.height=0; throw error }
    yield canvas;offset=at
  }
  if (offset<text.length || !figures.length) yield doc.createTextNode(text.slice(offset))
}

function commitReflow(root, fragment, text) {
  if (fragment.textContent!==text) throw new Error('El texto adaptable no coincide con el texto completo del PDF.')
  clearPDFReflow(root)
  root.append(fragment)
}

export function populatePDFReflow(root, layout, source, rects=[], viewport) {
  const fragment=root.ownerDocument.createDocumentFragment()
  try {
    for (const node of reflowNodes(root.ownerDocument,layout,source,rects,viewport)) fragment.append(node)
    commitReflow(root,fragment,layout.text)
  } catch (error) { clearPDFReflow(fragment); throw error }
}

// Cropping many original illustrations must leave room for input and paint.
// Prepare detached nodes in small tasks; the previous complete page remains
// intact until every source pixel and text offset is ready to commit together.
function nextReflowTask(doc) {
  return new Promise(resolve=>{
    const Channel=doc.defaultView?.MessageChannel
    if (!Channel) { setTimeout(resolve,0); return }
    // Posted tasks avoid the growing timer delay across a long sequence of
    // crops, and keep progressing when a background reader has no rAF ticks.
    const channel=new Channel()
    channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve()}
    channel.port2.postMessage(null)
  })
}

export async function preparePDFReflow(root, layout, source, rects=[], viewport, isActive=()=>true) {
  const fragment=root.ownerDocument.createDocumentFragment()
  let started=performance.now(),committed=false
  try {
    for (const node of reflowNodes(root.ownerDocument,layout,source,rects,viewport)) {
      fragment.append(node)
      if (performance.now()-started<8) continue
      await nextReflowTask(root.ownerDocument)
      if (!isActive()) return false
      started=performance.now()
    }
    if (!isActive()) return false
    commitReflow(root,fragment,layout.text)
    committed=true
    return true
  } finally { if (!committed) clearPDFReflow(fragment) }
}
