import { describe, it, expect } from 'vitest';
import { bindingGeometry, boardGeometry, sampleBookMotion } from '../../src/js/book-model.js';

describe('purpose-built rounded binding mesh', () => {
  it('joins both cover boards and protrudes beyond the left edge head-on', () => {
    const g = bindingGeometry(200, 300, 52);
    const p = g.getAttribute('position');
    expect(p.count).toBe(194);
    expect(p.getX(0)).toBe(-100);
    expect(p.getZ(0)).toBe(-26);
    expect(p.getX(192)).toBeCloseTo(-100);
    expect(p.getZ(192)).toBe(26);
    expect(p.getX(96)).toBeCloseTo(-119.76);
    expect(p.getY(96)).toBe(-150);
    expect(p.getY(97)).toBe(150);
    g.dispose();
  });
  it('every cross-section vertex lies on the ellipse, with continuous outward unit normals', () => {
    const g = bindingGeometry(200, 300, 52);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i += 2) {
      expect(((p.getX(i) + 100) / 19.76) ** 2 + (p.getZ(i) / 26) ** 2).toBeCloseTo(1, 5);
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

describe('beveled hardcover boards', () => {
  it('keeps every bevel inside the shared book dimensions', () => {
    const g = boardGeometry(200, 300, 2.1);
    g.computeBoundingBox();
    const { min, max } = g.boundingBox;
    expect(min.x).toBeCloseTo(-100); expect(max.x).toBeCloseTo(100);
    expect(min.y).toBeCloseTo(-150); expect(max.y).toBeCloseTo(150);
    expect(min.z).toBeCloseTo(-1.05); expect(max.z).toBeCloseTo(1.05);
    expect(g.getAttribute('position').count).toBeGreaterThan(100);
    g.dispose();
  });
  it('maps the cover image within 0–1 and gives the bevel its own material', () => {
    const g = boardGeometry(200, 300, 2.1), uv = g.getAttribute('uv');
    expect(g.groups.some(group => group.materialIndex === 1)).toBe(true);
    for (const face of g.groups.filter(group => group.materialIndex === 0)) {
      for (let i = face.start; i < face.start + face.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0); expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0); expect(uv.getY(i)).toBeLessThanOrEqual(1);
      }
    }
    g.dispose();
  });
});

describe('book motion with continuous velocity', () => {
  const frames = [
    { transform:{ x:100, y:150, angle:90, scale:.4 } },
    { offset:.26, transform:{ x:90, y:20, angle:80, scale:.49 } },
    { offset:.7, transform:{ x:18, y:-12, angle:16, scale:.91 } },
    { transform:{ x:0, y:0, angle:0, scale:1 } }
  ];
  it('lands exactly on both ends, with no rotation or scale overshoot', () => {
    expect(sampleBookMotion(frames, 0)).toMatchObject(frames[0].transform);
    expect(sampleBookMotion(frames, 1)).toMatchObject(frames.at(-1).transform);
    let previous = sampleBookMotion(frames, 0);
    for (let i = 1; i <= 1000; i++) {
      const pose = sampleBookMotion(frames, i / 1000);
      expect(pose.angle).toBeLessThanOrEqual(previous.angle);
      expect(pose.angle).toBeGreaterThanOrEqual(0);
      expect(pose.scale).toBeGreaterThanOrEqual(previous.scale);
      expect(pose.scale).toBeLessThanOrEqual(1);
      expect(pose.y).toBeGreaterThanOrEqual(-12);
      previous = pose;
    }
  });
  it('preserves velocity across every internal keyframe', () => {
    const dt = .000001;
    for (const t of [.26, .7]) for (const key of ['x', 'y', 'angle', 'scale']) {
      const mid = sampleBookMotion(frames, t)[key];
      const left = (mid - sampleBookMotion(frames, t - dt)[key]) / dt;
      const right = (sampleBookMotion(frames, t + dt)[key] - mid) / dt;
      expect(Math.abs(left - right)).toBeLessThan(.02);
    }
  });
});
