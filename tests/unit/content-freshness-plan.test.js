import {it,expect} from 'vitest';
import {getRustCore} from '../../src/js/rust-core.js';
import {createContentFreshnessPlan} from '../../src/js/content-freshness-plan.js';
it('matches reload eligibility, retry boundaries and concurrent checks',()=>{
 const plan=createContentFreshnessPlan(getRustCore(),'initial😀\ud800');
 try{
  expect(plan.interval()).toBe(600000);expect(plan.begin()).toBe(true);expect(plan.begin()).toBe(false);plan.finish();expect(plan.begin()).toBe(true);plan.finish();
  for(const latest of ['', 'initial😀\ud800','other','initial😀\ud801'])expect(plan.newer(latest)).toBe(!!latest&&latest!=='initial😀\ud800');
  for(const same of [false,true])for(const now of [-Infinity,NaN,0,119999,120000,Infinity])for(const at of [-1,0,1,NaN,Infinity])expect(plan.retry(same,now,at)).toBe(!(same&&now-at<120000));
  for(const reader of [null,undefined,{}, {hidden:false},{hidden:true},{hidden:0},{hidden:'false'}])expect(plan.safe(reader)).toBe(!reader||reader.hidden!==false);
 }finally{plan.dispose();plan.dispose();}
});
it('keeps launch controllers independent, preserves reload and releases native storage',()=>{
 const core=getRustCore();const plan=createContentFreshnessPlan(core,'start');const warm=plan.launch();warm.dispose();const before=core.memory.buffer.byteLength;
 try{
  for(let i=0;i<500;i++){
   const a=plan.launch(),b=plan.launch();
   try{
    expect(a.untouched()).toBe(true);a.touch();expect(a.untouched()).toBe(false);expect(b.untouched()).toBe(true);
    expect(a.reloading(false)).toBe(false);expect(a.reloading(true)).toBe(true);expect(a.reloading(false)).toBe(true);expect(b.reloading(false)).toBe(false);
   }finally{a.dispose();b.dispose();}
  }
  expect(core.memory.buffer.byteLength).toBeLessThanOrEqual(before+65536);
 }finally{plan.dispose();}
});
