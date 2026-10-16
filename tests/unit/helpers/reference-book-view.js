// Frozen verbatim from src/js/book-model.js at 67e091dc2245d7655c82df310ada7f6624ec0c11
// (1.7.245), before the view arithmetic moved to rust-core/src/book_view.rs. The closure
// variables of bookView become the fields of `state`; the only change is that the screen
// bounds the original measured with Three (`measure`) are supplied by the caller, so both
// sides can be fed the same measurement or the same objects.
import * as THREE from 'three';

export function referenceFitCoverImage(imageWidth, imageHeight, width, height) {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const w = imageWidth * scale, h = imageHeight * scale;
  return { x:(width - w) / 2, y:(height - h) / 2, width:w, height:h };
}

export function referenceProjectBookPageBounds(page, camera, viewportWidth, viewportHeight, offset = { left:0, top:0 }) {
  if (!page?.visible || !page.geometry?.parameters) return null;
  page.updateWorldMatrix(true, false); camera.updateMatrixWorld();
  const { width, height } = page.geometry.parameters;
  const points = [[-width / 2, -height / 2], [width / 2, -height / 2],
    [-width / 2, height / 2], [width / 2, height / 2]].map(([x, y]) => {
    const projected = new THREE.Vector3(x, y, 0).applyMatrix4(page.matrixWorld).project(camera);
    return { x:(projected.x + 1) * viewportWidth / 2 + offset.left,
      y:(1 - projected.y) * viewportHeight / 2 + offset.top };
  });
  const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y));
  return { left, top, width:Math.max(...points.map(point => point.x)) - left,
    height:Math.max(...points.map(point => point.y)) - top };
}

export function referencePlanBookPageZoom(model, camera, {
  viewportWidth, viewportHeight, centerX, centerY, origin,
  offset = { left:0, top:0 }, target
}) {
  const rotation = model.rotation.clone();
  let bounds;
  try {
    model.rotation.set(0, 0, 0);
    bounds = referenceProjectBookPageBounds(model.userData.pageSurface, camera, viewportWidth, viewportHeight, offset);
  } finally {
    model.rotation.copy(rotation); model.updateMatrixWorld(true);
  }
  if (!bounds || !(bounds.width > 0 && bounds.height > 0 && target?.width > 0 && target?.height > 0)) return null;
  const factor = Math.min(target.width / bounds.width, target.height / bounds.height);
  const imageX = bounds.left + bounds.width / 2, imageY = bounds.top + bounds.height / 2;
  const modelX = offset.left + centerX + origin.x, modelY = offset.top + centerY + origin.y;
  return { ...origin,
    x:origin.x + target.left + target.width / 2 - imageX + (1 - factor) * (imageX - modelX),
    y:origin.y + target.top + target.height / 2 - imageY + (1 - factor) * (imageY - modelY),
    scale:origin.scale * factor, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:1 };
}

export function referencePlanReadingBookPose({ width, height, thickness = 0,
  viewportWidth, viewportHeight, centerX, centerY }) {
  const scale = Math.min(1,viewportWidth*.86/(width*2+thickness*.8),viewportHeight*.66/height);
  return { x:viewportWidth/2-centerX+width*scale/2, y:viewportHeight*.44-centerY,
    scale, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:0 };
}

export function referenceProjectBookBoardBounds(model,camera,viewportWidth,viewportHeight) {
  const points=[];
  model.updateWorldMatrix(true,true); camera.updateMatrixWorld();
  for (const name of ['front-cover','back-cover','binding']) {
    const mesh=model.getObjectByName(name);
    if (!mesh?.geometry) continue;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const {min,max}=mesh.geometry.boundingBox;
    for (const x of [min.x,max.x]) for (const y of [min.y,max.y]) for (const z of [min.z,max.z]) {
      const point=new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld).project(camera);
      points.push({x:(point.x+1)*viewportWidth/2,y:(1-point.y)*viewportHeight/2});
    }
  }
  const left=Math.min(...points.map(point=>point.x)),top=Math.min(...points.map(point=>point.y));
  return {left,top,width:Math.max(...points.map(point=>point.x))-left,height:Math.max(...points.map(point=>point.y))-top};
}

/** The sizes bookView derived at creation. */
export function referenceViewSizes({ shelf, devicePixelRatio, innerWidth, viewportWidth, viewportHeight, width, height, thickness }) {
  const requestedPixelRatio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const pixelRatio = shelf
    ? Math.min(requestedPixelRatio, innerWidth < 600 ? 1.5 : 2)
    : Math.min(requestedPixelRatio, 2);
  return { pixelRatio, canvasWidth:Math.ceil(viewportWidth * pixelRatio), canvasHeight:Math.ceil(viewportHeight * pixelRatio),
    compactWidth:Math.min(viewportWidth, Math.ceil(((width * 2 + thickness) * 1.25 + 64) / 64) * 64),
    closedCompactWidth:Math.min(viewportWidth, Math.ceil(((width + thickness) * 1.25 + 64) / 64) * 64),
    compactHeight:Math.min(viewportHeight, Math.ceil((height * 1.45 + 64) / 64) * 64) };
}

/** Bookview's closure: `state` holds compactReturnFrame, directEnabled, adaptiveNativeFrame, pixelRatio,
 * viewportWidth, viewportHeight, compactWidth, closedCompactWidth, compactHeight, current,
 * motionFrameCapacity, nativeMotionCapacity, canvas ({width, height}), centerX, centerY, pageTheme. It is
 * read and written like the closure's variables were. `measure(adaptive)` is what Three measured. */
export function referenceBookView(state, measure) {
  const camera = { isFull:true }, compactCamera = { copy() {}, setViewOffset(...view) { compactCamera.view = view; } };
  function copyRectangle(frame, pose) {
    const { viewportWidth, viewportHeight, pixelRatio, canvas } = state;
    const full = { x:0, y:0, width:canvas.width, height:canvas.height, full:true };
    if (![viewportWidth * pixelRatio, viewportHeight * pixelRatio,
      frame.x * pixelRatio, frame.y * pixelRatio, frame.width * pixelRatio,
      frame.height * pixelRatio].every(Number.isInteger)) return full;
    const [left, top, right, bottom] = measure(false);
    if (![left,top,right,bottom].every(Number.isFinite)) return full;
    const margin=Math.max(8,48*Math.abs(pose.scale));
    const x=Math.max(0,frame.x*pixelRatio,Math.floor((left-margin)*pixelRatio));
    const y=Math.max(0,frame.y*pixelRatio,Math.floor((top-margin)*pixelRatio));
    const endX=Math.min(canvas.width,(frame.x+frame.width)*pixelRatio,Math.ceil((right+margin)*pixelRatio));
    const endY=Math.min(canvas.height,(frame.y+frame.height)*pixelRatio,Math.ceil((bottom+margin)*pixelRatio));
    return { x,y,width:Math.max(0,endX-x),height:Math.max(0,endY-y) };
  }
  function returnFrame(pose, measureOnly = false) {
    const { compactReturnFrame, directEnabled, adaptiveNativeFrame, pixelRatio, viewportWidth, viewportHeight,
      compactWidth, closedCompactWidth, compactHeight, current } = state;
    const full = { x:0, y:0, width:viewportWidth, height:viewportHeight, camera };
    if (!compactReturnFrame || (pose.scale > 1.05 && !directEnabled) || !Number.isInteger(pixelRatio)
      || !Number.isInteger(viewportWidth) || !Number.isInteger(viewportHeight)) return full;
    let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
    const adaptive = adaptiveNativeFrame && directEnabled;
    [left,top,right,bottom] = measure(adaptive);
    if (![left,top,right,bottom].every(Number.isFinite)) return full;
    left=Math.max(0,left); top=Math.max(0,top); right=Math.min(viewportWidth,right); bottom=Math.min(viewportHeight,bottom);
    let frameWidth = adaptive ? Math.min(viewportWidth,Math.ceil((right-left+48)/64)*64)
      : current.coverOpen === 0 ? closedCompactWidth : compactWidth;
    let frameHeight = adaptive ? Math.min(viewportHeight,Math.ceil((bottom-top+48)/64)*64) : compactHeight;
    if (adaptive && state.motionFrameCapacity && !measureOnly) {
      state.motionFrameCapacity.width = frameWidth = Math.max(frameWidth, state.motionFrameCapacity.width);
      state.motionFrameCapacity.height = frameHeight = Math.max(frameHeight, state.motionFrameCapacity.height);
    }
    if (adaptive && state.nativeMotionCapacity) {
      frameWidth = Math.max(frameWidth, state.nativeMotionCapacity.width);
      frameHeight = Math.max(frameHeight, state.nativeMotionCapacity.height);
      if (!measureOnly) {
        state.nativeMotionCapacity.width = frameWidth;
        state.nativeMotionCapacity.height = frameHeight;
      }
    }
    if (adaptive && frameWidth===viewportWidth && frameHeight===viewportHeight) return full;
    if (right<left || bottom<top
      || frameWidth<viewportWidth && right-left+48>frameWidth
      || frameHeight<viewportHeight && bottom-top+48>frameHeight) return full;
    const x=frameWidth===viewportWidth ? 0 : Math.round((left+right-frameWidth)/2);
    const y=frameHeight===viewportHeight ? 0 : Math.round((top+bottom-frameHeight)/2);
    if (measureOnly) return { x,y,width:frameWidth,height:frameHeight };
    compactCamera.copy(camera);
    compactCamera.setViewOffset(viewportWidth,viewportHeight,x,y,frameWidth,frameHeight);
    return { x,y,width:frameWidth,height:frameHeight,camera:compactCamera };
  }
  /** What positionModel put on the model (and the clamped opening and withdrawal it passed on). */
  function positionModel(pose) {
    const { current, centerX, centerY, viewportWidth, viewportHeight } = state;
    const opening = Math.max(0, Math.min(1, pose.coverOpen ?? current?.coverOpen ?? 0));
    const withdrawal = Math.max(0, Math.min(1, pose.bookmarkWithdraw ?? current?.bookmarkWithdraw ?? 0));
    return { opening, withdrawal,
      position:[centerX - viewportWidth / 2 + pose.x, viewportHeight / 2 - centerY - pose.y, 0],
      rotation:[(pose.pitch ?? 0) * Math.PI / 180, pose.angle * Math.PI / 180, (pose.roll ?? 0) * Math.PI / 180],
      scale:pose.scale };
  }
  /** draw()'s normalisation of the pose it was given. */
  function drawPose(pose) {
    const { current } = state;
    if (pose.pageTheme != null) state.pageTheme = Math.max(0, Math.min(1, Number(pose.pageTheme) || 0));
    state.current = { ...pose, coverOpen:Math.max(0, Math.min(1, pose.coverOpen ?? current?.coverOpen ?? 0)),
      bookmarkWithdraw:Math.max(0, Math.min(1, pose.bookmarkWithdraw ?? current?.bookmarkWithdraw ?? 0)), pageTheme:state.pageTheme };
    return { current:state.current, placed:positionModel(state.current) };
  }
  return { copyRectangle, returnFrame, positionModel, drawPose };
}
