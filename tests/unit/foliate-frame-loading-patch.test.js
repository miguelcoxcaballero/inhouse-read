// @vitest-environment node
import {readFileSync} from 'node:fs'
import {describe, expect, it, vi} from 'vitest'
import {patchFoliateFrameLoading} from '../../scripts/foliate-frame-loading-patch.mjs'
const upstream = readFileSync('node_modules/foliate-js/paginator.js', 'utf8')
function frameHarness(source) {
  const nodes = [], range = {selectNodeContents:vi.fn()}
  const body = {style:{}}, doc = {body, fonts:{ready:Promise.resolve()}}
  class Element extends EventTarget {
    style = {}; attributes = {}; children = []; contentDocument = doc
    append(node) {this.children.push(node)}
    setAttribute(name,value) {this.attributes[name]=value}
    remove() {this.removed=true}
  }
  const document = {createElement(){const node=new Element();nodes.push(node);return node}, createRange(){return range}}
  const observe=vi.fn(),unobserve=vi.fn()
  class Observer {observe=observe;unobserve=unobserve}
  const code=source.slice(source.indexOf('class View {'), source.indexOf('export class Paginator'))
  const View=new Function('document','ResizeObserver','getDirection','getBackground', `${code}; return View`)(document,Observer,()=>({vertical:true,rtl:true}),()=> '#faf9f6')
  const render=vi.spyOn(View.prototype,'render').mockImplementation(()=>{}),expand=vi.spyOn(View.prototype,'expand').mockImplementation(()=>{})
  const view=new View({container:{},onExpand:vi.fn()})
  return {view,frame:nodes[1],doc,body,range,render,expand,observe,unobserve}
}
describe('real Foliate chapter frame loading',()=>{
  it('reproduces the upstream frame being removed from layout during navigation',()=>{
    const h=frameHarness(upstream)
    expect(h.frame.style.display).toBe('none')
  })
  it('keeps navigation in layout but hides unstyled content until the original load and layout complete',async()=>{
    const h=frameHarness(patchFoliateFrameLoading(upstream)),afterLoad=vi.fn(),layout={flow:'paginated'}
    const beforeRender=vi.fn(()=>layout),done=vi.fn()
    const loading=h.view.load('blob:actual-chapter',afterLoad,beforeRender).then(done)
    await Promise.resolve()
    expect(h.frame.style.display).toBe('block');expect(h.frame.style.opacity).toBe('0')
    expect(h.frame.src).toBe('blob:actual-chapter');expect(done).not.toHaveBeenCalled()
    expect(h.render).not.toHaveBeenCalled();expect(h.observe).not.toHaveBeenCalled()
    h.frame.dispatchEvent(new Event('load'));await loading
    expect(afterLoad).toHaveBeenCalledExactlyOnceWith(h.doc)
    expect(beforeRender).toHaveBeenCalledExactlyOnceWith({vertical:true,rtl:true,background:'#faf9f6'})
    expect(h.range.selectNodeContents).toHaveBeenCalledExactlyOnceWith(h.body)
    expect(h.render).toHaveBeenCalledExactlyOnceWith(layout)
    expect(h.frame.style.opacity).toBe('1');expect(h.frame.style.display).toBe('block')
    expect(h.observe).toHaveBeenCalledExactlyOnceWith(h.body)
    expect(h.frame.attributes.sandbox).toBe('allow-same-origin allow-scripts')
    h.frame.dispatchEvent(new Event('load'));expect(h.render).toHaveBeenCalledOnce()
  })
  it('contains only the original ready path and reveals the frame after rendering',()=>{
    // The production patch contains no alternate ready path: reveal comes only
    // after the original layout render. Source guard checks this ordering.
    const source=patchFoliateFrameLoading(upstream)
    expect(source.indexOf("this.#iframe.style.opacity = '1'")).toBeGreaterThan(source.indexOf('this.render(layout)'))
    expect((source.match(/this\.#iframe\.style\.opacity = '1'/g)||[]).length).toBe(1)
    expect(source).not.toMatch(/setInterval|loading\s*=\s*['"]lazy/)
  })
  it('preserves normal teardown and validates the original source before replacing it',()=>{
    const h=frameHarness(patchFoliateFrameLoading(upstream))
    h.view.destroy();expect(h.unobserve).toHaveBeenCalledExactlyOnceWith(h.body)
    expect(()=>patchFoliateFrameLoading('changed')).toThrow(/Unexpected/)
    expect(()=>patchFoliateFrameLoading(upstream+upstream)).toThrow(/Unexpected/)
    expect(()=>patchFoliateFrameLoading(patchFoliateFrameLoading(upstream))).toThrow(/Unexpected/)
    expect(patchFoliateFrameLoading(upstream.replaceAll('\n','\r\n'))).toBe(patchFoliateFrameLoading(upstream))
  })
})
