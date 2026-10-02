import { describe, expect, it } from 'vitest';
import { BAGGEBO_SPEC, SHELF_TYPES, getShelfType, normalizeShelfType } from '../../src/js/shelf-types.js';

describe('shelf types and BAGGEBO measurements', () => {
  it('offers the existing walnut cabinet and the fixed-size IKEA model', () => {
    expect(SHELF_TYPES.map(type => type.id)).toEqual(['walnut', 'baggebo']);
    // The wooden cabinet is built to the same real IKEA measures as the BAGGEBO.
    expect(getShelfType('walnut').dimensions).toEqual({ width:600, depth:250, height:1160 });
    expect(getShelfType('BAGGEBO').dimensions).toEqual({ width:600, depth:250, height:1160 });
    expect(getShelfType('baggebo').subtitle).toBe('Metal blanco');
  });

  it('normalizes saved values and safely restores walnut for missing or unsupported preferences', () => {
    expect(normalizeShelfType(' BAGGEBO ')).toBe('baggebo');
    for (const value of [null, undefined, 2, {}, 'unknown', '']) {
      expect(normalizeShelfType(value)).toBe('walnut');
      expect(getShelfType(value).id).toBe('walnut');
    }
  });

  it('records source measurements separately from approximated surface detail', () => {
    expect(BAGGEBO_SPEC.shelfBottoms).toEqual([360, 682.5, 1005]);
    expect(BAGGEBO_SPEC.shelfHeightsFromFloor).toEqual([800, 477.5, 155]);
    expect(BAGGEBO_SPEC.topMesh).toBe(true);
    expect(BAGGEBO_SPEC.meshSurfaceCount).toBe(4);
    expect(BAGGEBO_SPEC.sources.product).toContain('50481172');
    expect(BAGGEBO_SPEC.sources.assembly).toContain('AA-2235400-4');
    expect(BAGGEBO_SPEC.provenance.smallDetails).toContain('aproximados');
    expect(BAGGEBO_SPEC.provenance.shelfPositions).toContain('Geometría oficial IKEA');
    expect(Object.isFrozen(BAGGEBO_SPEC)).toBe(true);
    expect(Object.isFrozen(BAGGEBO_SPEC.shelfBottoms)).toBe(true);
  });
});
