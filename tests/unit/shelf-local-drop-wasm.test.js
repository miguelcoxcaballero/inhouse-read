// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';
const drop=(items,selected,row,x)=>rustShelf.shelf_local_drop(new Float64Array(items.flat()),selected,row,x,600,20,0);
it('finds the closest free slot for one item without moving or spilling a dense row',()=>{
 const items=[[1,30,20,0],...Array.from({length:12},(_,i)=>[0,180+i*18,16,0]),[2,100,120,0]];
 const original=structuredClone(items);const result=drop(items,0,0,.45);
 expect(result[0]).toBe(0);const center=20+result[1]*560;
 expect(center+10<=180||center-10>=394).toBe(true);expect(items).toEqual(original);
});
it('keeps the exact requested centre when it is already free and treats ceiling fixtures separately',()=>{
 expect([...drop([[1,30,20,0],[0,200,180,1]],0,0,.5)]).toEqual([0,.5]);
 expect([...drop([[1,30,20,1],[0,200,180,0]],0,0,.5)]).toEqual([0,.5]);
});
it('rejects a full destination instead of moving any bystander to another shelf',()=>{
 expect([...drop([[1,30,20,0],[0,20,560,0]],0,0,.5)]).toEqual([]);
});
it('handles either edge, small books and invalid geometry without nonfinite saved positions',()=>{
 for(const x of [-10,0,.1,.5,.9,1,10]){
  const result=drop([[1,30,.5,0],[0,150,160,0],[0,340,180,0]],0,0,x);
  expect(result).toHaveLength(2);const c=20+result[1]*560;
  expect(c-.25).toBeGreaterThanOrEqual(20);expect(c+.25).toBeLessThanOrEqual(580);
  expect(c+.25<=150||c-.25>=310).toBe(true);expect(c+.25<=340||c-.25>=520).toBe(true);
 }
 expect([...drop([[0,NaN,20,0]],0,0,.5)]).toEqual([]);
 expect([...drop([[0,20,20,0]],0,NaN,.5)]).toEqual([]);
});
