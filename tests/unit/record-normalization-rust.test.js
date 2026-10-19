import { describe, expect, it } from 'vitest';
import * as actual from '../../src/js/readers/reading-state.js';
import * as reference from './helpers/reference-reading-state.js';
import { normalizeShelfLamp } from '../../src/js/lamp-catalog-data.js';
import { normalizeShelfLamp as referenceLamp } from './helpers/reference-lamp-catalog-data.js';
import { canAdoptShelfMetadata } from '../../src/js/shelf-metadata-records.js';
import { canAdoptShelfMetadata as referenceAdoption } from './helpers/reference-shelf-metadata-records.js';
import { rustUI } from './helpers/rust-ui-ready.js';
import { LAMP_CATALOG } from '../../src/js/lamp-catalog-data.js';
import { LAMP_KELVINS } from '../../src/js/lamp-kelvin.js';

const outcome = operation => {
  try { return { value:operation() }; } catch (error) { return { error:error.name, message:error.message }; }
};
function sequence(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
}

describe('Rust persisted reading and shelf record policies', () => {
  it('exports the same record policy in the independent cloud/reader module', () => {
    const records=[{fraction:.6,locator:{kind:'pdf-page',value:9,textOffset:42},text:' passage ',color:'pink'}];
    expect(rustUI.record_clean_places(records,20,false)).toStrictEqual(reference.cleanPlaces(records));
    expect(rustUI.record_clean_places(records,200,true)).toStrictEqual(reference.cleanQuotes(records));
    expect(rustUI.record_clone_place(records[0])).toStrictEqual(reference.clonePlace(records[0]));
    const lamp={lampId:'mittled',key:'lamp:one',shelf:2,x:.4,isOn:false,kelvin:2200};
    expect(rustUI.record_normalize_lamp(lamp,new Map(LAMP_CATALOG.map(lamp=>[lamp.id,lamp])),LAMP_KELVINS)).toStrictEqual(referenceLamp(lamp));
  });
  it('preserves normalizations, field order and UTF-16 truncation across generated records', () => {
    const next = sequence(91225), pick = values => values[next() % values.length];
    const fractions = [undefined, null, NaN, Infinity, -Infinity, -0, 0, -.5, .35, 1, 2, '', '0.75', 'bad', false, true];
    const offsets = [undefined, 0, -1, 1.5, 34, 10_000_001, Infinity, '7'];
    const records = Array.from({length:500}, (_, index) => ({
      id:pick(['', null, 0, 'id:'+index, 'a'.repeat(79)+'😀']), fraction:pick(fractions),
      text:pick([null, '', '  ', '\ufeff \n quote '+index+' \t', 'a'.repeat(1199)+'😀']),
      label:pick([undefined, false, 4, 'chapter', 'a'.repeat(139)+'😀']),
      locator:pick([null, {kind:'pdf-page',value:pick(fractions),textOffset:pick(offsets)},
        {kind:'cfi',value:'a'.repeat(4095)+'😀'}, {kind:'cfi',value:4}, {kind:'unknown'}]),
      createdAt:pick(fractions), color:pick(['yellow', 'green', 'blue', 'pink', 'red', undefined])
    }));
    for (const limit of [undefined, 0, 1, 20, 200, 600, -1, -12, 2.7, null, NaN, Infinity, -Infinity, '3']) {
      for (const name of ['cleanPlaces','cleanQuotes']) {
        const left = actual[name](records, limit), right = reference[name](records, limit);
        expect(left).toStrictEqual(right);
        expect(left.map(Object.keys)).toStrictEqual(right.map(Object.keys));
      }
    }
    expect(actual.cleanQuotes([{text:'a'.repeat(1199)+'😀'}])[0].text.charCodeAt(1199)).toBe(0xd83d);
  });

  it('preserves sparse arrays, filter-before-limit errors and getter access ordering', () => {
    const sparse = []; sparse[3] = { fraction:.5, text:'quote' }; sparse.length = 7;
    for (const name of ['cleanPlaces','cleanQuotes']) {
      expect(actual[name](sparse)).toStrictEqual(reference[name](sparse));
      for (const input of [null, undefined, {}, 'x', 42]) expect(actual[name](input)).toStrictEqual(reference[name](input));
    }
    const bad = [{ fraction:0 }, { fraction:Symbol('bad') }];
    expect(outcome(() => actual.cleanPlaces(bad,0))).toStrictEqual(outcome(() => reference.cleanPlaces(bad,0)));
    const run = (api, name) => {
      const trace = [], locator = {kind:'pdf-page',value:2.7,textOffset:38};
      const record = new Proxy({fraction:.6,text:' quote ',label:'label',id:'id',createdAt:4,color:'blue',locator}, {
        get(target,key) { trace.push(String(key)); return target[key]; }
      });
      return { value:api[name]([record]), trace };
    };
    for (const name of ['cleanPlaces','cleanQuotes']) expect(run(actual,name)).toStrictEqual(run(reference,name));
  });

  it('clones a place without normalizing its values or aliasing its locator', () => {
    const symbol = Symbol('location');
    for (const locator of [null, '', 'ab', 4, {kind:'cfi',value:'cfi',[symbol]:5}]) {
      for (const fraction of [undefined, null, -0, NaN, .5, -2, 'unchanged']) {
        const source = {fraction,locator};
        expect(actual.clonePlace(source)).toStrictEqual(reference.clonePlace(source));
        if (locator && typeof locator === 'object') expect(actual.clonePlace(source).locator).not.toBe(locator);
      }
    }
  });

  it('retains every lamp saved-field rule including missing optional fields', () => {
    const next = sequence(22), pick = values => values[next() % values.length];
    for (let index=0;index<1200;index++) {
      const record = {lampId:pick(['mittled','tripod','tarnaby','unknown',null]),
        key:pick(['k',' ',null,8,'\ufeffkey\u00a0']), seed:pick(['s','',null,' seed ']),
        isOn:pick([false,true,0,undefined,null,'false']),
        shelf:pick([undefined,0,-0,-1,.7,4.9,9999,NaN,Infinity,'4']),
        x:pick([undefined,-.5,-0,0,.7,2,NaN,Infinity,'0.2']),
        kelvin:pick([undefined,2200,2700,3000,4000,6500,'2700'])};
      const left=normalizeShelfLamp(record),right=referenceLamp(record);
      expect(left).toStrictEqual(right);
      if(left)expect(Object.keys(left)).toStrictEqual(Object.keys(right));
    }
  });

  it('keeps metadata adoption exactly equivalent across Blob identities, stamps and unknown fields', () => {
    const next = sequence(54312), pick = values => values[next() % values.length];
    for (let index=0;index<600;index++) {
      const before={id:'a',title:'Book',progressFraction:.3,progressDirty:true,
        content:new Blob(['pdf']),cover:new Blob(['cover']),contentRevision:pick(['original','',null]),
        coverUpdatedAt:pick([0,100,undefined]),futureAsset:{bytes:new Blob(['asset'])}};
      const after={...before,progressDirty:pick([true,false]),locator:{page:index}};
      if(next()%3===0)after.content=new Blob(['pdf']);
      if(next()%3===0)after.cover=new Blob(['cover']);
      if(next()%3===0)after.futureAsset={bytes:new Blob(['asset'])};
      if(next()%5===0)after.shelfPosition={shelf:0,x:.2};
      if(next()%5===0)after.contentRevision='changed';
      expect(canAdoptShelfMetadata([before],[after])).toBe(referenceAdoption([before],[after]));
    }
  });

  it('keeps predicate order, propagates getter failures and safely reports unsupported recursive records', () => {
    const error=new Error('getter failure');
    const before={id:'a',progressFraction:.5,progressDirty:true};
    const after={...before,progressDirty:false};
    Object.defineProperty(before,'future',{enumerable:true,get(){throw error;}});
    expect(() => canAdoptShelfMetadata([before],[after])).toThrow(error);
    const a={id:'a',progressFraction:.5,progressDirty:true},b={...a,progressDirty:false};
    a.future=a;b.future=b;
    expect(() => canAdoptShelfMetadata([a],[b])).toThrow(RangeError);
    expect(() => referenceAdoption([a],[b])).toThrow(RangeError);
  });
});
