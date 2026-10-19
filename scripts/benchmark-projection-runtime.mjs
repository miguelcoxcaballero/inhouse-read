// Complete host projection calls at home readiness: shelf is ready, UI absent.
// Includes Three traversal, packet packing and path formatting, excludes GPU.
// Run with: npx vite-node scripts/benchmark-projection-runtime.mjs [report.json]
import {readFileSync,writeFileSync} from 'node:fs'
import {performance} from 'node:perf_hooks'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import '../tests/unit/helpers/rust-shelf-ready.js'
import '../tests/unit/helpers/rust-core-ready.js'
import {loadRustDecorCore} from '../src/js/rust-decor-core.js'
import {getRustUI} from '../src/js/rust-ui.js'
import {projectVisibleBookBounds,createBookProjectionPacket} from '../src/js/book-projection.js'
import {visibleBounds} from '../src/js/book-projection-legacy.js'
import {projectPlantFoliage} from '../src/js/foliage-projection.js'
import {projectPlantFoliage as legacyFoliage} from '../src/js/foliage-projection-legacy.js'
await loadRustDecorCore({bytes:readFileSync('src/wasm/inhouse_read_decor.wasm')})
const {createShelfPlant}=await import('../src/js/shelf-plants.js')
assert.equal(getRustUI(),null)
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)],results=[]
let checksum=0
function measure(kind,count,legacy,native,loops){
 for(let i=0;i<100;i++){legacy();native()}
 const oldTimes=[],newTimes=[]
 const time=fn=>{const start=performance.now();for(let i=0;i<loops;i++)fn();return(performance.now()-start)/loops}
 for(let i=0;i<21;i++)if(i%2){newTimes.push(time(native));oldTimes.push(time(legacy))}else{oldTimes.push(time(legacy));newTimes.push(time(native))}
 const legacyMs=median(oldTimes),shelfMs=median(newTimes)
 results.push({kind,count,legacyMs,shelfMs,speedup:legacyMs/shelfMs})
}
const camera=new THREE.OrthographicCamera(-195,195,422,-422,.1,10000)
camera.position.set(12,9,1800);camera.rotation.set(.1,.17,.04);camera.updateMatrixWorld(true)
for(const count of [8,32,128]){
 const model=new THREE.Group(),point=new THREE.Vector3(),packet=createBookProjectionPacket()
 for(let i=0;i<count;i++){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(4+i%3,130+i%7,3),new THREE.MeshBasicMaterial())
  mesh.position.set(i*7,15,0);mesh.rotation.set(.04,i*.01,.08);model.add(mesh)
 }
 model.rotation.set(.12,.27,.1);model.updateMatrixWorld(true)
 const previous=()=>visibleBounds(model,camera,390,844,point)
 const current=()=>projectVisibleBookBounds(model,camera,390,844,point,packet)
 assert.deepEqual(Array.from(current()),previous())
 measure('book-visible-meshes',count,()=>{checksum+=previous()[0]},()=>{checksum+=current()[0]},500)
 model.traverse(mesh=>{mesh.geometry?.dispose();mesh.material?.dispose()})
}
for(const catalogId of ['monstera','sansevieria','chamaedorea','nephrolepis','zamioculcas','hedera','cactus','succulent']){
 const model=createShelfPlant({catalogId,potId:'gradvis',seed:'home-projection-benchmark'})
 try{
  model.position.set(5,-7,0);model.rotation.set(.13,.2,.07);model.updateMatrixWorld(true)
  const previous=()=>legacyFoliage(model),current=()=>projectPlantFoliage(model)
  assert.deepEqual(current(),previous())
  measure(catalogId,previous().triangles,()=>{checksum+=previous().path.length},()=>{checksum+=current().path.length},20)
 }finally{model.userData.dispose()}
}
assert.equal(getRustUI(),null)
const report={date:new Date().toISOString(),scope:'full projection bridge; real production plant geometry and representative Three book mesh groups; UI absent; no GPU/battery measurement; shared host load',checksum,results}
console.log(JSON.stringify(report,null,2));if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n')
