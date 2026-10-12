// Run the unchanged voice integration assertions again through compiled Rust.
import {afterAll,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({ui:null,calls:{}}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
import './reading-voice.test.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const observed=['voice_play','voice_pause','voice_stop','voice_cancel','voice_restart','voice_retry','voice_for','voice_upcoming','voice_audio_item','voice_needs_join','voice_browse','voice_continue_page','voice_prepare_ahead','voice_clear_ahead','voice_adopt_plan','voice_page_valid','voice_engine_started','voice_engine_ended','voice_present','voice_unpaint','voice_prepare','voice_prepare_opening','voice_speak_current','voice_speak_neural','voice_advance']
observed.push('voice_initialize','voice_event','voice_prepare_text')
fixture.ui={...ui}
for(const name of observed)fixture.ui[name]=(...args)=>{fixture.calls[name]=(fixture.calls[name]||0)+1;return ui[name](...args)}
afterAll(()=>{for(const name of observed)expect(fixture.calls[name],name).toBeGreaterThan(0)})
