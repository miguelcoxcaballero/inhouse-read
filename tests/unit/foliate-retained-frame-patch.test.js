// @vitest-environment node
import {readFileSync} from 'node:fs'
import {describe,expect,it,vi} from 'vitest'
import {patchFoliateFrameLoading} from '../../scripts/foliate-frame-loading-patch.mjs'
import {patchFoliateRetainedFrame} from '../../scripts/foliate-retained-frame-patch.mjs'
const upstream=readFileSync('node_modules/foliate-js/paginator.js','utf8')
const patched=()=>patchFoliateRetainedFrame(patchFoliateFrameLoading(upstream))
const bookDocument=()=>({body:{style:{}},readyState:'complete',fonts:{ready:Promise.resolve()}})
function harness(source=patched()) {
  const nodes=[],doc=bookDocument(),observe=vi.fn(),unobserve=vi.fn(),range={selectNodeContents:vi.fn()}
  class Element {
    style={};attributes={};children=[];listeners=new Map();contentDocument=doc
    contentWindow={location:{href:'about:blank'}}
    constructor(kind){this.kind=kind;nodes.push(this)}
    append(node){node.parent=this;this.children.push(node)}
    removeChild(node){this.children.splice(this.children.indexOf(node),1);node.parent=null}
    remove(){this.parent?.removeChild(this)}
    setAttribute(key,value){this.attributes[key]=value}
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn)}
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn)}
    emit(type){for(const fn of [...(this.listeners.get(type)||[])])fn(new Event(type))}
  }
  const document={baseURI:'https://example.test/',createElement:kind=>new Element(kind),createRange:()=>range}
  class Observer {observe=observe;unobserve=unobserve}
  const code=source.slice(source.indexOf('class View {'),source.indexOf('export class Paginator'))
  const View=new Function('document','ResizeObserver','getDirection','getBackground',`${code}; return View`)(document,Observer,()=>({vertical:false,rtl:false}),()=> '#fff')
  const render=vi.spyOn(View.prototype,'render').mockImplementation(()=>{}),expand=vi.spyOn(View.prototype,'expand').mockImplementation(()=>{})
  const method=source.match(/    #createView\(\) \{[\s\S]*?\n    \}/)?.[0]
  if(!method)throw new Error('Missing real paginator view factory')
  const container=new Element('container')
  const Router=new Function('View','container',`return class {
    #view;#container=container;#anchor
    #scrollToAnchor(){}
    ${method}
    create(){return this.#createView()}
    get view(){return this.#view}
  }`)(View,container)
  const router=new Router()
  return {router,container,nodes,doc,render,expand,observe,unobserve,range,
    get frame(){return router.view.element.children.find(node=>node.kind==='iframe')},
    loaded(url,document=doc){this.frame.contentDocument=document;this.frame.contentWindow.location.href=url;this.frame.emit('load')},
    overlay(){return new Element('overlay')}}
}
describe('retained Foliate chapter frame',()=>{
  it('reproduces upstream allocating a new iframe for each chapter',()=>{
    const h=harness(upstream),first=h.router.create(),second=h.router.create()
    expect(second).not.toBe(first);expect(h.nodes.filter(node=>node.kind==='iframe')).toHaveLength(2)
  })
  it('reuses the real view and iframe while releasing the previous overlay and body observer',()=>{
    const h=harness(),first=h.router.create(),frame=h.frame,overlay=h.overlay()
    first.overlayer={element:overlay};expect(first.element.children).toContain(overlay)
    const second=h.router.create()
    expect(second).toBe(first);expect(h.frame).toBe(frame);expect(h.container.children).toEqual([first.element])
    expect(h.nodes.filter(node=>node.kind==='iframe')).toHaveLength(1)
    expect(first.element.children).not.toContain(overlay);expect(first.overlayer).toBeNull()
    expect(h.unobserve).toHaveBeenCalledExactlyOnceWith(h.doc.body)
  })
  it('ignores about:blank and late old-page events before accepting the requested document',async()=>{
    const h=harness(),view=h.router.create(),after=vi.fn(),done=vi.fn()
    const pending=view.load('blob:new-chapter',after,()=>({flow:'paginated'})).then(done)
    h.loaded('about:blank');h.loaded('blob:old-chapter');await Promise.resolve()
    expect(done).not.toHaveBeenCalled();expect(after).not.toHaveBeenCalled();expect(h.frame.style.opacity).toBe('0')
    h.loaded('blob:new-chapter');await pending
    expect(after).toHaveBeenCalledExactlyOnceWith(h.doc);expect(done).toHaveBeenCalledOnce()
    expect(h.frame.style.opacity).toBe('1');expect(h.frame.listeners.get('load').size).toBe(0)
  })
  it('rejects rendering errors and removes handlers instead of leaving the loading promise pending',async()=>{
    const h=harness(),view=h.router.create(),error=new TypeError('layout failure')
    h.render.mockImplementation(()=>{throw error})
    const pending=view.load('blob:broken-layout',null,()=>({flow:'paginated'}))
    const check=expect(pending).rejects.toBe(error)
    h.loaded('blob:broken-layout');await check
    expect(h.frame.style.opacity).toBe('0');expect(h.frame.listeners.get('load').size).toBe(0)
    expect(h.frame.listeners.get('error').size).toBe(0)
  })
  it('cancels a replaced navigation and never adopts its late document',async()=>{
    const h=harness(),view=h.router.create(),old=view.load('blob:old-load',null,()=>({}))
    const cancelled=expect(old).rejects.toMatchObject({name:'AbortError'})
    expect(h.router.create()).toBe(view);await cancelled
    const next=view.load('blob:new-load',null,()=>({}))
    h.loaded('blob:old-load');expect(h.render).not.toHaveBeenCalled()
    h.loaded('blob:new-load');await next;expect(h.render).toHaveBeenCalledOnce()
  })
  it('does not expand the current chapter when fonts from the previous document finish late',async()=>{
    const h=harness(),view=h.router.create();let finishOldFonts
    h.doc.fonts.ready=new Promise(resolve=>{finishOldFonts=resolve})
    const first=view.load('blob:first',null,()=>({}));h.loaded('blob:first');await first
    h.router.create();const newDoc=bookDocument()
    const second=view.load('blob:second',null,()=>({}));h.loaded('blob:second',newDoc);await second
    expect(h.expand).toHaveBeenCalledOnce()
    finishOldFonts();await Promise.resolve();expect(h.expand).toHaveBeenCalledOnce()
  })
  it('handles a real iframe error and rejects unsupported or repeated build transformations',async()=>{
    const h=harness(),view=h.router.create(),pending=view.load('blob:bad-resource',null,()=>({}))
    const rejected=expect(pending).rejects.toThrow('No se pudo cargar');h.frame.emit('error');await rejected
    expect(()=>patchFoliateRetainedFrame(upstream)).toThrow(/Unexpected/)
    expect(()=>patchFoliateRetainedFrame(patched())).toThrow(/Unexpected/)
    expect(()=>patchFoliateRetainedFrame(patchFoliateFrameLoading(upstream)+patchFoliateFrameLoading(upstream))).toThrow(/Unexpected/)
  })
})
