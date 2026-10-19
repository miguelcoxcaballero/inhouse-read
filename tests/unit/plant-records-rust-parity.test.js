// @vitest-environment node
import {expect,it} from 'vitest';
import {normalizeShelfPlant,resolveCatalogPlant} from '../../src/js/plant-records.js';
import {normalizeShelfPlant as original,resolveCatalogPlant as resolveOriginal} from './helpers/reference-plant-records-policy.js';
import {needRustShelf} from '../../src/js/rust-shelf.js';
const aliases=['upright','sansevieria','monstera','leafy','pothos','ivy','hedera','suculenta','succulent','cactus','palm','chamaedorea','fern','nephrolepis','zz','zamioculcas','__proto__','constructor','  PALM  ','unknown'];
it('preserves every alias, explicit selection, legacy pot and placement with reference-identical catalog objects',()=>{
 for(const variant of aliases)for(const potId of [undefined,'muskot','muskot9','akerbar','gradvis','missing'])for(const catalogId of [undefined,'nephrolepis','invalid']){
  const record={key:`${variant}:${potId}`,variant,potId,catalogId,potColorId:'copper',seed:'keep',shelf:2,x:.178,rotation:-.081,width:99,height:NaN};
  expect(resolveCatalogPlant(record)).toBe(resolveOriginal(record));expect(normalizeShelfPlant(record)).toEqual(original(record));
 }
});
it('preserves object-spread semantics for symbols, getters, own __proto__ and non-enumerable fields',()=>{
 const symbol=Symbol('metadata'),record={key:'test',variant:'ivy',get title(){return 'title'},[symbol]:{keep:true}};
 Object.defineProperty(record,'__proto__',{value:{kept:true},enumerable:true});Object.defineProperty(record,'secret',{value:'hidden',enumerable:false});
 const actual=normalizeShelfPlant(record),expected=original(record);
 expect(Object.getOwnPropertyDescriptors(actual)).toEqual(Object.getOwnPropertyDescriptors(expected));expect(Object.getPrototypeOf(actual)).toBe(Object.prototype);expect(actual[symbol]).toBe(record[symbol]);
});
it('preserves invalid and default argument outcomes without mutating records',()=>{
 for(const value of [undefined,null,false,0,'',{},{key:null},{key:34},{key:' '},{key:'x',seed:34},{key:'x',seed:''},{key:'x',variant:'\ud800'}]){
  expect(normalizeShelfPlant(value)).toEqual(original(value));
 }
 expect(resolveCatalogPlant()).toBe(resolveOriginal());expect(()=>resolveCatalogPlant(null)).toThrow(TypeError);
});
it('propagates source accessor and string conversion errors without retaining native handles',()=>{
 const failure=Error('broken stored field'),getter={key:'x',get variant(){throw failure}},conversion={key:'x',variant:{toString(){throw failure}}};
 for(const record of [getter,conversion]){
  const before=needRustShelf().shelf_live_handles();
  for(let n=0;n<10;n++){expect(()=>normalizeShelfPlant(record)).toThrow(failure);expect(()=>original(record)).toThrow(failure);}
  expect(needRustShelf().shelf_live_handles()).toBe(before);
 }
});
