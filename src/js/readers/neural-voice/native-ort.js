// Android runs the same ONNX tensors on a native executor. A real inference
// completion returns through WebView.evaluateJavascript, so synthesis does
// not wait for a background Worker message queue. No timer or fake audio.
import {readerUI as ui} from '../rust-ui-required.js'
const error = message => Object.assign(new Error(message), {code:'init-failed'})
const constructors = {float32:Float32Array,int64:BigInt64Array}
export function encodeTensor(data, env = globalThis) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  // Recent Android WebViews encode bytes directly in native code. Avoid
  // copying each 128 KiB upload through a JS character array and a UTF-16 string.
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64()
  const parts = []
  for (let i=0;i<bytes.length;i+=4096) parts.push(String.fromCharCode(...bytes.subarray(i,i+4096)))
  return env.btoa(parts.join(''))
}
export function decodeTensor({type,dims,data}, env = globalThis) {
  const Constructor=constructors[type]
  if (!Constructor || !Array.isArray(dims) || dims.some(n=>!Number.isSafeInteger(n)||n<0)) throw error('Invalid native tensor')
  const bytes=typeof Uint8Array.fromBase64==='function'
    ? Uint8Array.fromBase64(data)
    : Uint8Array.from(env.atob(data),char=>char.charCodeAt(0))
  if (bytes.byteLength%Constructor.BYTES_PER_ELEMENT || dims.reduce((a,b)=>a*b,1)*Constructor.BYTES_PER_ELEMENT!==bytes.byteLength) throw error('Invalid native tensor length')
  return new NativeTensor(type,new Constructor(bytes.buffer),dims)
}
export class NativeTensor {
  constructor(type,data,dims) {
    const Constructor=constructors[type]
    if (!Constructor || !(data instanceof Constructor) || !Array.isArray(dims) || dims.some(n=>!Number.isSafeInteger(n)||n<0) || dims.reduce((a,b)=>a*b,1)!==data.length) throw error('Invalid tensor')
    this.type=type;this.data=data;this.dims=dims
  }
  dispose() {}
}
// The runtime: the request numbering, the model upload with its executor fences, the inference round trip and the
// release are rust-ui (native_ort.rs). The tensor codec, the event listener and the session objects stay here.
const codec={encode:encodeTensor,decode:decodeTensor}
const session=(state,value)=>{
  const record={value,released:false}
  return {inputNames:value.inputNames,outputNames:value.outputNames,
    run:feeds=>ui().native_ort_run(state,record,feeds,codec),
    release:()=>ui().native_ort_release(state,record)}
}
export function createNativeOrt({env=globalThis,bridge=env.InhouseInference}={}) {
  const state=ui().native_ort_open(env,bridge)
  state.listener=event=>ui().native_ort_event(state,event)
  env.addEventListener('inhouse-inference',state.listener)
  bridge.begin(state.token)
  return {
    Tensor:NativeTensor,
    InferenceSession:{create:model=>ui().native_ort_create(state,model,codec,session)},
    dispose:()=>ui().native_ort_dispose(state)
  }
}
