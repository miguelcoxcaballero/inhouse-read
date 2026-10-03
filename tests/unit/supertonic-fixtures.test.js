// @vitest-environment node
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp,readFile,rm,writeFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSupertonicFixtures,verifyAsset } from '../../scripts/prepare-supertonic-fixtures.mjs';
import { SUPERTONIC_BASE,SUPERTONIC_REVISION } from '../../src/js/readers/neural-voice/supertonic-catalog.js';

const bytes=Buffer.from('{"realFixtureTest":true}');
const asset={path:'onnx/tts.json',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
describe('pinned real Supertonic fixture preparation',()=>{
  let output;
  beforeEach(async()=>{output=await mkdtemp(join(tmpdir(),'inhouse-supertonic-fixtures-'));});
  afterEach(async()=>{await rm(output,{recursive:true,force:true});});
  const cached=async value=>{await mkdir(join(output,'onnx'));await writeFile(join(output,asset.path),value);};
  it('streams verified bytes and records immutable revision, sizes, hashes and URL',async()=>{
    const fetchFn=vi.fn(async()=>new Response(bytes));
    const manifest=await prepareSupertonicFixtures({output,assets:[asset],fetchFn});
    expect(fetchFn).toHaveBeenCalledTimes(1);expect(fetchFn.mock.calls[0][0]).toBe(SUPERTONIC_BASE+asset.path);
    expect(manifest).toMatchObject({revision:SUPERTONIC_REVISION,totalBytes:bytes.length,assets:{[asset.path]:{bytes:bytes.length,sha256:asset.sha256}}});
    expect(JSON.parse(await readFile(join(output,'fixtures-manifest.json'),'utf8'))).toEqual(manifest);
  });
  it('checks every cached byte and makes no request for a valid pack',async()=>{
    await cached(bytes);const fetchFn=vi.fn();
    await prepareSupertonicFixtures({output,assets:[asset],fetchFn,checkOnly:true});expect(fetchFn).not.toHaveBeenCalled();
  });
  it('fails missing real weights in check mode without silently downloading',async()=>{
    const fetchFn=vi.fn();await expect(prepareSupertonicFixtures({output,assets:[asset],fetchFn,checkOnly:true})).rejects.toThrow();expect(fetchFn).not.toHaveBeenCalled();
  });
  it('rejects equal-size corrupt cache and replaces it with verified bytes',async()=>{
    await cached(Buffer.alloc(bytes.length));const fetchFn=vi.fn(async()=>new Response(bytes));
    await prepareSupertonicFixtures({output,assets:[asset],fetchFn});expect(fetchFn).toHaveBeenCalledTimes(1);expect(await verifyAsset(join(output,asset.path),asset)).toEqual({bytes:bytes.length,sha256:asset.sha256});
  });
  it('does not accept partial download or leave a successful marker',async()=>{
    const fetchFn=vi.fn(async()=>new Response(bytes.subarray(1)));
    await expect(prepareSupertonicFixtures({output,assets:[asset],fetchFn})).rejects.toThrow('Cannot prepare');expect(fetchFn).toHaveBeenCalledTimes(3);
    await expect(readFile(join(output,'fixtures-manifest.json'))).rejects.toThrow();await expect(readFile(join(output,asset.path+'.part'))).rejects.toThrow();
  });
  it('rejects a moving upstream source before requesting bytes',async()=>{
    const fetchFn=vi.fn();await expect(prepareSupertonicFixtures({output,assets:[asset],fetchFn,base:SUPERTONIC_BASE.replace(SUPERTONIC_REVISION,'main')})).rejects.toThrow('pinned');expect(fetchFn).not.toHaveBeenCalled();
  });
  it('rejects unsafe asset paths instead of writing outside the fixture directory',async()=>{
    const fetchFn=vi.fn();await expect(prepareSupertonicFixtures({output,assets:[{...asset,path:'../escape.json'}],fetchFn})).rejects.toThrow('descriptor');expect(fetchFn).not.toHaveBeenCalled();
  });
  it('uses an individual pinned author source for a shared pack asset',async()=>{
    const url='https://huggingface.co/author/quantized-pack/resolve/'+ 'a'.repeat(40)+'/onnx/tts.json';
    const fetchFn=vi.fn(async()=>new Response(bytes));
    const manifest=await prepareSupertonicFixtures({output,assets:[{...asset,url}],fetchFn});
    expect(fetchFn.mock.calls[0][0]).toBe(url);expect(manifest.assets[asset.path].url).toBe(url);
  });
  it('rejects an individual asset source that points to a moving revision',async()=>{
    const fetchFn=vi.fn();
    await expect(prepareSupertonicFixtures({output,assets:[{...asset,url:'https://huggingface.co/author/model/resolve/main/onnx/tts.json'}],fetchFn})).rejects.toThrow('pinned HTTPS');expect(fetchFn).not.toHaveBeenCalled();
  });
});
