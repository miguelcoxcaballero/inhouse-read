import { describe, expect, it } from 'vitest';
import { normalizeShelfPlant, resolveCatalogPlant } from '../../src/js/plant-records.js';
import { plantDimensions } from '../../src/js/plant-dimensions.js';

describe('current models for saved plant generations', () => {
  it('preserves explicit large pots and legacy defaults while retaining an explicitly chosen compact size', () => {
    for (const potId of ['muskot','muskotblomma','akerbar','gradvis','muskot9']) {
      const saved=normalizeShelfPlant({key:'saved',catalogId:'succulent',potId});
      expect(saved.potId).toBe(potId);
      expect(saved.height).toBe(plantDimensions('succulent',potId).height);
    }
    expect(normalizeShelfPlant({key:'legacy',catalogId:'succulent'}).potId).toBe('muskotblomma');
    expect(normalizeShelfPlant({key:'new',catalogId:'succulent',potId:'muskot9'}).height).toBe(189);
  });
  it.each([
    ['upright','sansevieria'], ['sansevieria','sansevieria'], ['monstera','monstera'],
    ['leafy','hedera'], ['pothos','hedera'], ['ivy','hedera'], ['suculenta','succulent'],
    ['succulent','succulent'], ['cactus','cactus'], ['palm','chamaedorea'],
    ['fern','nephrolepis'], ['zz','zamioculcas']
  ])('resolves the legacy %s to %s', (variant, id) => {
    expect(resolveCatalogPlant({ variant }).id).toBe(id);
  });
  it('gives a valid catalog selection priority over its old variant', () => {
    expect(resolveCatalogPlant({ catalogId:'nephrolepis', variant:'pothos' }).id).toBe('nephrolepis');
    expect(resolveCatalogPlant({ catalogId:'removed', variant:'pothos' }).id).toBe('hedera');
    expect(resolveCatalogPlant({ variant:'removed' }).id).toBe('monstera');
  });
  it('preserves placement and identity but replaces arbitrary saved dimensions with the IKEA size', () => {
    const legacy = { key:'plant:old', seed:'original-seed', variant:'pothos', width:44, height:98, shelf:4, x:.36 };
    const migrated = normalizeShelfPlant(legacy);
    expect(migrated).toEqual({ ...legacy, catalogId:'hedera', variant:'hedera', potId:'muskotblomma',
      width:plantDimensions('hedera','muskotblomma').width, height:plantDimensions('hedera','muskotblomma').height });
    expect(migrated).toMatchObject({ seed:'original-seed', shelf:4, x:.36, width:180, height:240 });
    expect(legacy).toMatchObject({ variant:'pothos', width:44, height:98 });
  });
  it.each([[54,124],[0,NaN],[-5,undefined],[9999,9999],['wide',null]])('ignores the saved size %s x %s', (width, height) => {
    expect(normalizeShelfPlant({ key:'plant:old', catalogId:'sansevieria', width, height }))
      .toMatchObject({ width:150, height:250 });
  });
  it('preserves the same foliage above each pot soil line, widening only for its footprint', () => {
    const size = potId => normalizeShelfPlant({ key:'plant:p', catalogId:'succulent', potId });
    expect(size('muskot')).toMatchObject({ width:150, height:216 });
    expect(size('gradvis')).toMatchObject({ width:140, height:198 });
    expect(size('muskotblomma')).toMatchObject({ width:160, height:207 });
  });
  it('supplies invalid pots from the resolved catalog, with the standard size', () => {
    expect(normalizeShelfPlant({ key:'plant:old', catalogId:'succulent', width:0, height:NaN, potId:'removed' }))
      .toMatchObject({ seed:'plant:old', catalogId:'succulent', variant:'succulent', width:160, height:207, potId:'muskotblomma' });
  });
  it('migrates every legacy alias to the size of its current species and keeps places', () => {
    const records = ['upright','leafy','pothos','ivy','suculenta','palm','fern','zz','cactus','monstera']
      .map((variant, index) => ({ key:`plant:${variant}`, variant, width:40 + index, height:60 + index, shelf:index % 3, x:index / 10 }));
    for (const record of records) {
      const migrated = normalizeShelfPlant(record), species = resolveCatalogPlant(record);
      expect(migrated).toMatchObject({ shelf:record.shelf, x:record.x, seed:record.key, catalogId:species.id });
      expect(migrated.height).toBe(plantDimensions(species.id, migrated.potId).height);
      expect(migrated.width).toBe(plantDimensions(species.id, migrated.potId).width);
    }
  });
  it('keeps valid saved finishes and repairs colours from a different material', () => {
    const record = {key:'plant:colour',catalogId:'monstera',potId:'gradvis',potColorId:'seafoam'};
    expect(normalizeShelfPlant(record).potColorId).toBe('seafoam');
    expect(normalizeShelfPlant({...record,potColorId:'copper'}).potColorId).toBe('rose');
    expect(normalizeShelfPlant({...record,potId:'akerbar',potColorId:'copper'}).potColorId).toBe('copper');
  });
  it('keeps complete current records identical and is idempotent', () => {
    const current = { key:'plant:kept', seed:'kept', catalogId:'monstera', variant:'monstera',
      potId:'muskot', width:260, height:368, shelf:0, x:.45 };
    expect(normalizeShelfPlant(current)).toEqual(current);
    const migrated = normalizeShelfPlant({ key:'plant:old', variant:'suculenta', width:50 });
    expect(normalizeShelfPlant(migrated)).toEqual(migrated);
  });
  it.each([null, undefined, {}, { key:'' }, { key:32 }])('rejects records without a stable identity: %s', record => {
    expect(normalizeShelfPlant(record)).toBeNull();
  });
});
