// Frozen original of src/js/readers/pdf-reflow.js before its DOM building moved to Rust (tests only).
import {pdfPlaceFigures} from '../../../src/js/readers/pdf-figures-wasm.js';
export {pdfFigureOffset} from '../../../src/js/readers/pdf-figures-wasm.js';
// Render illustrations from PDF.js's original composite pixels: transforms,
// transparency, clipping and colour profiles remain the renderer's job.
// Text stays in its exact source-offset stream even when a picture splits it.
export function clearPDFReflow(root) {
  for (const canvas of root.querySelectorAll('canvas')) canvas.width = canvas.height = 0
  root.replaceChildren()
}

export {pdfImageRects} from '../../../src/js/readers/pdf-images-wasm.js';


function* reflowNodes(doc, layout, source, rects, viewport) {
  const text=layout.text,figures=pdfPlaceFigures(rects,layout,source,viewport)
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
