import { describe, it, expect } from 'vitest';
import { bindingGeometry } from '../../src/js/book-model.js';

describe('purpose-built rounded binding mesh', () => {
  it('joins both cover boards and protrudes beyond the left edge head-on', () => {
    const g = bindingGeometry(200, 300, 52);
    const p = g.getAttribute('position');
    expect(p.count).toBe(194);
    expect(p.getX(0)).toBe(-100);
    expect(p.getZ(0)).toBe(-26);
    expect(p.getX(192)).toBeCloseTo(-100);
    expect(p.getZ(192)).toBe(26);
    expect(p.getX(96)).toBeCloseTo(-128.6);
    expect(p.getY(96)).toBe(-150);
    expect(p.getY(97)).toBe(150);
    g.dispose();
  });
  it('every cross-section vertex lies on the ellipse, with continuous outward unit normals', () => {
    const g = bindingGeometry(200, 300, 52);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i += 2) {
      expect(((p.getX(i) + 100) / 28.6) ** 2 + (p.getZ(i) / 26) ** 2).toBeCloseTo(1, 5);
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
      expect(n.getX(i)).toBeLessThanOrEqual(0);
      if (i) expect(n.getX(i) * n.getX(i - 2) + n.getZ(i) * n.getZ(i - 2)).toBeGreaterThan(.998);
    }
    g.dispose();
  });
  it('wraps one texture continuously over shared vertices instead of detached text planes', () => {
    const g = bindingGeometry(200, 300, 52), uv = g.getAttribute('uv');
    expect(g.index.count).toBe(96 * 6);
    for (let i = 0; i < uv.count; i += 2) {
      expect(uv.getX(i)).toBeCloseTo(i / 192);
      expect(uv.getY(i)).toBe(0);
      expect(uv.getY(i + 1)).toBe(1);
    }
    g.dispose();
  });
});
