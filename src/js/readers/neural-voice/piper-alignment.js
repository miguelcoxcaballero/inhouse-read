// Expose VITS' existing phoneme durations as a second ONNX output. Weights,
// operators and the audio output are untouched. Unknown graphs stay untouched.
// The protobuf of the ~63 MB model is walked where it is: copying it into the Rust core's memory would double what the
// worker keeps resident for nothing. Where the boundaries fall in the audio is synth-flow.js (Rust).
const decode = new TextDecoder(), encode = new TextEncoder()
function varint(bytes, at, end) {
  let value = 0, shift = 0, byte
  do {
    if (at >= end || shift > 49) throw new Error('Invalid protobuf')
    byte = bytes[at++]; value += (byte & 127) * 2 ** shift; shift += 7
  } while (byte & 128)
  if (!Number.isSafeInteger(value)) throw new Error('Invalid length')
  return [value,at]
}
function fields(bytes, start = 0, end = bytes.length) {
  const result = []
  for (let at = start; at < end;) {
    const begin = at
    let tag, length; [tag,at] = varint(bytes,at,end)
    const wire = tag & 7, number = Math.floor(tag / 8)
    if (!number) throw new Error('Invalid field')
    let data = at, stop
    if (wire === 2) { [length,at] = varint(bytes,at,end); data = at; stop = at + length }
    else if (wire === 0) [,stop] = varint(bytes,at,end)
    else if (wire === 1) stop = at + 8
    else if (wire === 5) stop = at + 4
    else throw new Error('Unsupported protobuf field')
    if (stop > end || result.length > 100000) throw new Error('Invalid graph')
    result.push({number,wire,begin,data,end:stop}); at = stop
  }
  return result
}
const vint = value => { const result = []; do { const part = value % 128; value = Math.floor(value / 128); result.push(part | (value ? 128 : 0)) } while (value); return result }
const field = (n, bytes) => Uint8Array.from([...vint(n * 8 + 2),...vint(bytes.length),...bytes])
const string = (n, value) => field(n,encode.encode(value))
export function exposePiperDurations(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  try {
    const graph = fields(bytes).filter(f => f.number === 7 && f.wire === 2)
    if (graph.length !== 1) return {bytes,name:null}
    const g = graph[0], entries = fields(bytes,g.data,g.end)
    const str = f => decode.decode(bytes.subarray(f.data,f.end))
    const names = n => entries.filter(f => f.number === n).map(f => fields(bytes,f.data,f.end).find(v => v.number === 1)).filter(Boolean).map(str)
    if (!['input','input_lengths','scales'].every(n => names(11).includes(n))) return {bytes,name:null}
    const nodes = entries.filter(f => f.number === 1).map(f => {
      const values = fields(bytes,f.data,f.end)
      return {op:str(values.find(v => v.number === 4)),inputs:values.filter(v => v.number === 1).map(str),outputs:values.filter(v => v.number === 2).map(str)}
    })
    const candidates = nodes.filter(n => n.op === 'Ceil' && n.outputs.length === 1 && nodes.some(next => next.op === 'CumSum' && next.inputs[0] === n.outputs[0]))
    if (candidates.length !== 1) return {bytes,name:null}
    const name = candidates[0].outputs[0]
    if (names(12).includes(name)) return {bytes,name}
    const shape = Uint8Array.from([...field(1,[8,1]),...field(1,[8,1]),...field(1,string(2,'phonemes'))])
    const type = field(2,field(1,Uint8Array.from([8,1,...field(2,shape)])))
    const output = field(12,Uint8Array.from([...string(1,name),...type]))
    const header = Uint8Array.from([...vint(7 * 8 + 2),...vint(g.end - g.data + output.length)])
    const result = new Uint8Array(g.begin + header.length + g.end - g.data + output.length + bytes.length - g.end)
    let at = 0
    for (const part of [bytes.subarray(0,g.begin),header,bytes.subarray(g.data,g.end),output,bytes.subarray(g.end)]) { result.set(part,at); at += part.length }
    return {bytes:result,name}
  } catch { return {bytes,name:null} }
}

// At most the page boundaries of this utterance are phonemized; acoustic
// inference still runs ONCE for the whole sentence, with its natural prosody.
export async function phonemeMarks(text, marks, ids, phonemize) {
  const output = []
  for (const offset of [...new Set(marks || [])].filter(n => Number.isInteger(n) && n > 0 && n < text.length).sort((a,b) => a-b)) {
    const prefix = await phonemize(text.slice(0,offset))
    let phoneme = 0
    while (phoneme < prefix.length && phoneme < ids.length && prefix[phoneme] === ids[phoneme] && prefix[phoneme] !== 2) phoneme++
    if (phoneme > 0) output.push({offset,phoneme})
  }
  return output
}
