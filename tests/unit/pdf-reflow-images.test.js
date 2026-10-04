import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPDFText } from '../../src/js/readers/pdf-text.js'
import { clearPDFReflow, pdfImageRects, populatePDFReflow } from '../../src/js/readers/pdf-reflow.js'
import { mapTextNodes } from '../../src/js/readers/speech-map.js'
import { planSpeech } from '../../src/js/readers/speech-text.js'

const viewport={width:600,height:800,transform:[1,0,0,-1,0,800]}
const item=(str,y,size=12)=>({str,width:420,height:size,transform:[size,0,0,size,40,800-y],hasEOL:true})
const layout=items=>extractPDFText({items},viewport)
let root,source,draw
beforeEach(()=>{
  document.body.innerHTML='<article></article>';root=document.querySelector('article')
  source=document.createElement('canvas');source.width=600;source.height=800
  draw=vi.fn();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:draw})
})
afterEach(()=>vi.restoreAllMocks())

describe('adaptable PDF illustrations retain all text offsets',()=>{
  it('puts an illustration between its preceding and following lines without losing a single character',()=>{
    const value=layout([item('Before the picture.',100),item('After the picture.',340),item('Its continuation.',358)])
    populatePDFReflow(root,value,source,[{x0:40,y0:130,x1:240,y1:280}],viewport)
    expect(root.childNodes[0].nodeValue).toBe('Before the picture.\n\n')
    expect(root.childNodes[1].className).toBe('pdf-reflow-image')
    expect(root.childNodes[2].nodeValue).toBe('After the picture. Its continuation.')
    expect(root.textContent).toBe(value.text)
    expect(draw).toHaveBeenCalledWith(source,40,130,200,150,0,0,200,150)
  })
  it('maps narration, highlighting and saved positions after a picture and across both text nodes',()=>{
    const value=layout([item('Before.',100),item('After.',340)])
    populatePDFReflow(root,value,source,[{x0:40,y0:130,x1:240,y1:280}],viewport)
    const map=mapTextNodes(root),start=value.text.indexOf('After.')
    expect(map.text).toBe(value.text)
    expect(map.rangeFor(start,start+6).toString()).toBe('After.')
    expect(map.offsetOf(root.lastChild,3)).toBe(start+3)
    expect(map.rangeFor(0,value.text.length).toString()).toBe(value.text)
    expect(planSpeech(map.text).map(s=>s.text)).toEqual(['Before.','After.'])
  })
  it('displays a scanned image page rather than a message asking to leave adaptable view',()=>{
    populatePDFReflow(root,layout([]),source,[{x0:0,y0:0,x1:600,y1:800}],viewport)
    expect(root.textContent).toBe('');expect(root.querySelector('canvas').height).toBe(800)
    expect(mapTextNodes(root).text).toBe('')
  })
  it('preserves repeated phrases on both sides of a picture with skipHeaders enabled',()=>{
    const value=layout([item('No.',100),item('No.',340)])
    populatePDFReflow(root,value,source,[{x0:40,y0:130,x1:240,y1:280}],viewport)
    expect(planSpeech(mapTextNodes(root).text,{skipHeaders:true,headerRanges:[]}).map(s=>s.text)).toEqual(['No.','No.'])
  })
  it('keeps the legacy single text node when a page has no images',()=>{
    const value=layout([item('One.',100),item('Two.',118)])
    populatePDFReflow(root,value)
    expect(root.childNodes).toHaveLength(1);expect(root.firstChild.nodeValue).toBe(value.text)
  })
  it('releases old image canvases when navigating, re-rendering or cancelling a staged page',()=>{
    populatePDFReflow(root,layout([]),source,[{x0:0,y0:0,x1:600,y1:800}],viewport)
    const canvas=root.firstChild;clearPDFReflow(root)
    expect(canvas.width).toBe(0);expect(canvas.height).toBe(0);expect(root.childNodes).toHaveLength(0)
  })
  it('keeps multiple pictures at the same insertion offset without duplicated or omitted text',()=>{
    const value=layout([item('Above.',100),item('Below.',500)])
    populatePDFReflow(root,value,source,[{x0:40,y0:150,x1:240,y1:250},{x0:40,y0:300,x1:240,y1:400}],viewport)
    expect(root.querySelectorAll('canvas')).toHaveLength(2);expect(root.textContent).toBe(value.text)
    expect(mapTextNodes(root).rangeFor(0,value.text.length).toString()).toBe(value.text)
  })
})

describe('PDF image composite bounds',()=>{
  it('retains disconnected pictures, merges overlapping layers and clamps off-page bounds',()=>{
    const rects=pdfImageRects([0,0,.2,0,0,.2, .1,.1,.3,.1,.1,.3, .5,.5,.8,.5,.5,.8, -.1,.9,.1,.9,-.1,1.1],100,100)
    expect(rects).toEqual([{x0:0,y0:0,x1:30,y1:30},{x0:50,y0:50,x1:80,y1:80},{x0:0,y0:90,x1:10,y1:100}])
  })
  it('includes the fourth corner of a rotated photo and ignores malformed or empty coordinates',()=>{
    expect(pdfImageRects([.3,.2,.5,.4,.2,.3,NaN,0,0,0,0,0, 0,0,0,0,0,0],100,100))
      .toEqual([{x0:20,y0:20,x1:50,y1:50}])
  })
})

describe('ordinary line leading across PDF typefaces',()=>{
  it('joins continuous prose despite alternating font metrics and sizes',()=>{
    const result=layout([item('The sentence begins',100,12),item('with an emphasized continuation',118,17),
      item('and ends on its ordinary baseline.',136,12)])
    expect(result.paragraphs).toHaveLength(1)
    expect(result.text).toBe('The sentence begins with an emphasized continuation and ends on its ordinary baseline.')
  })
  it('still recognizes a genuinely wider paragraph gap beside changed typography',()=>{
    const result=layout([item('First paragraph',100,12),item('continues.',118,17),item('Second paragraph.',154,12)])
    expect(result.paragraphs.map(p=>p.text)).toEqual(['First paragraph continues.','Second paragraph.'])
  })
  it('never discards or duplicates words in mixed-size shuffled page streams',()=>{
    const items=Array.from({length:60},(_,i)=>item(`Marker${i}.`,50+i*18,i%2?17:12))
    const result=layout(items.filter((_,i)=>i%2).reverse().concat(items.filter((_,i)=>!(i%2))))
    expect(result.items.map(i=>i.str)).toEqual(items.map(i=>i.str))
    expect(result.spans.map(s=>result.text.slice(s.start,s.end))).toEqual(items.map(i=>i.str))
    expect(result.paragraphs).toHaveLength(1)
  })
})
