import { describe, expect, it, vi } from 'vitest';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { reuseCoverRaster, releaseCoverRaster } from '../../src/js/cover-raster-cache.js';

function print(width = 660, height = 1024) {
  const map = new CanvasTexture({ width, height });
  map.colorSpace = SRGBColorSpace;
  return { map, bounds:{ x:0, y:0, width, height } };
}

describe('bounded decoded jacket raster reuse', () => {
  it('prints once and gives each material its own texture with exact shared pixels and Source version', () => {
    const owner = {}, original = print(), build = vi.fn(() => original);
    const version = original.map.source.version;
    const first = reuseCoverRaster(owner, 'same', build), second = reuseCoverRaster(owner, 'same', build);
    expect(build).toHaveBeenCalledOnce();
    expect(first.map).not.toBe(second.map); expect(first.map).not.toBe(original.map);
    expect(first.map.source).toBe(original.map.source); expect(second.map.source).toBe(original.map.source);
    expect(first.map.image).toBe(second.map.image);
    expect(first.map.source.version).toBe(version); expect(second.map.source.version).toBe(version);
    expect(first.map.colorSpace).toBe(SRGBColorSpace); expect(first.bounds).toEqual(second.bounds);
    first.map.anisotropy = 16; expect(second.map.anisotropy).toBe(1);
    first.map.dispose(); second.map.dispose(); releaseCoverRaster(owner);
  });

  it('releases an evicted base without disposing a live material clone', () => {
    const owner = {}, original = print(), dispose = vi.spyOn(original.map, 'dispose');
    const first = reuseCoverRaster(owner, 'first', () => original), cloneDispose = vi.spyOn(first.map, 'dispose');
    const next = print(), second = reuseCoverRaster(owner, 'changed-colour-size-or-title', () => next);
    expect(dispose).toHaveBeenCalledOnce(); expect(cloneDispose).not.toHaveBeenCalled();
    expect(first.map.image).toBe(original.map.image); expect(second.map.source).toBe(next.map.source);
    first.map.dispose(); second.map.dispose(); releaseCoverRaster(owner);
  });

  it('releases the retained base exactly once when the decoded image lease ends', () => {
    const owner = {}, original = print(), dispose = vi.spyOn(original.map, 'dispose');
    const first = reuseCoverRaster(owner, 'same', () => original);
    releaseCoverRaster(owner); releaseCoverRaster(owner);
    expect(dispose).toHaveBeenCalledOnce(); expect(first.map.image).toBe(original.map.image);
    const build = vi.fn(() => print()); reuseCoverRaster(owner, 'same', build);
    expect(build).toHaveBeenCalledOnce(); first.map.dispose(); releaseCoverRaster(owner);
  });

  it('keeps each decoded source isolated even when its jacket key matches', () => {
    const a = {}, b = {}, build = vi.fn(() => print());
    const first = reuseCoverRaster(a, 'same', build), second = reuseCoverRaster(b, 'same', build);
    expect(build).toHaveBeenCalledTimes(2); expect(first.map.source).not.toBe(second.map.source);
    first.map.dispose(); second.map.dispose(); releaseCoverRaster(a); releaseCoverRaster(b);
  });

  it('retains the valid previous print when constructing a replacement fails', () => {
    const owner = {}, original = print(), dispose = vi.spyOn(original.map, 'dispose');
    const first = reuseCoverRaster(owner, 'first', () => original);
    expect(() => reuseCoverRaster(owner, 'next', () => { throw Error('Canvas unavailable'); })).toThrow('Canvas unavailable');
    const build = vi.fn(), retained = reuseCoverRaster(owner, 'first', build);
    expect(build).not.toHaveBeenCalled(); expect(dispose).not.toHaveBeenCalled();
    expect(retained.map.source).toBe(first.map.source);
    first.map.dispose(); retained.map.dispose(); releaseCoverRaster(owner);
  });

  it('bypasses reuse for ordinary shelf prints', () => {
    const build = vi.fn(() => print());
    const first = reuseCoverRaster(null, 'same', build), second = reuseCoverRaster(null, 'same', build);
    expect(build).toHaveBeenCalledTimes(2); expect(first.map.source).not.toBe(second.map.source);
    first.map.dispose(); second.map.dispose();
  });

  it('caps the total retained pixels across decoded covers without disposing their live clones', () => {
    const owners = [{}, {}, {}], originals = owners.map(() => print(1024, 1024));
    const disposals = originals.map(item => vi.spyOn(item.map, 'dispose'));
    const copies = owners.map((owner, i) => reuseCoverRaster(owner, 'same', () => originals[i]));
    expect(disposals.map(dispose => dispose.mock.calls.length)).toEqual([1, 0, 0]);
    expect(copies[0].map.image).toBe(originals[0].map.image);
    const build = vi.fn(() => print(1024, 1024));
    const replacement = reuseCoverRaster(owners[0], 'same', build);
    expect(build).toHaveBeenCalledOnce(); expect(disposals[1]).toHaveBeenCalledOnce();
    for (const copy of [...copies, replacement]) copy.map.dispose();
    for (const owner of owners) releaseCoverRaster(owner);
  });

  it('evicts the least recently used print rather than a cover just selected again', () => {
    const a = {}, b = {}, c = {}, first = print(1024, 1024), second = print(1024, 1024);
    const disposeFirst = vi.spyOn(first.map, 'dispose'), disposeSecond = vi.spyOn(second.map, 'dispose');
    const copies = [reuseCoverRaster(a, 'same', () => first), reuseCoverRaster(b, 'same', () => second)];
    copies.push(reuseCoverRaster(a, 'same', () => { throw Error('Already cached'); }));
    copies.push(reuseCoverRaster(c, 'same', () => print(1024, 1024)));
    expect(disposeFirst).not.toHaveBeenCalled(); expect(disposeSecond).toHaveBeenCalledOnce();
    expect(copies[0].map.source).toBe(copies[2].map.source);
    for (const copy of copies) copy.map.dispose();
    for (const owner of [a, b, c]) releaseCoverRaster(owner);
  });

  it('returns a released budget to other covers and keeps the exact boundary cacheable', () => {
    const a = {}, b = {}, original = print(1024, 2048), dispose = vi.spyOn(original.map, 'dispose');
    const first = reuseCoverRaster(a, 'full-budget', () => original);
    releaseCoverRaster(a); expect(dispose).toHaveBeenCalledOnce();
    const build = vi.fn(() => print(1024, 2048));
    const second = reuseCoverRaster(b, 'full-budget', build), third = reuseCoverRaster(b, 'full-budget', build);
    expect(build).toHaveBeenCalledOnce(); expect(second.map.source).toBe(third.map.source);
    for (const copy of [first, second, third]) copy.map.dispose(); releaseCoverRaster(b);
  });

  for (const dimensions of [[2048, 2048], [1024.5, 1000], [0, 1000]]) {
    it(`does not retain oversized or invalid ${dimensions.join('×')} prints`, () => {
      const owner = {}, original = print(), dispose = vi.spyOn(original.map, 'dispose');
      reuseCoverRaster(owner, 'small', () => original);
      const build = vi.fn(() => print(...dimensions));
      reuseCoverRaster(owner, 'large', build); reuseCoverRaster(owner, 'large', build);
      expect(build).toHaveBeenCalledTimes(2); expect(dispose).toHaveBeenCalledOnce();
      for (const result of build.mock.results) result.value.map.dispose(); releaseCoverRaster(owner);
    });
  }
});
