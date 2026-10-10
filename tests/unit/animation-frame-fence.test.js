import {describe,it,expect,vi} from 'vitest';
import {animationFrameFence} from '../../src/js/animation-frame-fence.js';
function context(){return {SYNC_GPU_COMMANDS_COMPLETE:1,TIMEOUT_EXPIRED:2,ALREADY_SIGNALED:3,CONDITION_SATISFIED:4,WAIT_FAILED:5,
 fenceSync:vi.fn(()=>({})),clientWaitSync:vi.fn(()=>3),deleteSync:vi.fn(),flush:vi.fn(),isContextLost:vi.fn(()=>false)};}
describe('nonblocking book-frame completion',()=>{
 it('does nothing without a supported context',()=>{
  const fence=animationFrameFence(null);expect(fence.ready()).toBe(true);fence.submit();expect(fence.ready()).toBe(true);fence.dispose();
 });
 it.each(['fenceSync','clientWaitSync','deleteSync','flush'])('retains RAF when %s is missing',name=>{
  const gl=context();delete gl[name];const fence=animationFrameFence(gl);fence.submit();expect(fence.ready()).toBe(true);expect(gl.fenceSync?.mock.calls.length||0).toBe(0);
 });
 it('polls with exactly zero blocking time and retains a busy frame',()=>{
  const gl=context(),fence=animationFrameFence(gl);gl.clientWaitSync.mockReturnValue(gl.TIMEOUT_EXPIRED);fence.submit();
  const sync=gl.fenceSync.mock.results[0].value;expect(gl.fenceSync).toHaveBeenCalledExactlyOnceWith(gl.SYNC_GPU_COMMANDS_COMPLETE,0);expect(gl.flush).toHaveBeenCalledOnce();
  expect(fence.ready()).toBe(false);expect(fence.ready()).toBe(false);expect(gl.clientWaitSync).toHaveBeenNthCalledWith(1,sync,0,0);expect(gl.deleteSync).not.toHaveBeenCalled();
  fence.dispose();expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
 });
 it.each([3,4])('releases a completed frame for status %s',status=>{
  const gl=context(),fence=animationFrameFence(gl);gl.clientWaitSync.mockReturnValue(status);fence.submit();expect(fence.ready()).toBe(true);
  expect(gl.deleteSync).toHaveBeenCalledOnce();fence.dispose();expect(gl.deleteSync).toHaveBeenCalledOnce();
 });
 it('releases a cancelled pending fence once',()=>{
  const gl=context(),fence=animationFrameFence(gl);fence.submit();fence.dispose();fence.dispose();expect(gl.deleteSync).toHaveBeenCalledOnce();expect(fence.ready()).toBe(true);
 });
 it.each(['lost','wait-failed','throw'])('falls back after %s and submits no further fences',failure=>{
  const gl=context(),fence=animationFrameFence(gl);fence.submit();
  if(failure==='lost')gl.isContextLost.mockReturnValue(true);
  if(failure==='wait-failed')gl.clientWaitSync.mockReturnValue(gl.WAIT_FAILED);
  if(failure==='throw')gl.clientWaitSync.mockImplementation(()=>{throw Error('Driver lost')});
  expect(fence.ready()).toBe(true);fence.submit();expect(gl.fenceSync).toHaveBeenCalledOnce();expect(gl.deleteSync).toHaveBeenCalledOnce();
 });
 it('does not stall when allocation fails',()=>{
  const gl=context(),fence=animationFrameFence(gl);gl.fenceSync.mockReturnValue(null);fence.submit();expect(fence.ready()).toBe(true);expect(gl.flush).not.toHaveBeenCalled();fence.submit();expect(gl.fenceSync).toHaveBeenCalledOnce();
 });
});
