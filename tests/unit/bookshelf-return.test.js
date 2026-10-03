import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { shelfBookSlot, shelfBookInsertion, projectShelfBookPose, bookReturnSignature, createBookReturnCache } from '../../src/js/bookshelf-return.js';

const entry = { x:112, y:150, width:100, height:160, thickness:28 };
const stage = { left:12, top:76 };
const book = { id:'return-book',title:'A physical book',format:'PDF',progressFraction:.1,locator:1,lastOpenedAt:100 };
const style = { color:'#246',coverRatio:.66 };
const geometry = { width:200,height:300,thickness:32,viewportWidth:390,viewportHeight:844,centerX:195,centerY:320 };
const signature = (record = book,dimensions = geometry,appearance = style,url = 'blob:cover') => bookReturnSignature(record,appearance,dimensions,url);

describe('retaining the already rendered book for the reader return', () => {
  it('ignores progress-only writes while keeping the final ribbon available for update', () => {
    expect(signature({ ...book,progressFraction:.8,locator:10,lastOpenedAt:500,progressUpdatedAt:500,progressDirty:true })).toBe(signature());
  });
  it('preserves the case across Drive linkage, offline bytes and length metadata written in the background', () => {
    expect(signature({ ...book,driveFileId:'cloud-1',cloudAccountId:'account-1',progressStateFileId:'state-1',
      content:new Blob(['same local book']),wordCount:60000,estimatedPageCount:200,pageCount:100,
      sourceType:'drive',lastSyncedAt:700 })).toBe(signature());
  });
  it.each(['width','height','thickness','viewportWidth','viewportHeight','centerX','centerY'])('rejects a changed %s instead of reusing the old camera/geometry', key => {
    expect(signature(book,{ ...geometry,[key]:geometry[key]+1 })).not.toBe(signature());
  });
  it.each(['title','author','spineFontFamily','spineFontSize','spineAuthorFontSize','spineTitleOverride','coverFinish','coverRelief','spineFinish','spineTextColor','pageEdgeFinish'])('rejects an edited %s', key => {
    expect(signature({ ...book,[key]:'changed' })).not.toBe(signature());
  });
  it('rejects a changed style, decoded cover source or nonfinite camera', () => {
    expect(signature(book,geometry,{ ...style,color:'#fff' })).not.toBe(signature());
    expect(signature(book,geometry,style,'blob:new')).not.toBe(signature());
    expect(signature(book,{ ...geometry,centerY:NaN })).toBeNull();
  });
  it('transfers exactly the same view once and leaves disposal to the return animation', () => {
    const cache = createBookReturnCache(), view = { dispose:vi.fn() };
    cache.retain(signature(),view);
    expect(cache.take(signature())).toBe(view);
    expect(cache.take(signature())).toBeNull();
    cache.clear();
    expect(view.dispose).not.toHaveBeenCalled();
  });
  it('disposes an incompatible view once and empties the cache', () => {
    const cache = createBookReturnCache(), view = { dispose:vi.fn() };
    cache.retain(signature(),view);
    expect(cache.take(signature({ ...book,title:'New title' }))).toBeNull();
    cache.clear();
    expect(view.dispose).toHaveBeenCalledOnce();
  });
  it('keeps at most one view and releases it on replacement or destruction', () => {
    const cache = createBookReturnCache(), first = { dispose:vi.fn() }, second = { dispose:vi.fn() };
    cache.retain(signature(),first); cache.retain(signature(),second);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).not.toHaveBeenCalled();
    cache.clear(); cache.clear();
    expect(second.dispose).toHaveBeenCalledOnce();
  });
});

describe('returning a book into the shared cabinet scene', () => {
  it('starts entirely in front of the shelf and ends at the exact parked matrix', () => {
    const slot = shelfBookSlot(entry, 390);
    const dock = shelfBookInsertion(slot, entry.width);
    expect(dock.elements[14] - slot.elements[14]).toBe(124);
    expect(dock.elements[13] - slot.elements[13]).toBe(6);
    expect(shelfBookInsertion(slot, entry.width, 1).elements).toEqual(slot.elements);
    expect(slot.elements[14]).toBe(-50);
    expect(slot.elements[13]).toBe(-150);
  });

  it('preserves the composed world orientation, including the frontal gimbal boundary', () => {
    for (const progress of [0, .01, .25, .5, 1]) {
      const cabinet = new THREE.Matrix4().compose(new THREE.Vector3(195, -20, 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(14 * progress * Math.PI / 180, -30 * progress * Math.PI / 180, 0)),
        new THREE.Vector3(.78, .78, .78));
      const slot = shelfBookSlot(entry, 390);
      const dock = shelfBookInsertion(slot, entry.width);
      const pose = projectShelfBookPose(cabinet, dock, entry, stage);
      const restored = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(pose.pitch), THREE.MathUtils.degToRad(pose.angle), THREE.MathUtils.degToRad(pose.roll), 'XYZ'));
      const composed = new THREE.Quaternion();
      new THREE.Matrix4().multiplyMatrices(cabinet, dock).decompose(new THREE.Vector3(), composed, new THREE.Vector3());
      expect(Math.abs(restored.dot(composed))).toBeCloseTo(1, 10);
      expect(pose.scale).toBeCloseTo(.78);
      expect(pose).toMatchObject({ width:100, height:160, thickness:28 });
    }
  });

  it('projects a diagonal approach from cabinet depth rather than sliding over adjacent spines', () => {
    const cabinet = new THREE.Matrix4().compose(new THREE.Vector3(195, 0, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(14 * Math.PI / 180, -Math.PI / 6, 0)),
      new THREE.Vector3(.78, .78, .78));
    const slot = shelfBookSlot(entry, 390);
    const dock = projectShelfBookPose(cabinet, shelfBookInsertion(slot, entry.width), entry, stage);
    const parked = projectShelfBookPose(cabinet, slot, entry, stage);
    expect(dock.centerX - parked.centerX).toBeCloseTo(-124 * .78 * .5);
    expect(dock.depth).toBeGreaterThan(parked.depth + 70);
    expect(dock.centerY).toBeGreaterThan(parked.centerY);
    expect(dock.angle).toBeCloseTo(60);
    expect(dock.pitch).toBeCloseTo(14);
  });

  it('does not mutate the stored slot transform and clamps insertion to its endpoints', () => {
    const slot = shelfBookSlot(entry, 390), original = [...slot.elements];
    expect(shelfBookInsertion(slot, entry.width, -1).elements).toEqual(shelfBookInsertion(slot, entry.width, 0).elements);
    expect(shelfBookInsertion(slot, entry.width, 2).elements).toEqual(original);
    expect(slot.elements).toEqual(original);
  });
});
