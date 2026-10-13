import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {createLegacyPreparedPageCache as createPreparedPageCache,legacyPageKeyMismatch as pageKeyMismatch} from '../../src/js/prepared-page-legacy.js'
const gates=[]
beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}))
afterEach(()=>{for(const gate of gates.splice(0))gate.free()})
function createStageGate(settled,{idle=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){const gate=new ui.RustStageGate(settled,idle);gates.push(gate);return {wait:()=>gate.wait(),release:reason=>gate.release(reason)}}

describe('createStageGate', () => {
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  it('waits for the settled signal and then for an idle slice', async () => {
    const settled = deferred(), idle = deferred(), events = []
    const gate = createStageGate(settled.promise, { idle:() => { events.push('idle'); return idle.promise } })
    const waited = gate.wait().then(value => { events.push(`go:${value}`) })
    await flush()
    expect(events).toEqual([])
    settled.resolve(true)
    await flush()
    expect(events).toEqual(['idle'])
    idle.resolve()
    await waited
    expect(events).toEqual(['idle', 'go:true'])
  })

  it('skips the work when the selection ended without settling', async () => {
    const settled = deferred()
    const gate = createStageGate(settled.promise, { idle:() => Promise.resolve() })
    settled.resolve(false)
    expect(await gate.wait()).toBe(false)
  })

  it('lets go at once for an open request, even before the pull-out finished or while idle is pending', async () => {
    const never = new Promise(() => {})
    const early = createStageGate(never, { idle:() => never })
    early.release('open')
    expect(await early.wait()).toBe(true)

    const settled = deferred()
    const waiting = createStageGate(settled.promise, { idle:() => never })
    const result = waiting.wait()
    settled.resolve(true)
    await flush()
    waiting.release('open')
    expect(await result).toBe(true)
  })

  it('ends the wait without work when the selection is dismissed or replaced', async () => {
    const never = new Promise(() => {})
    for (const reason of ['dismissed', 'new-selection', 'reader-closed']) {
      const gate = createStageGate(never, { idle:() => never })
      gate.release(reason)
      expect(await gate.wait()).toBe(false)
    }
  })

  it('has nothing to wait for when the shelf gave no signal', async () => {
    expect(await createStageGate(undefined, { idle:() => Promise.resolve() }).wait()).toBe(true)
  })

  it('treats a failing settled signal as a cancelled selection', async () => {
    expect(await createStageGate(Promise.reject(new Error('x')), { idle:() => Promise.resolve() }).wait()).toBe(false)
  })
})
