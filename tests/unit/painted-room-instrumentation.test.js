// @vitest-environment node
import {expect,it} from 'vitest';
import {paintedRoomProbe,paintedRoom} from '../e2e/helpers/painted-room-probe.mjs';
import {instrumentPaintedRoom} from '../e2e/helpers/painted-room-instrumentation.mjs';
it('captures the actual post-live pose before its matrix update using native frame coordinates',()=>{
 const source='const Nn={prepare(){},key(){return "book:drive:one"}},Me=[],r=[{left:4,bottom:70}],o=390,g=600,wr={bag:{width:60}},d="bag",N={shelf:0,pose:{position:{x:0,y:2,z:3},quaternion:{x:0,y:0,z:0,w:1},scale:{x:1},updateMatrix(){globalThis.calls.push("matrix")}}};Nn.prepare(Me,r,o,g/wr[d].width*1e3);N.localMotionPose=[Nn.key(0),0,999,999];N.pose.position.x=17;N.pose.updateMatrix();';
 const observed={calls:[],__captureRoomPaint(e,ppm,width,rows){this.calls.push('capture');this.capture={x:e.pose.position.x,checkpointX:e.localMotionPose[2],ppm,width,rows};}};
 new Function('globalThis',instrumentPaintedRoom(source))(observed);
 expect(observed.calls).toEqual(['capture','matrix']);expect(observed.capture).toEqual({x:17,checkpointX:999,ppm:10000,width:390,rows:[{left:4,bottom:70}]});
});
it('handles minified dollar identifiers and nested coordinate expressions without borrowing saved poses',()=>{
 const body='$f.prepare(es,rows,w,(u/(spec[t].width+fn(1,2)))*1e3);e$.localMotionPose=[$f.key(i),out[0]];e$.pose.updateMatrix();';
 expect(instrumentPaintedRoom(body)).toContain('globalThis.__captureRoomPaint(e$,((u/(spec[t].width+fn(1,2)))*1e3),(w),(rows))');
});
it('keeps legacy releases measurable and rejects missing or ambiguous instrumentation',()=>{
 const legacy='const bay=rs[e.shelf||0];e.localMotionPose=[key,e.shelf||0,(p.x+w/2-(bay.left||0))/ppm,0];e.pose.updateMatrix();';
 expect(instrumentPaintedRoom(legacy)).toContain('__captureRoomPaint(e,(ppm),(w),(rs))');
 expect(()=>instrumentPaintedRoom('const untouched=1;')).toThrow('exactly one');
 expect(()=>instrumentPaintedRoom('e.localMotionPose=[f.key(i)];e.pose.updateMatrix();')).toThrow('preparation');
 expect(()=>instrumentPaintedRoom('f.prepare(e,r,w,p);e.localMotionPose=[f.key(i)];')).toThrow('matrix update');
 expect(()=>instrumentPaintedRoom('f.prepare(e,r,w,p);e.localMotionPose=[f.key(i)];e.localMotionPose=[f.key(i)];')).toThrow('ambiguous');
});
it('reads actual position and quaternion while explicitly rejecting an empty capture',async()=>{
 const keys=['__paintedRoom','__roomPaintCaptureCount','__captureRoomPaint'],saved=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 const page={addInitScript:async callback=>callback(),route:async()=>{},evaluate:async callback=>callback()};
 try{
  await paintedRoomProbe(page);await expect(paintedRoom(page)).rejects.toThrow('no real scene pose was captured');
  globalThis.__captureRoomPaint({shelf:0,localMotionPose:['book:drive:one',0,999,999],pose:{position:{x:12,y:-60,z:4},quaternion:{x:.1,y:.2,z:.3,w:.4},scale:{x:1}}},100,390,[{left:7,bottom:70}]);
  expect(await paintedRoom(page)).toEqual({'book:drive:one':{local:['book:drive:one',0,999,999],paint:[0,2,.1,.04,.1,.2,.3,.4,1]}});
 }finally{keys.forEach((key,i)=>{if(saved[i])Object.defineProperty(globalThis,key,saved[i]);else delete globalThis[key];});}
});
