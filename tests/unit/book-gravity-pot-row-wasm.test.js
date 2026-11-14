// @vitest-environment node
// The top-left board of the 80-book isometric smoke test as the solver first received it in 1.7.329: twelve fresh
// books, five of them with a layout slot that ran through a real 12 cm pot. Captured from that browser test.
import {readFileSync} from 'node:fs'
import {expect,it} from 'vitest'
import {plantGeometrySpec} from '../../src/js/decor-geometry-spec.js'
import {rustShelf} from './helpers/rust-shelf-ready.js'

const fixture=JSON.parse(readFileSync(new URL('./fixtures/pot-row-80-books.json',import.meta.url),'utf8'))
const entries=fixture.entries.map(entry=>({...entry,state:entry.state.map(value=>value??NaN)}))

function run({reduced,frames}){
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(fixture.width,fixture.height,fixture.width,fixture.depth,false,false,0)
 for(const entry of entries)if(entry.plant){
  const p=entry.geometry[3],plant=plantGeometrySpec({...entry.plant,height:entry.state[26],width:entry.state[25]})
  solver.decoration(entry.key,1,plant.potId||'',plant.potModelId||'',Float64Array.of(plant.real.potDiameter/2*plant.unit/p,plant.real.potHeight*plant.unit/p,plant.height/p,0))
 }
 const history=[];let clock=0
 for(let frame=0;frame<frames;frame++){
  scene.beginEntries(clock,reduced,1,new Float64Array([0,0,0,1]),1,390,0,18)
  const states=new Float64Array(entries.length*37),geometry=new Float64Array(entries.length*9)
  entries.forEach((entry,i)=>{states.set(entry.state,i*37);states[i*37+12]=1;geometry.set(entry.geometry,i*9)})
  const output=new Float64Array(entries.length*4);solver.step(entries.map(entry=>entry.key),states,geometry,scene,clock,reduced,output);clock+=1000/60
  history.push(output)
 }
 solver.free();scene.free()
 return {history}
}
it('never drops a quiet pot or book into its support while the rest of its contact island is still moving',()=>{
 // Rapier solves a body that is flagged asleep inside an awake island as a wall and stops holding it: the old
 // per-body 0.75 s rule let such a body sink 0.6 mm into its board and pushed it back out, about once a second.
 const {history}=run({reduced:false,frames:900})
 for(let i=0;i<entries.length;i++){
  // After the first second nothing that stays within a millimetre of its place may hop.
  const heights=history.slice(60).map(output=>output[i*4+2]/entries[i].geometry[3]*1000)
  for(let frame=1;frame<heights.length;frame++)if(Math.abs(heights[frame]-heights[frame-1])<1)expect(heights[frame]-heights[frame-1],`${entries[i].key} frame ${frame+60}`).toBeGreaterThan(-.3)
 }
})
