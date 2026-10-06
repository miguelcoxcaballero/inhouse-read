import { describe, it, expect, vi } from 'vitest';
import { compilePagePrograms, prepareProgramUniforms } from '../../src/js/gpu-programs.js';

describe('submission of the hidden book page shaders', () => {
  it('submits the exact compile batch once and returns the same materials', () => {
    const scene = {}, camera = {}, materials = new Set([{}]), events = [];
    const gl = { flush:vi.fn(() => events.push('flush')), finish:vi.fn() };
    const renderer = {
      compile:vi.fn((s,c) => { expect(s).toBe(scene); expect(c).toBe(camera); events.push('compile'); return materials; }),
      getContext:vi.fn(() => gl), render:vi.fn(), setRenderTarget:vi.fn(),
    };
    expect(compilePagePrograms(renderer,scene,camera)).toBe(materials);
    expect(events).toEqual(['compile','flush']);
    expect(renderer.compile).toHaveBeenCalledOnce();
    expect(gl.finish).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.setRenderTarget).not.toHaveBeenCalled();
  });

  it('does not flush a compile with no materials', () => {
    const renderer = { compile:vi.fn(() => new Set()), getContext:vi.fn() };
    expect(compilePagePrograms(renderer,{},{}).size).toBe(0);
    expect(renderer.getContext).not.toHaveBeenCalled();
  });

  it('preserves the existing undefined compile result', () => {
    const renderer = { compile:vi.fn(), getContext:vi.fn() };
    expect(compilePagePrograms(renderer,{},{})).toBeUndefined();
    expect(renderer.getContext).not.toHaveBeenCalled();
  });

  it('keeps renderers without an optional flush on their original compile path', () => {
    const materials = new Set([{}]);
    for (const getContext of [undefined, () => ({}), () => undefined]) {
      expect(compilePagePrograms({ compile:() => materials,getContext },{},{})).toBe(materials);
    }
  });

  it('propagates driver errors to the existing page first-draw fallback', () => {
    const error = new Error('lost context');
    expect(() => compilePagePrograms({ compile:() => { throw error; } },{},{})).toThrow(error);
    expect(() => compilePagePrograms({ compile:() => new Set([{}]),getContext:() => ({ flush:() => { throw error; } }) },{},{})).toThrow(error);
  });

  it('submits before the first readiness poll, while completion and reflection remain idle work', async () => {
    const material = {}, materials = new Set([material]), events = [];
    let submitted = false, completed = false;
    const program = {
      isReady:() => { events.push('ready'); return submitted && completed; },
      getUniforms:vi.fn(() => events.push('uniforms')),
    };
    const renderer = {
      compile:() => { events.push('compile'); return materials; },
      getContext:() => ({ flush:() => { submitted = true; events.push('flush'); } }),
      properties:{ get:() => ({ programs:new Map([['page',program]]) }) },
    };
    const batch = compilePagePrograms(renderer,{},{});
    expect(program.getUniforms).not.toHaveBeenCalled();
    let slices = 0;
    expect(await prepareProgramUniforms(renderer,batch,{ idle:async () => {
      events.push('idle'); if (++slices === 2) completed = true;
    } })).toBe(true);
    expect(events).toEqual(['compile','flush','idle','ready','idle','ready','uniforms']);
  });
});
