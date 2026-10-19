import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import { SURFACE_FINISHES } from '../../src/js/book-colors.js';

const native = () => needRustShelf();
// Frozen pre-migration decisions, independent of the Rust model planner.
function referencePlan(height, shelf, overview, inspection, pixelRatio) {
  inspection = shelf && !overview ? (inspection >= 2048 ? 2048 : inspection >= 1024 ? 1024 : 0) : 0;
  const ratio = Math.min(2, typeof pixelRatio === 'number' ? pixelRatio : 1);
  const lifted = height * ratio > 1100 ? 2048 : 1024;
  return { inspectionResolution:inspection, detailLevel:overview ? 'overview' : shelf ? 'shelf' : 'detail',
    textureHeight:inspection || (overview ? 256 : shelf ? 512 : lifted), maxTextureDimension:overview ? 256 : Infinity,
    bindingSegments:overview ? 16 : shelf ? 32 : 96, reliefRows:shelf ? 96 : 384,
    ribbonSegments:overview ? 8 : 32, detail:!shelf && !overview };
}
function referenceSpine(height, shelf, overview, inspection, pixelRatio) {
  if (overview) return { textureWidth:64, textureHeight:256, engraving:false, level:'overview' };
  const ratio = Math.min(2, typeof pixelRatio === 'number' ? pixelRatio : 1);
  const lifted = inspection || (height * ratio > 1100 ? 2048 : 1024);
  if (inspection) return { textureWidth:512, textureHeight:inspection, level:'detail' };
  return shelf ? { textureWidth:256, textureHeight:1024, level:'shelf' }
    : { textureWidth:lifted / 2, textureHeight:lifted, level:'detail' };
}

describe('Rust model quality decisions', () => {
  it('preserves inspection, overview and closeup quality across threshold edges', () => {
    for (const height of [1, 440, 550, 550.0001, 1100, 1100.0001, 1900])
      for (const ratio of [undefined, '2', 0, 1, 1.5, 2, 3, NaN])
        for (const inspection of [0, 1023, 1024, 2047, 2048, 4096, NaN])
          for (const shelf of [false, true]) for (const overview of [false, true]) {
            const args = [height, shelf, overview, inspection, ratio];
            expect(native().book_model_plan(...args)).toEqual(referencePlan(...args));
            expect(native().book_spine_options(...args)).toEqual(referenceSpine(...args));
          }
  });
  it('preserves cover dimensions and rounding without reducing texture resolution', () => {
    for (const ratio of [undefined, null, '0.66', '', 0, NaN, -1, .1, .66, 1, 2.5])
      for (const height of [256, 512, 1024, 2048]) for (const limit of [256, 512, Infinity]) {
        const width = Math.max(1, Math.round(height * (Number(ratio) || .66)));
        const scale = Math.min(1, limit / Math.max(width, height));
        expect(native().book_cover_raster_size(ratio, height, limit)).toEqual({
          width:Math.max(1, Math.round(width * scale)), height:Math.max(1, Math.round(height * scale)) });
      }
  });
});

describe('Rust texture ownership with real Three objects', () => {
  it('shares the source without dirtying GPU pixels or sharing mutable repeat state', () => {
    const base = new THREE.DataTexture(new Uint8Array(16), 2, 2); base.needsUpdate = true;
    const version = base.source.version, build = vi.fn(() => base), key = Symbol('shared texture');
    const first = native().book_shared_texture(key, build), second = native().book_shared_texture(key, build);
    expect(build).toHaveBeenCalledOnce(); expect(first).not.toBe(second);
    expect(first.source).toBe(base.source); expect(second.source).toBe(base.source);
    expect(base.source.version).toBe(version);
    first.repeat.set(2, 3); expect(second.repeat.toArray()).toEqual([1, 1]);
    const keep = vi.spyOn(base, 'dispose'); first.dispose(); second.dispose(); expect(keep).not.toHaveBeenCalled();
  });
  it('retries a failed builder and allows builders to reenter another cache key', () => {
    const key = Symbol('retry'), nestedKey = Symbol('nested');
    expect(() => native().book_shared_texture(key, () => { throw new Error('decode'); })).toThrow('decode');
    const nested = new THREE.Texture(), build = vi.fn(() => native().book_shared_texture(nestedKey, () => nested));
    const texture = native().book_shared_texture(key, build);
    expect(texture.source).toBe(nested.source); expect(build).toHaveBeenCalledOnce(); texture.dispose();
  });
  it('releases unique materials/maps once despite aliasing and preserves shared cache bases', () => {
    const group = new THREE.Group(), texture = new THREE.Texture(), channels = new THREE.Texture();
    const material = new THREE.MeshPhysicalMaterial({ map:texture, roughnessMap:channels, metalnessMap:channels });
    const inside = new THREE.MeshBasicMaterial({ map:texture });
    const a = new THREE.BoxGeometry(), b = new THREE.PlaneGeometry();
    group.add(new THREE.Mesh(a, material), new THREE.Mesh(b, [material, inside]));
    const owned = [a,b,material,inside,texture,channels], calls = [];
    const spies = owned.map((resource,index) => vi.spyOn(resource, 'dispose').mockImplementation(() => calls.push(index)));
    native().book_dispose_resources(group, inside, { map:texture, channels });
    spies.forEach(spy => expect(spy).toHaveBeenCalledOnce());
    expect(calls).toEqual([0,1,3,2,4,5]);
  });
  it('retains installed relief maps and releases replaced placeholders once', () => {
    const cover = new THREE.MeshPhysicalMaterial(), normal = new THREE.Texture(), material = new THREE.Texture();
    const oldNormal = new THREE.Texture(), oldMaterial = new THREE.Texture();
    cover.clearcoatNormalMap = oldNormal; cover.clearcoatMap = oldMaterial;
    const releases = [normal,material,oldNormal,oldMaterial].map(value => vi.spyOn(value,'dispose'));
    let owned = native().book_adopt_relief_textures(cover, new Set(), normal, material);
    expect([...owned]).toEqual([normal,material]); expect(releases[2]).toHaveBeenCalledOnce(); expect(releases[3]).toHaveBeenCalledOnce();
    for (const key of ['clearcoatMap','clearcoatRoughnessMap','roughnessMap','metalnessMap']) expect(cover[key]).toBe(material);
    owned = native().book_adopt_relief_textures(cover, owned, normal, material);
    expect(releases[0]).not.toHaveBeenCalled(); expect(releases[1]).not.toHaveBeenCalled();
    const fresh = new THREE.Texture(); native().book_adopt_relief_textures(cover, owned, normal, fresh);
    expect(releases[0]).not.toHaveBeenCalled(); expect(releases[1]).toHaveBeenCalledOnce();
  });
});

describe('native finish application preserves lamp response', () => {
  it('keeps all finish properties and update versions for paper, cover, surface and metal caps', () => {
    for (const finish of Object.values(SURFACE_FINISHES)) for (const kind of ['paper','cover','surface','cap'])
      for (const metallic of [false,true]) {
        const actual = new THREE.MeshPhysicalMaterial(), expected = new THREE.MeshPhysicalMaterial();
        if (kind === 'cap') expected.metalness = metallic ? 1 : 0;
        if (kind === 'cap' && metallic) Object.assign(expected, { roughness:.3, envMapIntensity:1.8, clearcoat:.42, clearcoatRoughness:.16, needsUpdate:true });
        else {
          for (const key of ['roughness','clearcoat','clearcoatRoughness','envMapIntensity']) expected[key] = finish[key];
          expected.needsUpdate = true;
          if (kind === 'paper') { expected.roughness = .35 + expected.roughness * .6; expected.clearcoat *= .3; expected.specularIntensity = .7; }
          else if (kind === 'cover') expected.specularIntensity = 1;
        }
        native().book_apply_material_finish(actual, finish, kind, metallic);
        for (const key of ['roughness','clearcoat','clearcoatRoughness','envMapIntensity','metalness','specularIntensity','version']) expect(actual[key]).toBe(expected[key]);
        actual.dispose(); expected.dispose();
      }
  });
});
