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

export function placeFigures(rects,layout,source,viewport) {
  const geometry=rects.length?figureGeometry(layout,source,viewport):null;
  return rects.map(rect=>({rect,offset:figureOffset(rect,layout,geometry)}))
    .sort((a,b)=>a.offset-b.offset||a.rect.y0-b.rect.y0);
}
