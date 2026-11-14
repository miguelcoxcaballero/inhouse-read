// @vitest-environment node
// The top-left board of the 80-book isometric smoke test: twelve fresh books, five of them laid out through a real
// 12 cm pot, in a row that has no room left for all of them on the board. From 1.7.280 to 1.7.329 two or three of
// those books were seeded standing on the pot and rocked about four degrees for ever, so the shelf never stopped
// repainting. The fixture is the first solver frame captured from that browser test.
import {readFileSync} from 'node:fs'
import {expect,it} from 'vitest'
import {plantGeometrySpec} from '../../src/js/decor-geometry-spec.js'
import {rustShelf} from './helpers/rust-shelf-ready.js'

const fixture=JSON.parse(readFileSync(new URL('./fixtures/pot-row-80-books.json',import.meta.url),'utf8'))
const entries=fixture.entries.map(entry=>({...entry,state:entry.state.map(value=>value??NaN)}))

function run({reduced,frames}){
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(fixture.width,fixture.height,fixture.width,fixture.depth,false,false,0)
 let pot
 for(const entry of entries)if(entry.plant){
  const p=entry.geometry[3],plant=plantGeometrySpec({...entry.plant,height:entry.state[26],width:entry.state[25]})
  pot={radius:plant.real.potDiameter/2*plant.unit/p,height:plant.real.potHeight*plant.unit/p}
  solver.decoration(entry.key,1,plant.potId||'',plant.potModelId||'',Float64Array.of(pot.radius,pot.height,plant.height/p,0))
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
 // Metres: x from the left end of the board, y above the board.
 const poses=output=>entries.map((entry,i)=>{
  const p=entry.geometry[3],angle=output[i*4],width=entry.geometry[0]/p,height=entry.state[26]/p
  const x=(entry.state[23]+output[i*4+1])/p,y=(entry.geometry[6]-entry.state[24]+output[i*4+2])/p
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>[x+a*width/2*Math.cos(angle)-b*height/2*Math.sin(angle),y+a*width/2*Math.sin(angle)+b*height/2*Math.cos(angle)])
  return {key:entry.key,plant:Boolean(entry.plant),angle,x,y,width,height,corners,low:Math.min(...corners.map(c=>c[1])),active:output[i*4+3]}
 })
 return {history,pot,poses}
}
// Separating axes of two convex quadrilaterals: how deep they overlap, or a negative gap.
function overlap(a,b){
 let depth=Infinity
 for(const quad of [a,b])for(let i=0;i<4;i++){
  const [x1,y1]=quad[i],[x2,y2]=quad[(i+1)%4],length=Math.hypot(x2-x1,y2-y1),axis=[(y2-y1)/length,(x1-x2)/length]
  const span=points=>{const values=points.map(([x,y])=>x*axis[0]+y*axis[1]);return [Math.min(...values),Math.max(...values)]}
  const [a0,a1]=span(a),[b0,b1]=span(b);depth=Math.min(depth,Math.min(a1,b1)-Math.max(a0,b0))
 }
 return depth
}

for(const reduced of [false,true])it(`brings the row of fresh books around a pot to rest (reduced motion ${reduced})`,()=>{
 const frames=reduced?40:1500,{history,pot,poses}=run({reduced,frames})
 // Every body asleep, and no later frame presents a different pose: nothing left to repaint.
 const settled=history.findIndex(output=>entries.every((_,i)=>output[i*4+3]===0))
 expect(settled).toBeGreaterThanOrEqual(0)
 for(const output of history.slice(settled))expect([...output]).toEqual([...history[settled]])
 const rest=poses(history.at(-1)),books=rest.filter(pose=>!pose.plant),plant=rest.find(pose=>pose.plant)
 // The pot stands on its board; it has not been lifted onto a book.
 expect(plant.low*1000).toBeGreaterThan(-.1);expect(plant.low*1000).toBeLessThan(1.5)
 const core=[[plant.x-pot.radius*.7,0],[plant.x+pot.radius*.7,0],[plant.x+pot.radius*.7,pot.height-.002],[plant.x-pot.radius*.7,pot.height-.002]]
 const standing=books.filter(book=>Math.abs(Math.sin(book.angle))<.5)
 for(const book of books){
  expect(book.low*1000,book.key).toBeGreaterThan(-.1)
  // No book is inside the pot, and none stands or lies on it.
  expect(overlap(book.corners,core)*1000,book.key).toBeLessThan(1)
  expect(Math.abs(book.x-plant.x)<pot.radius&&Math.abs(book.low-pot.height)<.01,book.key).toBe(false)
  // A book that stands, stands on the board. One that does not lies on the standing books, clear of the board.
  if(standing.includes(book))expect(book.low*1000,book.key).toBeLessThan(3)
  else expect(standing.some(other=>other.x>Math.min(...book.corners.map(c=>c[0]))&&other.x<Math.max(...book.corners.map(c=>c[0]))&&book.low>other.height*.8),book.key).toBe(true)
 }
 // No two books interpenetrate (resting contacts overlap by a fraction of a millimetre).
 for(let i=0;i<books.length;i++)for(let j=i+1;j<books.length;j++)expect(overlap(books[i].corners,books[j].corners)*1000,`${books[i].key} ${books[j].key}`).toBeLessThan(1)
})

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
