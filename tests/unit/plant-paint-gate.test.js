import {expect,it} from 'vitest';
import {createPlantPaintGate} from '../../src/js/plant-paint-gate.js';

it('does not hold a catalog preview without a live shelf',()=>{
  const gate=createPlantPaintGate({scene:()=>null});expect(gate()).toBe(false);
});
it('waits only for the first real shelf frame',()=>{
  const canvas={isConnected:true,dataset:{}},gate=createPlantPaintGate({scene:()=>canvas,now:()=>0});
  expect(gate()).toBe(true);canvas.dataset.renderCount='1';expect(gate()).toBe(false);
  canvas.dataset.renderCount='20';expect(gate()).toBe(false);
});
it('releases disconnected surfaces',()=>{
  const canvas={isConnected:true,dataset:{}},gate=createPlantPaintGate({scene:()=>canvas,now:()=>0});
  expect(gate()).toBe(true);canvas.isConnected=false;expect(gate()).toBe(false);
});
it('has a bounded wait that cannot reset on every paint chunk',()=>{
  let clock=0;const canvas={isConnected:true,dataset:{}},gate=createPlantPaintGate({scene:()=>canvas,now:()=>clock});
  expect(gate()).toBe(true);clock=999;expect(gate()).toBe(true);clock=1000;expect(gate()).toBe(false);
  clock=1001;expect(gate()).toBe(false);clock=10000;expect(gate()).toBe(false);
});
it('gives a replacement shelf its own first-frame budget',()=>{
  let clock=0,canvas={isConnected:true,dataset:{}};
  const gate=createPlantPaintGate({scene:()=>canvas,now:()=>clock});expect(gate()).toBe(true);
  clock=2000;expect(gate()).toBe(false);canvas={isConnected:true,dataset:{}};expect(gate()).toBe(true);
  clock=3000;expect(gate()).toBe(false);
});
