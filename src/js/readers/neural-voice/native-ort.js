// Android runs the same ONNX tensors on a native executor. A real inference
// completion returns through WebView.evaluateJavascript, so synthesis does
// not wait for a background Worker message queue. No timer or fake audio.
const error = message => Object.assign(new Error(message), {code:'init-failed'})
const constructors = {float32:Float32Array,int64:BigInt64Array}
export function encodeTensor(data, env = globalThis) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const parts = []
  for (let i=0;i<bytes.length;i+=4096) parts.push(String.fromCharCode(...bytes.subarray(i,i+4096)))
  return env.btoa(parts.join(''))
}
export function decodeTensor({type,dims,data}, env = globalThis) {
  const Constructor=constructors[type]
  if (!Constructor || !Array.isArray(dims) || dims.some(n=>!Number.isSafeInteger(n)||n<0)) throw error('Invalid native tensor')
  const raw=env.atob(data),bytes=Uint8Array.from(raw,char=>char.charCodeAt(0))
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
export function createNativeOrt({env=globalThis,bridge=env.InhouseInference}={}) {
  if (bridge?.getProtocol?.()!==1) throw error('Native inference unavailable')
  const token=`${Date.now()}-${Math.random().toString(36).slice(2)}`,pending=new Map()
  let sequence=0,closed=false
  const listener=event=>{
    const m=event.detail
    if (!m || m.token!==token) return
    const call=pending.get(m.id)
    if (!call) return
    pending.delete(m.id)
    if (m.error) call.reject(error(m.error))
    else call.resolve(m.value)
  }
  env.addEventListener('inhouse-inference',listener)
  const call=invoke=>new Promise((resolve,reject)=>{
    if (closed) {reject(error('Native inference released'));return}
    const id=++sequence;pending.set(id,{resolve,reject})
    try {invoke(id)} catch(e) {pending.delete(id);reject(e)}
  })
  const dispose=()=>{
    if(closed)return;closed=true
    env.removeEventListener('inhouse-inference',listener)
    for(const call of pending.values())call.reject(error('Native inference released'))
    pending.clear();bridge.dispose(token)
  }
  bridge.begin(token)
  return {
    Tensor:NativeTensor,
    InferenceSession:{async create(model) {
      const bytes=model instanceof Uint8Array?model:new Uint8Array(model)
      if (!bytes.byteLength) throw error('Empty model')
      // Protocol1 includes release(). A missing endpoint must not fall back
      // to an unbounded synchronous upload; small legacy fixtures stay bounded.
      if(closed)throw error('Native inference released')
      if (bytes.length>4*131072 && typeof bridge.release!=='function') throw error('Native upload fence unavailable')
      const value=await call(id=>{
        const upload=async()=>{
          if(closed || !pending.has(id))return
          bridge.startModel(token,id,bytes.length)
          const now=()=>env.performance?.now?.()??Date.now()
          let sliceStart=now(),chunks=0
          // Preserve the original exact arguments, bytes and ordered offsets.
          // Session keys are positive request IDs; release(0) cannot remove one.
          // Its reply is a genuine executor/UI callback, not a background timer.
          for(let offset=0;offset<bytes.length;offset+=131072) {
            if(closed || !pending.has(id))return
            bridge.modelChunk(token,id,offset,encodeTensor(bytes.subarray(offset,offset+131072),env))
            chunks++
            if(offset+131072<bytes.length && (chunks>=4 || typeof bridge.release==='function' && now()-sliceStart>=4)) {
              const value=await call(request=>bridge.release(token,request,0))
              if(closed || !pending.has(id))return
              if(value!==null)throw error('Invalid native upload fence')
              sliceStart=now();chunks=0
            }
          }
          if(closed || !pending.has(id))return
          bridge.finishModel(token,id)
        }
        upload().catch(reason=>{
          const waiting=pending.get(id)
          if(!waiting)return
          pending.delete(id);waiting.reject(reason)
          // Only the existing native dispose cleans an interrupted upload.
          // Reject the other owned pending requests before removing its token.
          try {dispose()} catch { /* Pending requests are already rejected; preserve the upload error. */ }
        })
      })
      let released=false
      return {inputNames:value.inputNames,outputNames:value.outputNames,
        async run(feeds) {
          if (released) throw error('Native session released')
          const tensors={}
          for(const [name,t] of Object.entries(feeds)) tensors[name]={type:t.type,dims:t.dims,data:encodeTensor(t.data,env)}
          const outputs=await call(id=>bridge.run(token,id,value.session,JSON.stringify(tensors)))
          return Object.fromEntries(Object.entries(outputs).map(([name,t])=>[name,decodeTensor(t,env)]))
        },
        async release() {if(released)return;released=true;await call(id=>bridge.release(token,id,value.session))}
      }
    }},
    dispose
  }
}
