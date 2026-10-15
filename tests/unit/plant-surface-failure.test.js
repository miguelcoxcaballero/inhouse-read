// @vitest-environment node
// A plant surface whose full-resolution painting fails keeps its coarse first look on the plants that
// already use it, but it is never saved as a finished painting and the next plant of that kind paints
// it again (the JavaScript painter that used to cover a declined kernel is gone).
import {readFileSync} from 'node:fs';
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
const observed=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-decor-core.js',()=>({getRustDecorCore:()=>observed.core,loadRustDecorCore:async()=>observed.core??(await globalThis.__inhouseDecorReady).exports}));
import {createShelfPlant,plantSurfacesReady,shelfPlantBakeRecord} from '../../src/js/shelf-plants.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_decor.wasm'))).instance.exports;});
afterEach(()=>{observed.core=null;});
const rowKernels=['plant_glaze_rows','plant_pottery_rows','plant_soil_rows','plant_foliage_rows'];
const failingRows=()=>({...core,...Object.fromEntries(rowKernels.map(name=>[name,()=>0]))});
const entry=seed=>({catalogId:'cactus',potId:'akerbar',seed});

it('does not save the coarse look of a failed surface as a finished painting, and paints it again next time',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  observed.core=failingRows();
  const first=createShelfPlant(entry('failing-rows'),{persist:true});
  await plantSurfacesReady();
  expect(warn).toHaveBeenCalled();
  expect(shelfPlantBakeRecord().surfaces).toEqual([]);
  first.userData.dispose();
  warn.mockClear();

  observed.core={...core};
  const second=createShelfPlant(entry('working-rows'),{persist:true});
  await plantSurfacesReady();
  expect(warn).not.toHaveBeenCalled();
  expect(shelfPlantBakeRecord().surfaces.length).toBeGreaterThan(0);
  second.userData.dispose();
 }finally{warn.mockRestore();}
},60_000);
