import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { bookmarkGeometry } from '../../src/js/book-model.js';

// Recorded from 1.7.16 before introducing buffer reuse. Positions, texture
// coordinates, normals and topology must remain byte-for-byte identical.
const originalPoses = [
  [0,0,'90249046c31ca72801c4ad89a87aac6a3881b95180ec1e16d40ec16e73019b2d'],
  [.18,0,'bf8250764b31532eb006694caa7675be519b10593c8f8e6a4e143f54b357680f'],
  [.5,0,'6b7d1dd0f16b7ab37dbd75426595b41740c28ad0ede53183155d663c7c8c0a73'],
  [1,0,'641a17098f94dc844b72d47287704ad7fad4ea758a0882bac6d443156dd8d4f6'],
  [1,.35,'0ab26439fd24a92f861c57ce607f935a569abb6a155af71dd933bb5ef35f1b69'],
  [1,.82,'c6125c4cf3e9e7c5edbf504ce392b43eb3d44dad14fb47fd14dd9461f1a3ff2b'],
  [1,1,'9d027a3414004b9bf6f76c7b67e1672c5c24060b1429c517170445fcf1cdcedc'],
  [.6,.1,'54f62b720a450827ddecd939dd38299f3438299ad0c55b50995e770a3ab7a2f9'],
  [0,.7,'e9cc1d4cfd43a85f0a153bad138e5dfd52f2711cc40f5c61d9f3a5bda8fd0f8b']
];
function fingerprint(geometry) {
  const hash = createHash('sha256');
  for (const key of ['position','uv','normal']) hash.update(Buffer.from(geometry.getAttribute(key).array.buffer));
  return hash.update(Buffer.from(geometry.index.array.buffer)).digest('hex');
}
describe('ribbon animation keeps its original mesh and GPU buffers', () => {
  it('matches the original geometry at every recorded opening and withdrawal pose', () => {
    const geometry = bookmarkGeometry(264,400,80,.45,16,{segments:32,seed:12345});
    const attributes = ['position','uv','normal'].map(key => geometry.getAttribute(key));
    const index = geometry.index, release = vi.spyOn(geometry,'dispose');
    for (const [open,withdraw,hash] of originalPoses) {
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      expect(bookmarkGeometry(264,400,80,.45,16,{open,withdraw,segments:32,seed:12345,geometry})).toBe(geometry);
      expect(fingerprint(geometry)).toBe(hash);
      expect(['position','uv','normal'].map(key => geometry.getAttribute(key))).toEqual(attributes);
      for (let i=0;i<attributes.length;i++) expect(geometry.getAttribute(['position','uv','normal'][i])).toBe(attributes[i]);
      expect(geometry.index).toBe(index);
      expect(geometry.boundingBox).toBeNull(); expect(geometry.boundingSphere).toBeNull();
    }
    expect(release).not.toHaveBeenCalled(); geometry.dispose(); expect(release).toHaveBeenCalledOnce();
  });
  it('creates a new mesh when the number of segments changes without disposing its caller’s mesh', () => {
    const original = bookmarkGeometry(132,200,40,.3,10,{segments:16});
    const release = vi.spyOn(original,'dispose');
    const changed = bookmarkGeometry(132,200,40,.3,10,{segments:32,geometry:original});
    expect(changed).not.toBe(original); expect(changed.getAttribute('position').count).toBe(132);
    expect(release).not.toHaveBeenCalled(); original.dispose(); changed.dispose();
  });
});
