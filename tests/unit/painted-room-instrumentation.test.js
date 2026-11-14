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
it('captures on every frame before the natively taken matrix is copied in, changed or not',()=>{
 const run=changed=>{
  const source='const f={prepare(){},key(){return "k"}},N={shelf:0,pose:{position:{x:0},matrix:{fromArray(){globalThis.calls.push("copy")}}}},P=N.pose,c='+changed+',X=1,l=[];f.prepare([],[{left:4}],390,1e4);X&1&&(N.localMotionPose=[f.key(0),0,999]),X&2&&(N.pose.position.x=17),c&2&&(P.matrix.fromArray(l,26),P.matrixWorldNeedsUpdate=!0);';
  const observed={calls:[],__captureRoomPaint(e,ppm,width){this.calls.push('capture:'+e.pose.position.x+':'+ppm+':'+width);}};
  new Function('globalThis',instrumentPaintedRoom(source))(observed);return observed.calls;
 };
 expect(run(2)).toEqual(['capture:0:10000:390','copy']);expect(run(0)).toEqual(['capture:0:10000:390']);
});
it('captures the arena pose with the key the motion frame registered for its index, on every frame',()=>{
 // The shape of the published loop: no per-entry pose record, only the copy of the natively taken matrix.
 const run=changed=>{
  const source='const X$={prepare(){},key(i){return ["book:drive:one","lamp:a",void 0][i]}},E_={prepare(){}},ge=[0,1,2].map(i=>({shelf:i%2,pose:{position:{x:i},matrix:{fromArray(){globalThis.calls.push("copy:"+i)}}}})),r=[{left:4},{left:9}],o=390,y=600,T=74,It=[],ke=[];'
   +'E_.prepare(ge),X$.prepare(ge,r,o,y/60*1e3);for(let oe=0;oe<ge.length;oe++){const D=ge[oe],be=D.node,We=D.pose;const me=oe*T,Ft='+changed+';Ft&1&&(We.position.x=17+oe),Ft&2&&(We.matrix.fromArray(ke,me+26),We.matrixWorldNeedsUpdate=!0);}';
  const observed={calls:[],__captureRoomPaint(e,ppm,width,rows,key){this.calls.push([key,e.pose.position.x,e.shelf,ppm,width,rows.length].join('|'));}};
  new Function('globalThis',instrumentPaintedRoom(source))(observed);return observed.calls;
 };
 expect(run(3)).toEqual(['book:drive:one|17|0|10000|390|2','copy:0','lamp:a|18|1|10000|390|2','copy:1','|19|0|10000|390|2','copy:2']);
 expect(run(0)).toEqual(['book:drive:one|0|0|10000|390|2','lamp:a|1|1|10000|390|2','|2|0|10000|390|2']);
 const copy='c&2&&(P.matrix.fromArray(l,a+26),0);';
 expect(()=>instrumentPaintedRoom('f.prepare(e,r,w,p);const P=N.pose,a=i*8;'+copy+copy)).toThrow('ambiguous native matrix copy');
 expect(()=>instrumentPaintedRoom('f.prepare(e,r,w,p);const a=i*8;'+copy)).toThrow('owner of the native pose');
 expect(()=>instrumentPaintedRoom('f.prepare(e,r,w,p);const P=N.pose;'+copy)).toThrow('entry index');
 expect(()=>instrumentPaintedRoom('f.prepare(e);const P=N.pose,a=i*8;'+copy)).toThrow('motion-frame preparation');
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
