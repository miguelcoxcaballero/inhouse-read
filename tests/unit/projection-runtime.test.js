import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {rustShelf,shelfWasm} from './helpers/rust-shelf-ready.js'
import {projectVisibleBookBounds,createBookProjectionPacket} from '../../src/js/book-projection.js'
import {projectPlantFoliage} from '../../src/js/foliage-projection.js'
import {createShelfPlant} from '../../src/js/shelf-plants.js'
import {makeCases} from '../helpers/book-projection-cases.js'

const runtime=vi.hoisted(()=>({ui:null,shelf:null,bookLegacy:0,foliageLegacy:0,uiBook:0,shelfBook:0,uiFoliage:0,shelfFoliage:0,loads:0}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui,loadRustUI:()=>{runtime.loads++;throw Error('Projection must not load UI')}}))
vi.mock('../../src/js/rust-shelf.js',async importOriginal=>({...await importOriginal(),getRustShelf:()=>runtime.shelf}))
vi.mock('../../src/js/book-projection-legacy.js',async importOriginal=>{
 const actual=await importOriginal();return {...actual,visibleBounds:(...args)=>{runtime.bookLegacy++;return actual.visibleBounds(...args)}}
})
vi.mock('../../src/js/foliage-projection-legacy.js',async importOriginal=>{
 const actual=await importOriginal();return {...actual,projectPlantFoliage:(...args)=>{runtime.foliageLegacy++;return actual.projectPlantFoliage(...args)}}
})
const bookLegacy=(await vi.importActual('../../src/js/book-projection-legacy.js')).visibleBounds
const foliageLegacy=(await vi.importActual('../../src/js/foliage-projection-legacy.js')).projectPlantFoliage
const observed=(module,prefix)=>({
 book_projection_bounds:(...args)=>{runtime[prefix+'Book']++;return module.book_projection_bounds(...args)},
 foliage_path:(...args)=>{runtime[prefix+'Foliage']++;return module.foliage_path(...args)},
})
let nativeUI,nativeShelf
const cases=makeCases(THREE),point=new THREE.Vector3(),packet=createBookProjectionPacket()
const species=['monstera','sansevieria','chamaedorea','nephrolepis','zamioculcas','hedera','cactus','succulent']
beforeAll(()=>{
 ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
 nativeUI=observed(ui,'ui');nativeShelf=observed(rustShelf,'shelf')
})
beforeEach(()=>{
 for(const key of ['bookLegacy','foliageLegacy','uiBook','shelfBook','uiFoliage','shelfFoliage','loads'])runtime[key]=0
 runtime.ui=null;runtime.shelf=nativeShelf
})
afterAll(()=>{for(const {model} of cases)model.traverse(mesh=>{mesh.geometry?.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material?.dispose()})})
function projectBook(value){return Array.from(projectVisibleBookBounds(value.model,value.camera,value.width,value.height,point,packet))}
function expectedBook(value){return bookLegacy(value.model,value.camera,value.width,value.height,point)}

for(let block=0;block<Math.ceil(cases.length/100);block++)it('uses Shelf on the home without UI for exact book bounds: block '+block,()=>{
 const values=cases.slice(block*100,(block+1)*100)
 for(const value of values)expect(projectBook(value)).toEqual(expectedBook(value))
 expect(runtime.shelfBook).toBe(values.length);expect(runtime.bookLegacy).toBe(0);expect(runtime.uiBook).toBe(0);expect(runtime.loads).toBe(0)
})
for(const catalogId of species)it('projects production '+catalogId+' in Shelf without UI or legacy at six poses',()=>{
 const model=createShelfPlant({catalogId,potId:'gradvis',seed:'home-native-projection'})
 try{
  for(let i=0;i<6;i++){
   model.position.set(i*3-7,i*5-3,0);model.rotation.set(i*.13,i*.2,i*.07);model.scale.set(i%2?-1:1,1.1,1);model.updateMatrixWorld(true)
   expect(projectPlantFoliage(model)).toEqual(foliageLegacy(model))
  }
  expect(runtime.shelfFoliage).toBeGreaterThan(0);expect(runtime.foliageLegacy).toBe(0);expect(runtime.uiFoliage).toBe(0);expect(runtime.loads).toBe(0)
 }finally{model.userData.dispose()}
})
it('keeps the cold route and switches synchronously to Shelf, then preserves ready UI priority',()=>{
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10));mesh.name='leaf-0';mesh.updateMatrixWorld(true)
 const value=cases[24],expected=expectedBook(value),foliage=foliageLegacy(mesh)
 try{
  runtime.shelf=null
  expect(projectBook(value)).toEqual(expected);expect(projectPlantFoliage(mesh)).toEqual(foliage)
  expect([runtime.bookLegacy,runtime.foliageLegacy,runtime.shelfBook,runtime.shelfFoliage]).toEqual([1,1,0,0])
  runtime.shelf=nativeShelf
  expect(projectBook(value)).toEqual(expected);expect(projectPlantFoliage(mesh)).toEqual(foliage)
  expect([runtime.bookLegacy,runtime.foliageLegacy,runtime.shelfBook,runtime.shelfFoliage]).toEqual([1,1,1,1])
  runtime.ui=nativeUI
  expect(projectBook(value)).toEqual(expected);expect(projectPlantFoliage(mesh)).toEqual(foliage)
  expect([runtime.uiBook,runtime.uiFoliage,runtime.shelfBook,runtime.shelfFoliage]).toEqual([1,1,1,1])
  runtime.shelf=null
  expect(projectBook(value)).toEqual(expected);expect(projectPlantFoliage(mesh)).toEqual(foliage)
  expect([runtime.uiBook,runtime.uiFoliage,runtime.loads]).toEqual([2,2,0])
 }finally{mesh.geometry.dispose();mesh.material.dispose()}
})
it('checks the particular capability without assuming a partially ready module supports it',()=>{
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10));mesh.name='leaf-0';mesh.updateMatrixWorld(true)
 try{
  runtime.ui={};expect(projectBook(cases[24])).toEqual(expectedBook(cases[24]));expect(projectPlantFoliage(mesh)).toEqual(foliageLegacy(mesh))
  expect([runtime.shelfBook,runtime.shelfFoliage]).toEqual([1,1])
  runtime.shelf={};expect(projectBook(cases[24])).toEqual(expectedBook(cases[24]));expect(projectPlantFoliage(mesh)).toEqual(foliageLegacy(mesh))
  expect([runtime.bookLegacy,runtime.foliageLegacy]).toEqual([1,1]);expect(runtime.loads).toBe(0)
 }finally{mesh.geometry.dispose();mesh.material.dispose()}
})
it('retains custom attribute behavior when only Shelf is ready',()=>{
 for(const kind of ['accessor','normalized','double']){
  const geometry=new THREE.PlaneGeometry(10,10),mesh=new THREE.Mesh(geometry);mesh.name='leaf-0'
  if(kind==='accessor')geometry.attributes.position.getX=function(index){return this.array[index*3]+2}
  if(kind==='normalized')geometry.attributes.position.normalized=true
  if(kind==='double')geometry.setAttribute('position',new THREE.BufferAttribute(new Float64Array(geometry.attributes.position.array),3))
  mesh.updateMatrixWorld(true)
  try{expect(projectPlantFoliage(mesh)).toEqual(foliageLegacy(mesh))}finally{geometry.dispose();mesh.material.dispose()}
 }
 expect(runtime.shelfFoliage).toBe(0);expect(runtime.foliageLegacy).toBe(3)
})
it('keeps per-mesh fallback when the preferred ready module declines without trying a different owner',()=>{
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10));mesh.name='leaf-0';mesh.updateMatrixWorld(true)
 try{
  runtime.ui={book_projection_bounds:()=>undefined,foliage_path:()=>undefined}
  expect(projectBook(cases[24])).toEqual(expectedBook(cases[24]));expect(projectPlantFoliage(mesh)).toEqual(foliageLegacy(mesh))
  expect([runtime.shelfBook,runtime.shelfFoliage,runtime.bookLegacy,runtime.foliageLegacy]).toEqual([0,0,1,1])
 }finally{mesh.geometry.dispose();mesh.material.dispose()}
})
it('bounds native memory and references across repeated Shelf-only production projections',()=>{
 const models=species.map(catalogId=>createShelfPlant({catalogId,potId:'gradvis',seed:'home-native-memory'}))
 for(const model of models)model.updateMatrixWorld(true)
 const values=[cases[24],cases[149],cases.at(-1)]
 const run=()=>{for(const value of values)projectBook(value);for(const model of models)projectPlantFoliage(model)}
 try{
  for(let i=0;i<3;i++)run()
  const bytes=shelfWasm.memory.buffer.byteLength,handles=rustShelf.shelf_live_handles(),capacity=packet.data.length
  for(let i=0;i<20;i++)run()
  expect(shelfWasm.memory.buffer.byteLength).toBe(bytes);expect(rustShelf.shelf_live_handles()).toBe(handles);expect(packet.data.length).toBe(capacity)
  expect(runtime.bookLegacy).toBe(0);expect(runtime.foliageLegacy).toBe(0);expect(runtime.loads).toBe(0)
 }finally{for(const model of models)model.userData.dispose()}
})
