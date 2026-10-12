// Repeat the unchanged physical PDF/page-boundary assertions through Rust.
import {afterAll,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({ui:null,calls:0}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
import './reading-voice-page-boundaries.test.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
fixture.ui={...ui,voice_join_sentence:(...args)=>{fixture.calls++;return ui.voice_join_sentence(...args)}}
afterAll(()=>{expect(fixture.calls).toBeGreaterThan(0)})
