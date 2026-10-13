import voiceUrl from '../wasm/inhouse_read_voice.wasm?url'
import {createRustLoader} from './rust-loader.js'
const loader=createRustLoader(voiceUrl,'__inhouseVoiceReady',2)
export const getRustVoiceCore=loader.get
export const loadRustVoiceCore=loader.load
