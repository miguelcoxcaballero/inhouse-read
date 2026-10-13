import coreUrl from '../wasm/inhouse_read_core.wasm?url'
import {createRustLoader} from './rust-loader.js'
import {registerStudioScanCore} from './studio-scan-state.js'
const loader = createRustLoader(coreUrl, '__inhouseRustReady', 0, registerStudioScanCore)
export const getRustCore = loader.get
export const loadRustCore = loader.load
