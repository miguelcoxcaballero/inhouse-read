// @vitest-environment node
import {expect,it} from 'vitest'
import {rustShelf} from './helpers/rust-shelf-ready.js'
it('chooses the initial model quality during a fall, then defers replacements until rest',()=>{
 const scene=new rustShelf.RustScene(600,1200,600,250,false,true,0);
 scene.beginEntries(0,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
 const input=new Float64Array(44);input.set([0,16,0,0,0,0,0,0,0,-50,0,20,0,10]);
 input.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],14);
 scene.projectEntry(input);expect(input[38]).toBe(1);expect(input[39]).toBe(1);
 input[4]=1;scene.projectEntry(input);expect(input[38]).toBe(0);
 input[1]=0;scene.projectEntry(input);expect(input[38]).toBe(1);expect(input[39]).toBe(1);scene.free();
});
