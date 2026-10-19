import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { compilePrograms, prepareProgramUniforms, retainPrograms, whenProgramsReady } from '../../src/js/gpu-programs.js';
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('retains exactly the original 160-program bound and recognizes a replacement list', () => {
  const programs = Array.from({length:175}, () => ({usedTimes:1})), renderer = {info:{programs}};
  retainPrograms(renderer); retainPrograms(renderer);
  expect(programs.map(p => p.usedTimes)).toEqual(programs.map((_,i) => i < 160 ? 2 : 1));
  const replacement={info:{programs:[{usedTimes:1}]}};
  retainPrograms(replacement); const first=replacement.info.programs[0];
  replacement.info.programs=[{usedTimes:1}]; retainPrograms(replacement);
  expect(first.usedTimes).toBe(2); expect(replacement.info.programs[0].usedTimes).toBe(2);
});

it('counts duplicated handles only once when collecting fresh programs in a batch', () => {
  const shared={usedTimes:1}, programs=[shared,shared,...Array.from({length:159},()=>({usedTimes:1}))];
  const renderer={info:{programs}};
  retainPrograms(renderer); retainPrograms(renderer);
  expect(programs.every(program => program.usedTimes===2)).toBe(true);
  const overLimit={usedTimes:1}; programs.push(overLimit); retainPrograms(renderer);
  expect(overLimit.usedTimes).toBe(1);
});

it('deduplicates a program referenced by several materials before idle reflection', async () => {
  const program={getUniforms:vi.fn(),isReady:()=>true}, materials=new Set([{},{}]);
  const renderer={properties:{get:()=>({programs:new Map([['same',program]])})}}, idle=vi.fn(async()=>{});
  expect(await prepareProgramUniforms(renderer,materials,{idle})).toBe(true);
  expect(idle).toHaveBeenCalledOnce(); expect(program.getUniforms).toHaveBeenCalledOnce();
});

it('releases the half-float target after a failed transmission compile and restores the external target', () => {
  const scene=new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshPhysicalMaterial({transmission:.8})));
  const previous=new THREE.WebGLRenderTarget(2,2); let target=previous, calls=0;
  const dispose=vi.spyOn(THREE.WebGLRenderTarget.prototype,'dispose');
  const renderer={properties:{get:()=>({programs:new Map()})},getRenderTarget:()=>target,setRenderTarget:value=>{target=value},
    compile(){if(++calls===2)throw new Error('driver failed');return new Set()}};
  expect(() => compilePrograms(renderer,scene,new THREE.Camera())).toThrow('driver failed');
  expect(target).toBe(previous); expect(dispose).toHaveBeenCalledOnce(); expect(dispose.mock.instances[0]).not.toBe(previous);
});

it('calls readiness completion once after compile failure without scheduling timers', () => {
  vi.useFakeTimers(); const scene=new THREE.Scene(), object=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());
  const done=vi.fn(), cancel=whenProgramsReady({compile(){throw new Error('lost')}},scene,new THREE.Camera(),object,done);
  expect(done).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  cancel(); expect(done).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
