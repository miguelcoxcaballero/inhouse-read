// Observe the actual transforms consumed by rendering, not the saved checkpoint.
// Test-only response instrumentation leaves the deployed bundle untouched.
export async function paintedRoomProbe(page){
 await page.addInitScript(()=>{globalThis.__paintedRoom={};globalThis.__captureRoomPaint=(e,ppm,width,rows)=>{
  const row=rows[e.shelf||0];if(!row||!e.localMotionPose)return;
  const p=e.pose.position,q=e.pose.quaternion;
  __paintedRoom[e.localMotionPose[0]]={local:e.localMotionPose.slice(),paint:[e.shelf||0,(p.x+width/2-(row.left||0))/ppm,(p.y+(row.bottom||0))/ppm,p.z/ppm,q.x,q.y,q.z,q.w,e.pose.scale.x]};
 }});
 await page.route(/\/assets\/main-[^/]+\.js$/,async route=>{
  const response=await route.fetch();let body=await response.text();
  const match=body.match(/(\w+)\.localMotionPose=\[\w+,\w+\.shelf\|\|0,\(\w+\.x\+(\w+)\/2-\(\w+\.left\|\|0\)\)\/(\w+)/);
  if(match){const [_,entry,width,ppm]=match;const before=body.slice(Math.max(0,match.index-180),match.index);const rows=before.match(/(\w+)\[\w+\.shelf\|\|0\]/)?.[1];if(!rows)throw Error('Missing room rows');body=body.replace(`${entry}.pose.updateMatrix()`,`(globalThis.__captureRoomPaint(${entry},${ppm},${width},${rows}),${entry}.pose.updateMatrix())`)}
  await route.fulfill({response,body});
 });
}
export const paintedRoom=page=>page.evaluate(()=>globalThis.__paintedRoom);
