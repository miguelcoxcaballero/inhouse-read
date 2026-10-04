import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({text:null,pages:[],tasks:[],renderGate:null}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',()=>({GlobalWorkerOptions:{},OPS:{paintImageXObject:85},
  getDocument:()=>({promise:Promise.resolve({numPages:2,getPage:async number=>state.pages[number-1]}),destroy:vi.fn()}),
  TextLayer:class {constructor({textContentSource,container}){this.content=textContentSource;this.container=container}
    async render(){this.container.textContent=this.content.items.map(i=>i.str || '').join('')}cancel(){} }
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url',()=>({default:'worker.mjs'}))
vi.mock('../../src/js/gestures.js',()=>({attachSwipeNavigation:()=>()=>{}}))
import {PdfReader} from '../../src/js/readers/pdf-reader.js'
import {planSpeech} from '../../src/js/readers/speech-text.js'
let reader,container
function page(text,images=true) {
  return {getViewport:({scale})=>({width:600*scale,height:800*scale,transform:[scale,0,0,-scale,0,800*scale]}),
    getTextContent:async()=>({items:text?[{str:text,hasEOL:true}]:[]}),
    getOperatorList:async()=>({fnArray:images?[85]:[]}),imageCoordinates:[.1,.2,.6,.2,.1,.5],
    render:vi.fn(()=>{const task={promise:state.renderGate || Promise.resolve(),cancel:vi.fn()};state.tasks.push(task);return task})}
}
beforeEach(()=>{
  document.body.innerHTML='<main></main>';container=document.querySelector('main')
  Object.defineProperties(container,{clientWidth:{value:390},clientHeight:{value:700}})
  container.getBoundingClientRect=()=>({top:0,left:0,right:390,bottom:700,width:390,height:700})
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}})
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){return {canvas:this,drawImage:vi.fn()}})
  state.pages=[page('Before. After.'),page('Next. Complete.')];state.tasks=[];state.renderGate=null
})
afterEach(()=>{reader?.close();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function open(){reader=new PdfReader();await reader.open(container,new ArrayBuffer(0),{preferences:{pdfMode:'text'}})}

describe('PDF reader reflow and original illustrations',()=>{
  it('renders image bytes in adaptable mode and leaves narration text and offsets intact',async()=>{
    await open()
    expect(container.querySelector('.pdf-reflow-image')).not.toBeNull()
    const source=await reader.getSpeechSource()
    expect(source.text).toBe('Before. After.\n')
    expect(planSpeech(source.text).map(s=>s.text)).toEqual(['Before.','After.'])
    expect(state.pages[0].render).toHaveBeenCalledTimes(1)
  })
  it('keeps a scan visible even if PDF.js cannot extract any text',async()=>{
    state.pages[0]=page('');await open()
    expect(container.querySelector('.pdf-reflow-page').textContent).toBe('')
    expect(container.querySelector('.pdf-reflow-image').width).toBe(390)
    expect((await reader.getSpeechSource()).text).toBe('')
  })
  it('prepares images and all text on a detached next page and changes it only on activation',async()=>{
    await open();const old=container.querySelector('.pdf-reflow-image')
    const next=await reader.getNextSpeechSource()
    expect(reader.currentPage).toBe(1);expect(container.querySelector('.pdf-reflow-image')).toBe(old)
    expect(next.text).toBe('Next. Complete.\n');expect(next.activate()).toBe(true)
    expect(reader.currentPage).toBe(2);expect(old.width).toBe(0)
    expect(container.querySelector('.pdf-reflow-image')).not.toBe(old)
  })
  it('reuses original image colours without re-decoding the PDF when changing reading themes',async()=>{
    await open();const image=container.querySelector('.pdf-reflow-image')
    await reader.applyPreferences({pdfMode:'text',theme:'amoled'})
    expect(container.querySelector('.pdf-reflow-image')).toBe(image)
    expect(state.pages[0].render).toHaveBeenCalledTimes(1)
  })
  it('never omits repeated genuine phrases from an adaptable page whose font geometry is unavailable',async()=>{
    state.pages[0].getTextContent=async()=>({items:[{str:'No.',hasEOL:true},{str:'No.',hasEOL:true},{str:'Yes.',hasEOL:true}]})
    await open();const source=await reader.getSpeechSource()
    expect(source.headerRanges).toEqual([])
    expect(planSpeech(source.text,{skipHeaders:true,headerRanges:source.headerRanges}).map(s=>s.text)).toEqual(['No.','No.','Yes.'])
    expect(container.querySelector('.pdf-reflow-page').style.whiteSpace).toBe('normal')
  })
})
