// Exercise the original installed/missing/failed natural voice cases in Rust too.
import {afterAll,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({ui:null,calls:0}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
import './reading-voice-neural.test.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
fixture.ui={...ui,voice_for:(...args)=>{fixture.calls++;return ui.voice_for(...args)}}
afterAll(()=>{expect(fixture.calls).toBeGreaterThan(0)})
