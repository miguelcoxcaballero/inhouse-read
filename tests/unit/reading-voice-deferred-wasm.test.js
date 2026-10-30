import {afterAll,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {countDispatch} from './helpers/rust-dispatch-observer.js'
const fixture=vi.hoisted(()=>({ui:null,calls:0}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
import './helpers/suite-reading-voice-deferred-pages.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
fixture.ui=countDispatch(ui,name=>{if(name==='voice_prepare_next')fixture.calls++})
afterAll(()=>expect(fixture.calls,'compiled detached preparation').toBeGreaterThan(0))
