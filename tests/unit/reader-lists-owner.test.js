import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {ReaderLists} from '../../src/js/readers/reader-lists.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let panel,lists
beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}))
beforeEach(()=>{
 runtime.ui=ui;document.body.innerHTML='<section><button data-place-tab="toc"></button><div data-toc></div><div data-history></div><div data-bookmarks></div><div data-quotes></div><p data-search-status></p><div data-search-results></div></section>'
 panel=document.querySelector('section');lists=new ReaderLists(panel)
})
afterEach(()=>{lists?.free();lists=null;document.body.replaceChildren();runtime.ui=null})
it('is the Rust list owner of the panel, with no fallback in between',()=>{
 expect(lists).toBeInstanceOf(ui.RustReaderLists)
 const jump=vi.fn(),select=vi.fn(),hit={excerpt:'Found'}
 lists.renderToc([{href:'a',label:'A'}],jump);const chapter=panel.querySelector('[data-toc] button');chapter.focus()
 lists.renderSearch([hit],select);expect(panel.querySelector('[data-toc] button')).toBe(chapter);expect(document.activeElement).toBe(chapter)
 chapter.click();expect(jump).toHaveBeenCalledExactlyOnceWith('a')
 panel.querySelector('[data-search-results] button').click();expect(select).toHaveBeenCalledExactlyOnceWith(hit)
})
it('releases its rows and listeners when freed',()=>{
 const callback=vi.fn();lists.renderToc([{href:'old'}],callback);const old=panel.querySelector('[data-toc] button')
 lists.renderPlaces('bookmarks',[{}],['A'],callback,callback,'x');const current=panel.querySelector('[data-bookmarks] button')
 lists.free();lists=null;old.click();current.click();expect(callback).not.toHaveBeenCalled()
})
it('returns every Rust handle after repeated creation and disposal',()=>{
 lists.free();const cycle=()=>{const owner=new ReaderLists(panel);owner.renderToc([{href:'a'}],()=>{});owner.renderSearch([{excerpt:'b'}],()=>{});owner.free()}
 cycle();const before=ui.ui_live_handles();for(let i=0;i<100;i++)cycle();expect(ui.ui_live_handles()).toBe(before);lists=null
})
it('fails clearly when the core is missing instead of building a second implementation',()=>{
 runtime.ui=null;expect(()=>new ReaderLists(panel)).toThrow('Rust UI is not loaded')
})
