import {beforeAll,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {initSync,RustSelectMenu} from '../../src/wasm/ui/inhouse_read_ui.js'
let core,menus=[]
beforeAll(()=>{core=initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
afterEach(()=>{for(const menu of menus){menu.root.remove();menu.free()}menus=[];document.body.replaceChildren()})
function make(change=()=>{},extra=null){const m=new RustSelectMenu('Voz',extra,change);menus.push(m);document.body.append(m.root);return m}
it('preserves option identity and allows synchronous replacement from onChange',()=>{
 const option={value:'es',label:'Español'},change=vi.fn((value,selected)=>{expect(selected).toBe(option);menu.setOptions([{value:'nl',label:'Neerlandés'}],'nl')})
 const menu=make(change);menu.setOptions([{value:'',label:'Auto'},option],'');menu.open();menu.choose('es')
 expect(change).toHaveBeenCalledTimes(1);expect(menu.value).toBe('nl');expect(menu.valueNode.textContent).toBe('Neerlandés');expect(menu.isOpen).toBe(false)
})
it('propagates callback errors without trapping or retaining Rust borrows',()=>{
 const failure=new Error('host callback'),menu=make(()=>{throw failure})
 menu.setOptions([{value:'a',label:'A'},{value:'b',label:'B'}],'a')
 expect(()=>menu.choose('b')).toThrow(failure)
 menu.setValue('a');menu.open();expect(menu.isOpen).toBe(true);menu.close()
})
it('removes trigger, list and outside listeners when an open menu is freed',()=>{
 const change=vi.fn(),menu=make(change);menu.setOptions([{value:'a',label:'A'},{value:'b',label:'B'}],'a');menu.open()
 const trigger=menu.trigger,list=menu.list,root=menu.root
 menu.free();menus=[]
 expect(()=>{trigger.click();list.lastChild.click();document.body.click();trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))}).not.toThrow()
 expect(change).not.toHaveBeenCalled();root.remove()
 // A dead open-menu weak reference cannot prevent the next menu opening.
 const next=make();next.open();expect(next.isOpen).toBe(true)
})
it('reuses its arena through 1000 real creation, option, opening and disposal cycles',()=>{
 const cycle=()=>{const menu=new RustSelectMenu('Voz',null,()=>{});menu.setOptions([{value:'a',label:'Ana'}],'a');document.body.append(menu.root);menu.open();menu.root.remove();menu.free()}
 for(let i=0;i<30;i++)cycle();const before=core.memory.buffer.byteLength
 for(let i=0;i<1000;i++)cycle()
 expect(core.memory.buffer.byteLength).toBe(before)
})
