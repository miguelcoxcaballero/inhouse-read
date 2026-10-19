// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {needRustShelf} from '../../src/js/rust-shelf.js';
import {POT_CATALOG,getPotColors} from '../../src/js/plant-catalog-data.js';
const r=needRustShelf();
const srgb=hex=>{const n=parseInt(hex.slice(1),16);return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]};
const hash=(x,y,seed)=>{let h=Math.imul(x|0,0x27d4eb2d)^Math.imul(y|0,0x165667b1)^Math.imul(seed|0,0x9e3779b1);h=Math.imul(h^h>>>15,0x85ebca6b);h=Math.imul(h^h>>>13,0xc2b2ae35);return((h^h>>>16)>>>0)/4294967296};
it('retains every botanical pigment, phase and raster dimension at both quality levels',()=>{
 for(const variant of ['upright','leafy','monstera','ivy','zz','fern','palm','succulent','cactus'])for(const level of [1,2]){
  const plan=r.plant_leaf_surface(variant,level),color={zz:'#2f5324',fern:'#4a7a2c',succulent:'#6a8a80',ivy:'#2a4c23',palm:'#3d6c2a',monstera:'#2f6128'}[variant]??'#36672c';
  const config=variant==='upright'?new Float64Array(5):new Float64Array([...srgb(color),hash(variant.length,3,11)*Math.PI*2,variant.charCodeAt(0)]);
  expect(plan).toEqual({key:`leaf:${variant}:${level}`,width:128*level,height:(variant==='upright'?256:128)*level,repeat:false,spec:{family:3,kind:variant==='upright'?3:variant==='ivy'?1:variant==='succulent'?2:0,config}});
 }
});
it('retains every pot finish recipe and palette without changing stored cache keys',()=>{
 for(const pot of POT_CATALOG)for(const color of getPotColors(pot.id))for(const level of [1,2]){
  const model=pot.modelId||pot.id,plan=r.plant_pot_surface(pot.id,model,color.hex,'#a97958',level);let config=[...srgb(color.hex)],family=1,kind=0;
  if(model==='muskot'){family=0;config.push(...srgb('#cfbea3'),.24,.0022,.55,17)}
  else if(model==='gradvis'){family=0;config.push(...srgb('#c7a291'),.42,.004,0,29)}
  else if(model==='akerbar'){kind=1;config.push(41)}else config.push(53);
  expect(plan).toEqual({key:`pot:${pot.id}:${color.hex}:${level}`,width:128*level,height:256*level,repeat:true,spec:{family,kind,config:new Float64Array(config)}});
 }
});
it('keeps leaf shader material coefficients exactly, including reflective ivy and succulent bump scale',()=>{
 for(const variant of ['upright','leafy','monstera','ivy','zz','fern','palm','succulent','cactus'])for(const width of [0,33.17,180.5])expect(r.plant_leaf_material(variant,width)).toEqual({
  color:0xffffff,vertexColors:true,bumpScale:width*(variant==='succulent'?.00035:.0012),sheen:variant==='succulent'?.25:variant==='ivy'?0:.08,sheenColor:'#acc394',sheenRoughness:.85,
  alphaTest:0,alphaToCoverage:false,specularIntensity:variant==='ivy'?.1:.6,roughness:variant==='zz'?.55:variant==='ivy'?.66:variant==='succulent'?.88:.85,
  metalness:0,clearcoat:variant==='zz'?.32:variant==='ivy'?.1:variant==='succulent'?.035:.12,clearcoatRoughness:variant==='ivy'?.3:.48
 });
});
it('keeps seed UTF-16 units and exact random offsets across legacy values',()=>{
 const geometry={catalogPlant:{id:'cactus',variant:'cactus'},potId:'akerbar',real:{canopy:25,potDiameter:15,potHeight:20},unit:.61,height:130};
 for(const seed of [0,1,'','ñandú','🌿','\ud800','x\udfff','x'.repeat(2048)]){
  const plan=r.plant_appearance({seed},geometry,{hex:'#d2c4ae'},true),text=String(seed),units=Uint16Array.from({length:text.length},(_,i)=>text.charCodeAt(i));
  expect(plan.units).toEqual(units);expect(plan.seed).toBe(text);expect(plan.offset).toBe(r.plant_random(units,1)[0]);expect(plan.bakeKey).toBe(JSON.stringify(['cactus','cactus','akerbar',text,130]));
  expect(plan.repeat).toBe(Math.max(1,Math.round(Math.PI*4*(15/2*.61)*(.6-.07)/(20*.61))));
 }
});
it('cleans already prepared maps when a later binding fails without retaining native handles',()=>{
 const first={map:{dispose:vi.fn()},data:{dispose:vi.fn()}},error=Error('surface unavailable');
 const state=r.plant_lifecycle_state({},new Set(),new Set(),new Set());
 state.host={surfaceBindings:[{material:{},create:()=>first},{material:{},create(){throw error}}]};
 const before=r.shelf_live_handles();
 for(let i=0;i<12;i++)expect(()=>r.plant_prepare_quality(state,256)).toThrow(error);
 expect(first.map.dispose).toHaveBeenCalledTimes(12);expect(first.data.dispose).toHaveBeenCalledTimes(12);expect(state.pendingQuality).toBeNull();expect(r.shelf_live_handles()).toBe(before);
});
it('cancels obsolete inspection maps on color changes and keeps the model and exact new pigment source',async()=>{
 const {createShelfPlant}=await import('../../src/js/shelf-plants.js'),jobs=[];
 vi.stubGlobal('requestIdleCallback',callback=>jobs.push(callback));
 const finish=async()=>{while(jobs.length)jobs.shift()({timeRemaining:()=>100});await Promise.resolve();};
 let plant,reference;
 try{
  const entry={catalogId:'sansevieria',potId:'muskot',potColorId:'ivory',seed:'native-palette'};
  plant=createShelfPlant(entry);await finish();const pot=plant.getObjectByName('ceramic-pot'),geometry=pot.geometry,material=pot.material;
  const stale=plant.userData.prepareSurfaceQuality(256);
  expect(plant.userData.updatePotColor('charcoal')).toBe(true);reference=createShelfPlant({...entry,potColorId:'charcoal'});await finish();
  expect(await stale.ready).toBe(false);expect(stale.apply()).toBe(false);
  expect(plant.getObjectByName('ceramic-pot').geometry).toBe(geometry);expect(plant.getObjectByName('ceramic-pot').material).toBe(material);
  expect(pot.material.map.source).toBe(reference.getObjectByName('ceramic-pot').material.map.source);expect(plant.userData.potColorId).toBe('charcoal');
  plant.userData.dispose();const closed=plant.userData.prepareSurfaceQuality(256);expect(await closed.ready).toBe(false);expect(closed.apply()).toBe(false);closed.dispose();expect(plant.userData.updatePotColor('ivory')).toBe(false);
 }finally{plant?.userData.dispose();reference?.userData.dispose();await finish();vi.unstubAllGlobals();}
});
it('retains no native handles across repeated inspection preparation, cancellation and disposal',async()=>{
 const {createShelfPlant}=await import('../../src/js/shelf-plants.js'),jobs=[];vi.stubGlobal('requestIdleCallback',callback=>jobs.push(callback));
 const run=async()=>{
  const model=createShelfPlant({catalogId:'monstera',potId:'muskot',seed:'native-policy-handles'}),plan=model.userData.prepareSurfaceQuality(256);
  plan.dispose();model.userData.dispose();while(jobs.length)jobs.shift()({timeRemaining:()=>100});expect(await plan.ready).toBe(false);
 };
 try{await run();const before=r.shelf_live_handles();for(let n=0;n<15;n++)await run();expect(r.shelf_live_handles()).toBe(before);}finally{vi.unstubAllGlobals();}
});
it('propagates seed/variant conversion and accessor failures without leaking Wasm handles',()=>{
 const geometry={catalogPlant:{id:'cactus',variant:'cactus'},potId:'akerbar',real:{canopy:25,potDiameter:15,potHeight:20},unit:.61,height:130};
 const failure=Error('bad plant input'),broken={toString(){throw failure}};
 const cases=[{entry:{seed:broken},geometry},{entry:{get seed(){throw failure}},geometry},
  {entry:{variant:broken},geometry:{...geometry,catalogPlant:{id:'cactus'}}}];
 for(const item of cases){const before=r.shelf_live_handles();for(let n=0;n<12;n++)expect(()=>r.plant_appearance(item.entry,item.geometry,{hex:'#cfd3d5'},true)).toThrow(failure);expect(r.shelf_live_handles()).toBe(before);}
 const harmless={seed:'ok',get variant(){throw failure}};
 expect(r.plant_appearance(harmless,geometry,{hex:'#cfd3d5'},false).variant).toBe('cactus');
});
