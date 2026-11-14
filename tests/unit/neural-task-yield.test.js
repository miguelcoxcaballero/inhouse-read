// @vitest-environment node
import {describe,it,expect,vi} from 'vitest'
import {yieldToMessages} from '../../src/js/readers/neural-voice/task-yield.js'
import {readFileSync} from 'node:fs'
describe('finite message-task inference yield',()=>{
  it('settles without a timer even when all timers are suspended',async()=>{
    const timer=vi.spyOn(globalThis,'setTimeout').mockImplementation(()=>123)
    try {await yieldToMessages();await yieldToMessages();expect(timer).not.toHaveBeenCalled()}
    finally {timer.mockRestore()}
  })
  it('yields a task rather than starving incoming messages with microtasks',async()=>{
    let done=false;const task=yieldToMessages().then(()=>{done=true})
    for(let n=0;n<20;n++)await Promise.resolve()
    expect(done).toBe(false);await task;expect(done).toBe(true)
  })
  it('settles concurrent requests exactly once and can be reused after becoming idle',async()=>{
    const order=[];await Promise.all(Array.from({length:100},(_,i)=>yieldToMessages().then(()=>order.push(i))))
    expect(order).toEqual(Array.from({length:100},(_,i)=>i));await yieldToMessages()
  })
  it('uses message tasks in both runtimes and waits for actual drain completion without polling',()=>{
    const worker=readFileSync('src/js/readers/neural-voice/worker.js','utf8'),runtime=readFileSync('src/js/readers/neural-voice/supertonic-runtime.js','utf8'),pages=readFileSync('src/js/readers/speech-page-breaks.js','utf8')
    for(const source of [worker,runtime,pages]){expect(source).toContain('task-yield.js');expect(source).not.toContain('setTimeout(')}
    // The waits of a load and of a free for the running job are rust-ui/src/voice_worker.rs since the worker's runtime moved there.
    const rust=readFileSync('rust-ui/src/voice_worker.rs','utf8')
    expect(rust).toContain('while truthy(&get(w, "plan"), "draining") { settled(get(w, "drainDone")).await?; }')
    expect(rust.match(/ drained\(&?w\)\.await\?/g)).toHaveLength(2)
    expect(rust).toContain('finish.call0(');expect(rust).not.toContain('set_timeout')
  })
})
