// @vitest-environment node
import {it} from 'vitest'
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {patchFoliateFrameLoading} from '../../scripts/foliate-frame-loading-patch.mjs'
import {patchFoliateRetainedFrame} from '../../scripts/foliate-retained-frame-patch.mjs'
const source=patchFoliateRetainedFrame(patchFoliateFrameLoading(readFileSync('node_modules/foliate-js/paginator.js','utf8')))
function harness(code=source){
 const render=code.match(/    render\(\) \{[\s\S]*?\n    \}/)?.[0],after=code.match(/    #afterScroll\(reason\) \{[\s\S]*?\n    \}/)?.[0]
 assert.ok(render&&after)
 const calls=[],oldRange={},range={},view={document:null,render:()=>calls.push('render')}
 const Reader=new Function('view','calls','oldRange','range',`return class{
  #view=view;#vertical=false;#rtl=false;#index=4;#anchor=oldRange;#lastVisibleRange=oldRange;#justAnchored=false;#header={style:{}};#footer={style:{}}
  scrolled=false;pages=0
  #beforeRender(){calls.push('layout');return{}}
  #scrollToAnchor(){calls.push('scroll');this.#afterScroll('anchor')}
  #getVisibleRange(){if(!this.#view.document?.body)throw new TypeError('createTreeWalker: missing Node');return range}
  dispatchEvent(event){calls.push(['relocate',event.detail])}
  ${render}
  ${after}
  scroll(){return this.#afterScroll('scroll')}
  detach(){this.#view=null}
  get saved(){return this.#anchor}
  get visible(){return this.#lastVisibleRange}
 }`)(view,calls,oldRange,range)
 return {reader:new Reader(),view,calls,oldRange,range}
}
it('retains the last valid range during frame navigation and resumes after the new body loads',()=>{
const h=harness()
for(const doc of [null,{}, {documentElement:{}}, {documentElement:{},body:null}, {body:{}}]){
 h.view.document=doc
 assert.doesNotThrow(()=>h.reader.render());assert.doesNotThrow(()=>h.reader.scroll())
 assert.equal(h.reader.saved,h.oldRange);assert.equal(h.reader.visible,h.oldRange)
}
assert.deepEqual(h.calls,[])
h.view.document={documentElement:{},body:{}};h.reader.render()
assert.deepEqual(h.calls.slice(0,3),['layout','render','scroll']);assert.equal(h.reader.visible,h.range);assert.equal(h.reader.saved,h.oldRange)
h.reader.scroll();assert.equal(h.reader.saved,h.range)
assert.equal(h.calls.filter(call=>call[0]==='relocate').length,2)
})
it('ignores late resize and scroll events after the view was detached',()=>{
 const h=harness();h.reader.detach()
 assert.doesNotThrow(()=>h.reader.render());assert.doesNotThrow(()=>h.reader.scroll())
 assert.deepEqual(h.calls,[]);assert.equal(h.reader.saved,h.oldRange);assert.equal(h.reader.visible,h.oldRange)
})
