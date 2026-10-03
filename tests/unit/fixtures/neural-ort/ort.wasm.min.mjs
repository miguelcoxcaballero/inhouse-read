// Worker protocol tests inject sessions without using real WASM weights.
export const env = {wasm:{},versions:{common:'test'}}
export const InferenceSession = {create:(...args)=>globalThis.__neuralOrt.create(...args)}
export class Tensor { constructor(type,data,dims){Object.assign(this,{type,data,dims})} dispose(){} }
