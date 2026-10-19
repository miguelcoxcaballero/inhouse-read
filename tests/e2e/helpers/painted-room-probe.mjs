import {instrumentPaintedRoom} from './painted-room-instrumentation.mjs';
// Observe the actual transforms consumed by rendering, not the saved checkpoint.
// Test-only response instrumentation leaves the deployed bundle untouched.
export async function paintedRoomProbe(page){
 await page.addInitScript(()=>{globalThis.__paintedRoom={};globalThis.__roomPaintCaptureCount=0;globalThis.__captureRoomPaint=(e,ppm,width,rows)=>{
  globalThis.__roomPaintCaptureCount++;
  const row=rows[e.shelf||0];if(!row||!e.localMotionPose)return;
  const p=e.pose.position,q=e.pose.quaternion;
  __paintedRoom[e.localMotionPose[0]]={local:e.localMotionPose.slice(),paint:[e.shelf||0,(p.x+width/2-(row.left||0))/ppm,(p.y+(row.bottom||0))/ppm,p.z/ppm,q.x,q.y,q.z,q.w,e.pose.scale.x]};
 }});
 await page.route(/\/assets\/main-[^/]+\.js$/,async route=>{
  const response=await route.fetch();let body=await response.text();
  body=instrumentPaintedRoom(body);
  await route.fulfill({response,body});
 });
}
export const paintedRoom=page=>page.evaluate(()=>{
 if(!globalThis.__roomPaintCaptureCount)throw Error('Painted room probe: no real scene pose was captured');
 return globalThis.__paintedRoom;
});
