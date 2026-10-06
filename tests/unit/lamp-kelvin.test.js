import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_LAMP_KELVIN, LAMP_KELVINS, createTintTransition, kelvinSwatch, kelvinToLinearRgb, lampTint, normalizeLampKelvin } from '../../src/js/lamp-kelvin.js';
import { createShelfLamp } from '../../src/js/shelf-lamps.js';
import { normalizeShelfLamp } from '../../src/js/lamp-catalog-data.js';

describe('lamp colour temperature', () => {
  it('offers 1800, 2200, 2700 and 4000 K, defaulting to the current 2700 K', () => {
    expect(LAMP_KELVINS).toEqual([1800, 2200, 2700, 4000]);
    expect(DEFAULT_LAMP_KELVIN).toBe(2700);
    expect(normalizeLampKelvin('3000')).toBe(2700);
    expect(normalizeLampKelvin(undefined)).toBe(2700);
    expect(normalizeLampKelvin(1800)).toBe(1800);
  });

  it('converts Kelvin to black-body RGB: redder when warm, bluer when cool', () => {
    const [r1, g1, b1] = kelvinToLinearRgb(1800), [r4, g4, b4] = kelvinToLinearRgb(4000);
    expect(r1).toBe(1); expect(r4).toBe(1);
    expect(b1).toBeLessThan(.05); expect(b4).toBeGreaterThan(.3);
    expect(g1).toBeLessThan(g4);
    // 6500 K is close to neutral white.
    const [r, g, b] = kelvinToLinearRgb(6500);
    expect(Math.min(r, g, b)).toBeGreaterThan(.85);
  });

  it('leaves the default exactly unchanged and keeps luminance elsewhere', () => {
    expect(lampTint(2700)).toEqual([1, 1, 1]);
    for (const kelvin of [1800, 2200, 4000]) {
      const tint = lampTint(kelvin);
      expect(.2126 * tint[0] + .7152 * tint[1] + .0722 * tint[2]).toBeCloseTo(1, 6);
    }
    expect(lampTint(4000)[2]).toBeGreaterThan(lampTint(1800)[2]);
    expect(kelvinSwatch(1800)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('eases a change over 300 ms and ends exactly on the target', () => {
    const transition = createTintTransition(2700);
    expect(transition.advance(0)).toBe(false);
    expect(transition.set(4000, 1000, true)).toBe(true);
    expect(transition.set(4000, 1000, true)).toBe(false);
    expect(transition.advance(1150)).toBe(true);
    const middle = transition.state.value[2];
    expect(middle).toBeGreaterThan(1); expect(middle).toBeLessThan(lampTint(4000)[2]);
    expect(transition.advance(1300)).toBe(false);
    expect(transition.state.value).toEqual(lampTint(4000));
    transition.set(1800, 2000, false);
    expect(transition.advance(2000)).toBe(false);
    expect(transition.state.value).toEqual(lampTint(1800));
  });

  it('stores the temperature with the lamp and reads old records as the default', () => {
    const base = { key:'lamp:a', lampId:'mittled' };
    expect(normalizeShelfLamp({ ...base, kelvin:2200 }).kelvin).toBe(2200);
    expect(normalizeShelfLamp(base)).not.toHaveProperty('kelvin');
    expect(normalizeShelfLamp({ ...base, kelvin:3000 })).not.toHaveProperty('kelvin');
  });

  it('tints the emissive materials and the light without touching the default look', () => {
    for (const lampId of ['mittled', 'tarnaby', 'tripod']) {
      const plain = createShelfLamp({ lampId, quality:'low' }), warm = createShelfLamp({ lampId, quality:'low', kelvin:2700 });
      const cool = createShelfLamp({ lampId, quality:'low', kelvin:4000 });
      const glow = lamp => { const colours = []; lamp.traverse(o => { if (o.material?.emissive?.getHex()) colours.push(o.material.emissive.getHex()); }); return colours; };
      expect(glow(warm)).toEqual(glow(plain));
      expect(glow(cool)).not.toEqual(glow(plain));
      expect(plain.userData.lightEmitter.tint).toBeUndefined();
      expect(cool.userData.lightEmitter.tint[2]).toBeGreaterThan(1);
      expect(cool.userData.kelvin).toBe(4000);
      const colour = new THREE.Color(cool.userData.lightEmitter.color);
      expect(colour.b * cool.userData.lightEmitter.tint[2]).toBeGreaterThan(colour.b);
      for (const lamp of [plain, warm, cool]) lamp.userData.dispose();
    }
  });
});
