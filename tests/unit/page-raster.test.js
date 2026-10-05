import {describe,it,expect} from 'vitest';
import {registerPageRaster,pageRaster} from '../../src/js/page-raster.js';
describe('settled PDF copies',()=>{
 it('recognizes only registered copies with the same actual dimensions',()=>{
  const source={width:400,height:600},revision={};
  expect(pageRaster(source)).toBeNull();registerPageRaster(source,revision);
  expect(pageRaster(source)).toBe(revision);source.width=800;expect(pageRaster(source)).toBeNull();
 });
 it('allows two fresh copies of one settled raster without retaining either',()=>{
  const first={width:400,height:600},second={width:400,height:600},revision={};
  registerPageRaster(first,revision);registerPageRaster(second,revision);
  expect(pageRaster(first)).toBe(pageRaster(second));
 });
 it('does not treat tone keys, locators or invalid dimensions as pixel identity',()=>{
  expect(pageRaster({width:400,height:600,toneKey:{}})).toBeNull();
  for(const source of [{width:0,height:600},{width:400,height:0}]){registerPageRaster(source,{});expect(pageRaster(source)).toBeNull();}
 });
});
