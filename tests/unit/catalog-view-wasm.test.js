import {beforeAll,afterEach,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
let wasm
beforeAll(()=>{wasm=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
afterEach(()=>{document.body.replaceChildren();expect(ui.ui_live_handles()).toBe(0)})
const row=(kind,id,text)=>[kind,id,'Label '+text,'<svg><path d="M0 0h1"/></svg>',text,'Subtitle','Dimensions','Mount','#eeddaa'].join('\0')
const frame=()=>['plants','2700','lamp','shelf','shelf','color','plant','pot','Lamp','Subtitle','Mount','Shelf','Subtitle','Dimensions','Plant','Subtitle','Pot','Color','Size',false,true]
it('keeps the exact literal IDs, labels and names when markup characters are present',()=>{
 const id='catalog-"<>&',text='A < B & “C” > D "E"',root=ui.catalog_build(document,id,'',row('plant','plant',text))
 expect(root.querySelector('h2').id).toBe(id+'-title');expect(root.getAttribute('aria-labelledby')).toBe(id+'-title')
 expect(root.querySelector('[data-catalog-plant] .ihr-plant-catalog__option-name').textContent).toBe(text)
 expect(root.querySelector('[data-catalog-plant]').getAttribute('aria-label')).toBe('Label '+text)
 expect(root.querySelector('script')).toBeNull()
})
it('rejects malformed, unknown, oversized and excessive row packets without changing the palette',()=>{
 const root=ui.catalog_build(document,'catalog','',row('plant','plant','Plant'));ui.catalog_colors(root,row('color','color','Color'));const before=root.outerHTML
 for(const packet of ['color\0missing',row('unknown','id','X'),'x'.repeat(2*1024*1024+1),Array(2049).fill(row('color','id','Color')).join('\0')])expect(()=>ui.catalog_colors(root,packet)).toThrow()
 expect(root.outerHTML).toBe(before)
})
it('dispatches one selection from SVG, text and keyboard clicks and replaces its listener cleanly',()=>{
 const root=ui.catalog_build(document,'catalog','',row('plant','plant','Plant')),view=new ui.RustCatalogView(root),calls=[]
 try{
  view.render(frame());view.connect((kind,id)=>calls.push([kind,id]));const button=root.querySelector('[data-catalog-plant]')
  button.querySelector('path').dispatchEvent(new MouseEvent('click',{bubbles:true}));button.querySelector('span:last-child').firstChild.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.click()
  expect(calls).toEqual([['plant','plant'],['plant','plant'],['plant','plant']]);view.connect(()=>calls.push('replacement'));button.click();expect(calls.at(-1)).toBe('replacement');expect(calls).toHaveLength(4)
 }finally{view.free()}
 root.querySelector('[data-catalog-plant]').click();expect(calls).toHaveLength(4)
})
it('allows destruction from its own selection handler and releases all native references',()=>{
 const root=ui.catalog_build(document,'catalog','',row('plant','plant','Plant')),view=new ui.RustCatalogView(root);let calls=0
 view.connect(()=>{calls++;view.free()});root.querySelector('[data-catalog-plant]').click();expect(calls).toBe(1);expect(ui.ui_live_handles()).toBe(0);root.querySelector('[data-catalog-plant]').click();expect(calls).toBe(1)
})
it('keeps handles and memory bounded through repeated rendering and empty palettes',()=>{
 const root=ui.catalog_build(document,'catalog','',row('plant','plant','Plant')),view=new ui.RustCatalogView(root)
 try{
  view.render(frame());ui.catalog_colors(root,'');view.syncColors();const before=ui.ui_live_handles(),capacity=wasm.memory.buffer.byteLength
  for(let i=0;i<1000;i++)view.render(frame());expect(ui.ui_live_handles()).toBe(before);expect(wasm.memory.buffer.byteLength).toBe(capacity);expect(root.querySelectorAll('[data-catalog-color]')).toHaveLength(0)
  expect(()=>view.render([])).toThrow();expect(()=>view.render([...frame().slice(0,19),'busy',true])).toThrow()
 }finally{view.free()}
})
