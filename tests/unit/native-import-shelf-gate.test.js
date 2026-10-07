import {describe, it, expect, vi} from 'vitest';
import {createNativeImportShelfGate} from '../../src/js/native-import-shelf-gate.js';
import {initAndroidFileImports} from '../../src/js/android-file-import.js';
import {readFileSync} from 'node:fs';

describe('native import shelf work',()=>{
  function setup(){
    let reader=false;
    const refresh=vi.fn();
    return {refresh,setReader:value=>{reader=value;},gate:createNativeImportShelfGate({isReaderVisible:()=>reader,refresh})};
  }
  it('does not defer an ordinary home or reader refresh',()=>{
    const {gate,setReader}=setup();
    expect(gate.deferRefresh()).toBe(false);setReader(true);
    expect(gate.deferRefresh()).toBe(false);
  });
  it('defers cold import construction and queued work until home returns',()=>{
    const {gate,setReader,refresh}=setup();gate.setActive(true);
    expect(gate.deferRefresh()).toBe(true);setReader(true);gate.setActive(false);
    expect(gate.deferRefresh()).toBe(true);expect(refresh).not.toHaveBeenCalled();
    setReader(false);expect(gate.deferRefresh()).toBe(false);
    setReader(true);expect(gate.deferRefresh()).toBe(false);
  });
  it('resumes the pending home after a transfer or storage failure',()=>{
    const {gate,refresh}=setup();gate.setActive(true);gate.setActive(false);
    expect(refresh).toHaveBeenCalledOnce();expect(gate.deferRefresh()).toBe(false);
    gate.setActive(false);expect(refresh).toHaveBeenCalledOnce();
  });
  it('a second import cannot release the room during its transfer',()=>{
    const {gate,setReader,refresh}=setup();gate.setActive(true);setReader(true);gate.setActive(false);
    gate.setActive(true);setReader(false);expect(gate.deferRefresh()).toBe(true);
    gate.setActive(false);expect(refresh).toHaveBeenCalledOnce();expect(gate.deferRefresh()).toBe(false);
  });
  it('the actual inbox signals activity before reading bytes, and ends after the local import',async()=>{
    const activity=[],bytes=new Uint8Array([37,80,68,70]);let finish;
    const bridge={pending:()=>JSON.stringify([{id:'file',name:'Book.pdf',size:bytes.length}]),
      readChunk:()=>{expect(activity).toEqual([true]);return btoa(String.fromCharCode(...bytes));},acknowledge:vi.fn()};
    const onFile=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    const stop=initAndroidFileImports({bridge,onFile,onActivity:value=>activity.push(value)});
    try{await vi.waitFor(()=>expect(onFile).toHaveBeenCalledOnce());expect(activity).toEqual([true]);finish();
      await vi.waitFor(()=>expect(activity).toEqual([true,false]));expect(bridge.acknowledge).toHaveBeenCalledWith('file');
    }finally{stop();}
  });
  it('an empty inbox leaves shelf startup alone',()=>{
    const activity=vi.fn();const stop=initAndroidFileImports({bridge:{pending:()=> '[]',readChunk:vi.fn(),acknowledge:vi.fn()},onActivity:activity});
    expect(activity).not.toHaveBeenCalled();stop();
  });
  it('a rejected file ends activity and preserves the failed local original',async()=>{
    const activity=[],onError=vi.fn(),bridge={pending:()=>JSON.stringify([{id:'file',name:'Book.pdf',size:1}]),readChunk:()=>btoa('x'),acknowledge:vi.fn()};
    const stop=initAndroidFileImports({bridge,onActivity:value=>activity.push(value),onError,pollMs:10,
      onFile:()=>Promise.reject(Object.assign(new Error('Full'),{code:'LOCAL_BOOK_STORAGE_FAILED'}))});
    try{await vi.waitFor(()=>expect(activity).toEqual([true,false]));expect(onError).toHaveBeenCalledOnce();
      expect(bridge.acknowledge).not.toHaveBeenCalled();await new Promise(resolve=>setTimeout(resolve,25));expect(activity).toEqual([true,false]);
    }finally{stop();}
  });
  it('the production refresh discards its boot snapshot even when import defers the first room',async()=>{
    const source=readFileSync('src/js/app.js','utf8');
    const body=source.split('async function performShelfRefresh({ immediate = false } = {}) {')[1].split('// Re-rendering a shelf')[0];
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    const takeFirstRecords=vi.fn(()=>Promise.resolve([]));
    await new AsyncFunction('appDisposed','nativeImportShelfGate','takeFirstRecords',body)(false,{deferRefresh:()=>true},takeFirstRecords);
    expect(takeFirstRecords).toHaveBeenCalledOnce();
  });
});
