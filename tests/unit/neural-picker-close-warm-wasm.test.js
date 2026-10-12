import {afterAll,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const runtime=vi.hoisted(()=>({ui:null,calls:{}}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
import './neural-picker-close-warm.test.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
runtime.ui={...ui}
for(const name of ['picker_warm','picker_cancel_warm','picker_warm_current'])runtime.ui[name]=(...args)=>{runtime.calls[name]=(runtime.calls[name]||0)+1;return ui[name](...args)}
afterAll(()=>{for(const name of ['picker_warm','picker_cancel_warm','picker_warm_current'])expect(runtime.calls[name],name).toBeGreaterThan(0)})
