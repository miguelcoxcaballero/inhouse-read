import coreUrl from '../wasm/inhouse_read_core.wasm?url'
import {createRustLoader} from './rust-loader.js'
const loader = createRustLoader(coreUrl, '__inhouseRustReady', 0)
export const getRustCore = loader.get
export const loadRustCore = loader.load
