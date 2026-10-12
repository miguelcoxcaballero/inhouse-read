import decorUrl from '../wasm/inhouse_read_decor.wasm?url'
import {createRustLoader} from './rust-loader.js'
const loader = createRustLoader(decorUrl, '__inhouseDecorReady', 1)
export const getRustDecorCore = loader.get
export const loadRustDecorCore = loader.load
