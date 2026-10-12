// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
const hooks=vi.hoisted(()=>[]);
vi.mock('@playwright/test',()=>({test:{beforeEach:hook=>hooks.push(hook)}}));
import {installEmptyUpdateChannels} from '../e2e/helpers/empty-update-channels.mjs';
afterEach(()=>{hooks.length=0;});
it('registers a separate hook for every test file even though the helper module is cached',async()=>{
 expect(hooks).toHaveLength(0);installEmptyUpdateChannels();installEmptyUpdateChannels();expect(hooks).toHaveLength(2);
 for(const hook of hooks){
  const route=vi.fn();await hook({page:{route}});expect(route).toHaveBeenCalledOnce();const [pattern,handle]=route.mock.calls[0];
  for(const host of ['raw.githubusercontent.com/user/app/main','api.github.com/repos/user/app/contents'])for(const channel of ['A','B']){
   const url=`https://${host}/updates/${channel}.json?ref=main&check=123`;expect(pattern.test(url)).toBe(true);
   const fulfill=vi.fn();await handle({request:()=>({url:()=>url}),fulfill});const response=JSON.parse(fulfill.mock.calls[0][0].body);
   const value=response.content?JSON.parse(Buffer.from(response.content,'base64').toString()):response;
   expect(value).toEqual({schemaVersion:1,channel,latest:null,releases:[]});
  }
 }
});
it('makes every consuming spec install its own empty catalog hook explicitly',()=>{
 const specs=readdirSync('tests/e2e').filter(name=>name.endsWith('.spec.mjs'));
 const consumers=specs.map(name=>readFileSync('tests/e2e/'+name,'utf8')).filter(source=>source.includes("'./helpers/empty-update-channels.mjs'"));
 expect(consumers.length).toBeGreaterThanOrEqual(5);
 for(const source of consumers){expect(source).toContain('installEmptyUpdateChannels()');expect(source).not.toContain("import './helpers/empty-update-channels.mjs'");}
});
