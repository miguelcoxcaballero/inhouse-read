// @vitest-environment node
import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { needRustShelf } from '../../src/js/rust-shelf.js';

const inputOf = () => {
  const input = new Float64Array(103);
  input.set(new THREE.Matrix4().elements);
  input[88] = 0xffd19a; input[93] = 250; input[94] = 1;
  input[95] = 400; input[96] = 50; input[97] = 2;
  return input;
};
it('retains exact light output and skips repeated host power/color conversions', () => {
  const shelf = needRustShelf(), state = new shelf.LampLightState(0);
  const input = inputOf(), actual = new Float64Array(38), reference = new Float64Array(38);
  const pow = vi.spyOn(Math, 'pow');
  try {
    state.assign();
    expect(state.light(false, false, true, false, false, input, actual)).toBe(9);
    expect(pow.mock.calls.length).toBeGreaterThan(0);
    pow.mockClear();
    expect(state.light(false, false, true, true, false, input, actual)).toBe(8);
    expect(pow).not.toHaveBeenCalled();
    input[94] = .4;
    expect(state.light(false, false, true, true, false, input, actual)).toBe(9);
    expect(pow).not.toHaveBeenCalled();
    expect(shelf.lamp_light(false, input, reference)).toBe(true);
    for (let i = 0; i < actual.length; i++) expect(Object.is(actual[i], reference[i]), `field ${i}`).toBe(true);
    input[88] = 0x80aadd;
    pow.mockClear(); state.light(false, false, true, true, false, input, actual);
    expect(pow.mock.calls.length).toBeGreaterThan(0);
  } finally { pow.mockRestore(); state.free(); }
});
it('retains legacy raw undefined/string emitter invalidation and NaN equality', () => {
  const shelf = needRustShelf(), state = new shelf.LampLightState(0);
  const input = inputOf(), out = new Float64Array(38);
  try {
    state.assign(); state.light(false, false, true, false, false, input, out);
    input[95] = NaN;
    expect(state.light(false, false, true, true, false, input, out) & 1).toBe(1);
    expect(state.light(false, false, true, true, false, input, out) & 1).toBe(0);
    input[102] = 1;
    expect(state.light(false, false, true, true, false, input, out) & 1).toBe(1);
    expect(state.light(false, false, true, true, false, input, out) & 1).toBe(1);
  } finally { state.free(); }
});
it('owns quotas and only requests locale ranks after candidate membership/order changes', () => {
  const shelf = needRustShelf(), pool = new shelf.LampPoolState();
  try {
    expect(Array.from(pool.reconcile(new Float64Array([1,0,3,1]), new Float64Array(0), 3))).toEqual([0,1,0,3,1,0,1,1,0]);
    expect(Array.from(pool.reconcile(new Float64Array([1,0,3,1]), new Float64Array([0,1,3]), 3))).toEqual([]);
    const candidates = new Float64Array([0,10,0,1,100,0,0, 1,20,0,1,200,1,0]);
    const slots = new Float64Array([0,-1,0, 1,-1,0]), out = new Float64Array(12);
    const ranks = vi.fn(() => new Float64Array([1,0]));
    expect(pool.plan(candidates,slots,0,out,ranks)).toBe(true);
    expect(ranks).toHaveBeenCalledTimes(1);
    candidates[3] = .5; candidates[4] = 500;
    expect(pool.plan(candidates,slots,0,out,ranks)).toBe(true);
    expect(ranks).toHaveBeenCalledTimes(1);
    candidates[1] = 11;
    expect(pool.plan(candidates,slots,0,out,ranks)).toBe(true);
    expect(ranks).toHaveBeenCalledTimes(2);
    expect(Array.from(pool.reconcile(new Float64Array([1]), new Float64Array([0,1,3]), 8))).toEqual([0,0,1,3,0,1]);
  } finally { pool.free(); }
});
