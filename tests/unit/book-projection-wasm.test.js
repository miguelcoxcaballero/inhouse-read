// @vitest-environment node
import {it,expect,beforeAll} from 'vitest'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {nativeBounds,createBookProjectionPacket} from '../../src/js/book-projection.js'
import {visibleBounds} from '../../src/js/book-projection-legacy.js'
import {makeCases} from '../helpers/book-projection-cases.js'
const cases=makeCases(THREE),blocks=Math.ceil(cases.length/100),point=new THREE.Vector3(),packet=createBookProjectionPacket();let core,retained,capacity
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
function compare({model,camera,width,height}){expect(Array.from(nativeBounds(ui,model,camera,width,height,packet))).toEqual(visibleBounds(model,camera,width,height,point))}
it('proves that the handle counter observes retention and release',()=>{
 const before=ui.ui_live_handles(),control=new ui.RustReadingProgressQueue(()=>{},()=>{},()=>{})
 try{expect(ui.ui_live_handles()).toBeGreaterThan(before)}finally{control.free()}
 expect(ui.ui_live_handles()).toBe(before)
})
for(let block=0;block<blocks;block++)it('keeps exact corners and IEEE boundary behavior: block '+block,()=>{
 for(const value of cases.slice(block*100,(block+1)*100))compare(value)
 if(block===blocks-1){retained=ui.ui_live_handles();capacity=core.memory.buffer.byteLength}
})
for(let block=0;block<blocks;block++)it('keeps packet capacity, memory and references bounded: block '+block,()=>{
 for(let cycle=0;cycle<2;cycle++)for(const value of cases.slice(block*100,(block+1)*100))compare(value)
 expect(ui.ui_live_handles()).toBe(retained);expect(core.memory.buffer.byteLength).toBe(capacity)
})
it('rejects incomplete and oversized matrix packets',()=>{
 for(const [records,inverse,projection]of [[new Float64Array(1),new Float64Array(16),new Float64Array(16)],[new Float64Array(22),new Float64Array(15),new Float64Array(16)],[new Float64Array(22),new Float64Array(16),new Float64Array(17)],[new Float64Array(1025*22),new Float64Array(16),new Float64Array(16)]])expect(ui.book_projection_bounds(records,inverse,projection,390,844)).toBeUndefined()
})
