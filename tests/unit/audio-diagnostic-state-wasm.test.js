// Run the unchanged voice integration assertions again through compiled Rust.
import {afterAll,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({ui:null,calls:{}}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
import './helpers/suite-audio-diagnostic-state.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const observed=['voice_initialize','voice_event','voice_diagnostic','voice_prepare_text']
fixture.ui={...ui}
for(const name of observed)fixture.ui[name]=(...args)=>{fixture.calls[name]=(fixture.calls[name]||0)+1;return ui[name](...args)}
afterAll(()=>{for(const name of observed)expect(fixture.calls[name],name).toBeGreaterThan(0)})
