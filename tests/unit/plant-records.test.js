import { describe, expect, it } from 'vitest';
import { normalizeShelfPlant, resolveCatalogPlant } from '../../src/js/plant-records.js';

describe('current models for saved plant generations', () => {
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
  it('preserves placement, identity, and explicit dimensions during migration', () => {
    const legacy = { key:'plant:old', seed:'original-seed', variant:'pothos', width:44, height:98, shelf:4, x:.36 };
    expect(normalizeShelfPlant(legacy)).toEqual({ ...legacy, catalogId:'hedera', variant:'hedera', potId:'muskotblomma' });
    expect(legacy.variant).toBe('pothos');
  });
  it('supplies missing dimensions and invalid pots from the resolved catalog', () => {
    expect(normalizeShelfPlant({ key:'plant:old', catalogId:'succulent', width:0, height:NaN, potId:'removed' }))
      .toMatchObject({ seed:'plant:old', catalogId:'succulent', variant:'succulent', width:66, height:72, potId:'muskotblomma' });
  });
  it('keeps complete current records identical and is idempotent', () => {
    const current = { key:'plant:kept', seed:'kept', catalogId:'monstera', variant:'monstera',
      potId:'muskot', width:86, height:110, shelf:0, x:.45 };
    expect(normalizeShelfPlant(current)).toEqual(current);
    const migrated = normalizeShelfPlant({ key:'plant:old', variant:'suculenta', width:50 });
    expect(normalizeShelfPlant(migrated)).toEqual(migrated);
  });
  it.each([null, undefined, {}, { key:'' }, { key:32 }])('rejects records without a stable identity: %s', record => {
    expect(normalizeShelfPlant(record)).toBeNull();
  });
});
