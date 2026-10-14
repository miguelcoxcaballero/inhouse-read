// Preserve the full original neural-engine assertions on the compiled path.
import {afterAll,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({ui:null,calls:0,primes:0}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
import './helpers/suite-reading-voice-neural.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
fixture.ui={...ui,voice_for:(...args)=>{fixture.calls++;return ui.voice_for(...args)},voice_prepare_playback:(...args)=>{fixture.primes++;return ui.voice_prepare_playback(...args)}}
afterAll(()=>{expect(fixture.calls,'compiled voice selection').toBeGreaterThan(0);expect(fixture.primes,'compiled audio priming').toBeGreaterThan(0)})
