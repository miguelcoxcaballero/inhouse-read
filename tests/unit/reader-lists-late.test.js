import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {ReaderLists} from '../../src/js/readers/reader-lists.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let panel,lists
beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}))
beforeEach(()=>{
 runtime.ui=null;document.body.innerHTML='<section><button data-place-tab="toc"></button><div data-toc></div><div data-history></div><div data-bookmarks></div><div data-quotes></div><p data-search-status></p><div data-search-results></div></section>'
 panel=document.querySelector('section');lists=new ReaderLists(panel)
})
afterEach(()=>{lists.free();document.body.replaceChildren();runtime.ui=null})
it('adopts on a requested update without replacing other lists or losing focus',()=>{
 const jump=vi.fn(),select=vi.fn(),hit={excerpt:'Found'}
 lists.renderToc([{href:'a',label:'A'}],jump);const chapter=panel.querySelector('[data-toc] button');chapter.focus()
 const Native=vi.fn(function(...args){return new ui.RustReaderLists(...args)});Native.prototype=ui.RustReaderLists.prototype
 runtime.ui={RustReaderLists:Native};expect(document.activeElement).toBe(chapter)
 lists.renderSearch([hit],select)
 expect(Native).toHaveBeenCalledOnce();expect(panel.querySelector('[data-toc] button')).toBe(chapter);expect(document.activeElement).toBe(chapter)
 chapter.click();expect(jump).toHaveBeenCalledExactlyOnceWith('a')
 panel.querySelector('[data-search-results] button').click();expect(select).toHaveBeenCalledExactlyOnceWith(hit)
 lists.renderToc([{href:'b',label:'B'}],jump);chapter.click();expect(jump).toHaveBeenCalledTimes(1)
 panel.querySelector('[data-toc] button').click();expect(jump).toHaveBeenLastCalledWith('b');expect(Native).toHaveBeenCalledOnce()
})
it('releases remaining fallback rows and native listeners together',()=>{
 const callback=vi.fn();lists.renderToc([{href:'old'}],callback);const old=panel.querySelector('[data-toc] button')
 runtime.ui=ui;lists.renderPlaces('bookmarks',[{}],['A'],callback,callback,'x');const current=panel.querySelector('[data-bookmarks] button')
 lists.free();old.click();current.click();expect(callback).not.toHaveBeenCalled();expect(()=>lists.clearSearch('')).toThrow('disposed')
})
it('does not resurrect a disposed fallback when Rust becomes ready',()=>{
 lists.free();runtime.ui=ui;expect(()=>lists.renderSearch([],()=>{})).toThrow('disposed')
})
it('keeps the fallback working after a native construction failure and retries later',()=>{
 class Broken{constructor(){throw Error('not ready')}}for(const name of ['renderToc','renderPlaces','clearSearch','renderSearch'])Broken.prototype[name]=()=>{}
 runtime.ui={RustReaderLists:Broken};const select=vi.fn();lists.renderSearch([{excerpt:'Fallback'}],select);panel.querySelector('[data-search-results] button').click();expect(select).toHaveBeenCalledOnce()
 runtime.ui=ui;lists.renderSearch([{excerpt:'Native'}],select);panel.querySelector('[data-search-results] button').click();expect(select).toHaveBeenCalledTimes(2)
})
it('releases references after repeated late adoption and disposal',()=>{
 lists.free();const cycle=()=>{runtime.ui=null;const owner=new ReaderLists(panel);owner.renderToc([{href:'a'}],()=>{});runtime.ui=ui;owner.renderSearch([{excerpt:'b'}],()=>{});owner.free()}
 cycle();const before=ui.ui_live_handles();for(let i=0;i<100;i++)cycle();expect(ui.ui_live_handles()).toBe(before)
})
