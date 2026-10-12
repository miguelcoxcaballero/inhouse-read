import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {initSync,RustReaderLists} from '../../src/wasm/ui/inhouse_read_ui.js'
import {LegacyReaderLists} from '../../src/js/readers/reader-lists-legacy.js'

let panel,view,core
const markup='<button data-place-tab="toc"></button><div data-toc></div><div data-history></div><div data-bookmarks></div><div data-quotes></div><p data-search-status></p><div data-search-results></div>'
beforeAll(()=>{core=initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
beforeEach(()=>{document.body.innerHTML='<section>'+markup+'</section>';panel=document.querySelector('section');view=new RustReaderLists(panel)})
afterEach(()=>{view?.free();view=null;document.body.replaceChildren()})
it('preserves the exact DOM and original object references in search and place callbacks',()=>{
 const legacyPanel=document.createElement('section');legacyPanel.innerHTML=markup;const legacy=new LegacyReaderLists(legacyPanel)
 const select=vi.fn(),remove=vi.fn(),place={text:'<unescaped & quote>',locator:{value:'original'}},hit={parts:{pre:'<b>',match:'needle &',post:'</b>'},label:'Page 2'}
 for(const renderer of [view,legacy]){
  renderer.renderToc([{href:0,label:'Chapter 1',subitems:[{href:'second'}]}],select)
  for(const name of ['history','quotes','bookmarks'])renderer.renderPlaces(name,[place],['Page 1'],select,remove,'<svg></svg>')
  renderer.renderSearch([hit,{excerpt:'Fallback'}, {parts:{pre:null,match:'matched',post:null}}],select)
 }
 expect(panel.innerHTML).toBe(legacyPanel.innerHTML)
 panel.querySelector('[data-bookmarks] button').click();expect(select).toHaveBeenLastCalledWith(0,place);expect(select.mock.lastCall[1]).toBe(place)
 panel.querySelector('[data-bookmarks] button:last-child').click();expect(remove).toHaveBeenLastCalledWith(0,place)
 panel.querySelector('[data-search-results] button').click();expect(select.mock.lastCall[0]).toBe(hit)
})
it('removes old listeners when each list is replaced and when the owner is freed',()=>{
 const callback=vi.fn(),nodes=[]
 view.renderToc([{href:'a'}],callback);nodes.push(panel.querySelector('[data-toc] button'))
 view.renderPlaces('history',[{}],['A'],callback,callback,'x');nodes.push(...panel.querySelectorAll('[data-history] button'))
 view.renderSearch([{excerpt:'A'}],callback);nodes.push(panel.querySelector('[data-search-results] button'))
 nodes.forEach(node=>node.click());expect(callback).toHaveBeenCalledTimes(4)
 view.renderToc([],callback);view.renderPlaces('history',[],[],callback,callback,'x');view.clearSearch('')
 nodes.forEach(node=>node.click());expect(callback).toHaveBeenCalledTimes(4)
 view.renderToc([{href:'b'}],callback);const current=panel.querySelector('[data-toc] button');view.free();view=null
 current.click();expect(callback).toHaveBeenCalledTimes(4)
})
it('allows a click to replace its own list without retaining a Rust borrow',()=>{
 const callback=vi.fn(()=>view.renderToc([],callback))
 view.renderToc([{href:'replace'}],callback);panel.querySelector('[data-toc] button').click()
 expect(callback).toHaveBeenCalledWith('replace');expect(panel.querySelector('[data-toc]').childElementCount).toBe(0)
})
it('bounds nesting and does not omit href zero or empty string',()=>{
 const nested=depth=>[{href:depth,label:'Level '+depth,subitems:depth<20?nested(depth+1):[]}]
 view.renderToc([{href:''},...nested(0)],vi.fn());expect(panel.querySelectorAll('[data-toc] button')).toHaveLength(10)
 expect(panel.querySelector('[data-toc] button:last-child').style.paddingInlineStart).toBe('60px')
})
it('releases unique labels, callbacks and rows without growing the WASM arena',()=>{
 const callback=()=>{},cycle=i=>{view.renderToc([{href:'chapter'+i}],callback);view.renderPlaces('quotes',[{text:'Quote '+i}],['Location '+i],callback,callback,'x');view.renderSearch([{excerpt:'Result '+i}],callback)}
 for(let i=0;i<30;i++)cycle(i);const before=core.memory.buffer.byteLength
 for(let i=30;i<330;i++)cycle(i)
 expect(core.memory.buffer.byteLength).toBe(before)
},15000)
