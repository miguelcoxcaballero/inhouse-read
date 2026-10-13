import {afterAll,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({ui:null,calls:0}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
import './helpers/suite-reading-voice-refresh-breaks.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
fixture.ui={...ui,voice_refresh_breaks:(...args)=>{fixture.calls++;return ui.voice_refresh_breaks(...args)}}
afterAll(()=>expect(fixture.calls,'compiled layout refresh').toBeGreaterThan(0))
