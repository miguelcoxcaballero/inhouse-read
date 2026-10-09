import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookModel } from '../../src/js/book-model.js';

afterEach(() => vi.restoreAllMocks());
const style = { color:'#42604b', shade:'#324c3a', ink:'#ffffff', coverRatio:.66, width:40 };
const book = { id:'raster:test', title:'Printed jacket', author:'Actual author', format:'EPUB' };
const cover = model => model.getObjectByName('front-cover').material[0].map;

describe('actual book models reuse their detailed jacket raster', () => {
  it('keeps the warm print through temporary disposal, reuses it on selection, and releases it with the shelf', async () => {
    const context = new Proxy({
      measureText:text => ({ width:String(text).length * 16 }),
      createLinearGradient:() => ({ addColorStop() {} }),
      getImageData:(_x, _y, w, h) => ({ data:new Uint8ClampedArray(w * h * 4) })
    }, { get:(target, key) => target[key] ?? (() => {}) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    let complete;
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => { complete = ready; });
    const shelf = createBookModel(book, style, 132, 200, 40, 'blob:raster-reuse', { shelf:true });
    complete(new THREE.Texture({ width:660, height:1000 })); await shelf.userData.ready;
    const warmed = createBookModel(book, style, 132, 200, 40, 'blob:raster-reuse', { eagerRelief:false });
    const source = cover(warmed).source, version = source.version, oldMap = cover(warmed);
    const disposed = vi.spyOn(oldMap, 'dispose'); warmed.userData.dispose(); expect(disposed).toHaveBeenCalledOnce();
    const selected = createBookModel(book, style, 264, 400, 80, 'blob:raster-reuse', { eagerRelief:false });
    expect(selected.userData.coverLoaded).toBe(true); expect(cover(selected).image.height).toBe(1024);
    expect(cover(selected).source).toBe(source); expect(source.version).toBe(version);
    const changed = createBookModel({ ...book, title:'Changed jacket' }, style, 264, 400, 80, 'blob:raster-reuse');
    expect(cover(changed).source).not.toBe(source); expect(cover(selected).source).toBe(source);
    selected.userData.dispose(); changed.userData.dispose(); shelf.userData.dispose();
    const later = createBookModel(book, style, 132, 200, 40, 'blob:raster-reuse');
    expect(loader).toHaveBeenCalledTimes(2); expect(later.userData.coverLoaded).not.toBe(true);
    later.userData.dispose();
  });
});
