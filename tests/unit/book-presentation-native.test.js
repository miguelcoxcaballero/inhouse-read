import { expect, it, vi } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';

const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject}; };
function fixture() {
  const rust = needRustShelf(), gpu = {compile(){},info:{programs:[]},getContext:() => ({flush(){}})};
  const host = {
    getRenderer:vi.fn(() => gpu), compileModel:vi.fn(() => new Set()), retainPrograms:vi.fn(), prepareProgramUniforms:vi.fn(async () => true),
    entered:rust.book_presentation_enter, compile:rust.book_presentation_compile, dispose:rust.book_presentation_dispose,
    finished:rust.book_presentation_finished, failed:rust.book_presentation_failed,
  };
  return { host, run:(subject,detail=false,idle=async()=>{},current=()=>true) => rust.book_presentation_prepare(host,subject,idle,current,detail) };
}

it('joins concurrent borrowed preparation and reuses the successful renderer result', async () => {
  const f=fixture(), reflected=deferred(), model={traverse(){}};
  f.host.prepareProgramUniforms.mockReturnValue(reflected.promise);
  const first=f.run(model), second=f.run(model);
  await Promise.resolve(); await Promise.resolve();
  expect(f.host.compileModel).toHaveBeenCalledOnce();
  reflected.resolve(true); await expect(Promise.all([first,second])).resolves.toEqual([true,true]);
  expect(await f.run(model)).toBe(true); expect(f.host.compileModel).toHaveBeenCalledOnce();
});

it('joins a loading detail model and disposes it once on a failed decode before retrying', async () => {
  const f=fixture(), decoded=deferred(), dispose=vi.fn(), model={userData:{ready:decoded.promise,dispose}};
  const build=vi.fn(() => model), first=f.run(build,true), second=f.run(build,true);
  await Promise.resolve(); await Promise.resolve(); expect(build).toHaveBeenCalledOnce();
  decoded.reject(new Error('cover decode failed'));
  const outcomes=await Promise.allSettled([first,second]);
  expect(outcomes.map(value => value.status)).toEqual(['rejected','rejected']);
  outcomes.forEach(value => expect(value.reason.message).toBe('cover decode failed'));
  expect(dispose).toHaveBeenCalledOnce(); expect(f.host.compileModel).not.toHaveBeenCalled();
  const nextDispose=vi.fn();
  expect(await f.run(() => ({userData:{ready:Promise.resolve(),dispose:nextDispose}}),true)).toBe(true);
  expect(nextDispose).toHaveBeenCalledOnce(); expect(f.host.compileModel).toHaveBeenCalledOnce();
});

it('preserves a disposal failure and removes the failed detail attempt', async () => {
  const f=fixture(), dispose=vi.fn().mockImplementationOnce(() => {throw new Error('release failed')});
  const build=() => ({userData:{ready:Promise.resolve(),dispose}});
  await expect(f.run(build,true)).rejects.toThrow('release failed');
  expect(await f.run(build,true)).toBe(true); expect(dispose).toHaveBeenCalledTimes(2);
});

it('does not allocate a renderer after a rejected initial idle slice', async () => {
  const f=fixture();
  await expect(f.run({traverse(){}},false,() => {throw new Error('idle cancelled')})).rejects.toThrow('idle cancelled');
  expect(f.host.getRenderer).not.toHaveBeenCalled();
});
