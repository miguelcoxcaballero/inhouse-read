// Frozen JavaScript originals of the shelf scene's room set-up recipes that moved to
// rust-ui/src/scene_room.rs (bookshelf-scene.js before the move). The closure's variables are
// parameters here; the bodies are unchanged. tests/unit/scene-room-wasm.test.js runs each against
// its Rust port on equal inputs.
import * as THREE from 'three';

export function roomMaterials(texture, grain, widePenumbra, furniture) {
  const wood = new THREE.MeshPhysicalMaterial({ map:texture, bumpMap:grain, bumpScale:.55, roughnessMap:grain,
    vertexColors:true, color:'#ffffff', roughness:.9, clearcoat:.32, clearcoatRoughness:.36 });
  const backWood = widePenumbra(new THREE.MeshStandardMaterial({ map:texture, bumpMap:grain, bumpScale:.4, roughnessMap:grain,
    vertexColors:true, color:'#e6dccf', roughness:1.2, envMapIntensity:.7 }));
  const darkWood = new THREE.MeshPhysicalMaterial({ map:texture, bumpMap:grain, bumpScale:.5, roughnessMap:grain,
    vertexColors:true, color:'#f2e6d6', roughness:.95, clearcoat:.26, clearcoatRoughness:.4 });
  const floorMaterial = new THREE.MeshStandardMaterial({ map:texture, color:'#b3a68d', roughness:.94 });
  const occlusionMaterial = new THREE.MeshBasicMaterial({ vertexColors:true, transparent:true, depthWrite:false,
    side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-2 });
  const depthOnly = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]
    .map(side => new THREE.MeshBasicMaterial({ side, colorWrite:false }));
  const occlusion = new THREE.Mesh(new THREE.BufferGeometry(), occlusionMaterial);
  occlusion.name = 'Cabinet occlusion'; occlusion.raycast = () => {};
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), floorMaterial);
  floor.name = 'Library floor'; floor.userData.floor = true; floor.receiveShadow = true;
  floor.visible = false;
  furniture.add(floor, occlusion);
  const roomWallMaterial = new THREE.MeshStandardMaterial({ color:'#f0f1ed', roughness:1, envMapIntensity:.7 });
  const roomWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomWallMaterial);
  roomWall.name = 'Library room wall'; roomWall.userData.roomReceiver = true;
  roomWall.receiveShadow = true; roomWall.raycast = () => {};
  furniture.add(roomWall);
  return [wood, backWood, darkWood, occlusionMaterial, depthOnly, occlusion, floor, roomWallMaterial, roomWall];
}

export function dropMarker(furniture, depthOnly) {
  const dropMarker = new THREE.Group();
  dropMarker.name = 'Shelf placement guide'; dropMarker.userData.dropMarker = true; dropMarker.visible = false;
  const dropMaterial = new THREE.MeshBasicMaterial({ color:'#709980', transparent:true, opacity:.9, depthTest:false, depthWrite:false });
  const dropGuide = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), dropMaterial);
  const dropFoot = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 4), dropMaterial); dropFoot.position.y = 1;
  dropMarker.add(dropGuide, dropFoot); furniture.add(dropMarker);
  const depthWriters = depthOnly.map(material => new THREE.Mesh(dropGuide.geometry, material));
  return [dropMarker, dropGuide, depthWriters];
}

export function nativeRoomClip(stage) {
  const nativeRoomClip = document.createElement('div');
  nativeRoomClip.className = 'ihr-bookshelf-native-room-clip'; nativeRoomClip.setAttribute('aria-hidden','true');
  Object.assign(nativeRoomClip.style,{position:'absolute',overflow:'hidden',pointerEvents:'none',zIndex:'0',display:'none'});
  stage.append(nativeRoomClip);
  return nativeRoomClip;
}

export function nativeRoomExport(rawContext, canvas, source, nativeBaseFrame, nativeBaseMargin) {
  const renderer = { domElement:source };
  rawContext.clearRect(0,0,canvas.width,canvas.height);
  if (nativeBaseFrame.physical && !nativeBaseMargin) {
    rawContext.drawImage(renderer.domElement,0,0,canvas.width,canvas.height);
  } else if (nativeBaseFrame.physical) {
    const tile=document.createElement('canvas');
    tile.width=Math.ceil(nativeBaseFrame.width*nativeBaseFrame.ratio);tile.height=Math.ceil(nativeBaseFrame.height*nativeBaseFrame.ratio);
    try {
      const tileContext=tile.getContext('2d');
      if(!tileContext)throw new Error('Native room crop export requires a 2D context');
      tileContext.drawImage(renderer.domElement,0,0,tile.width,tile.height);
      rawContext.drawImage(tile,nativeBaseMargin*nativeBaseFrame.ratio,nativeBaseMargin*nativeBaseFrame.ratio,
        canvas.width,canvas.height,0,0,canvas.width,canvas.height);
    } finally { tile.width=tile.height=0; }
  } else {
    rawContext.drawImage(renderer.domElement,nativeBaseMargin*nativeBaseFrame.ratio,nativeBaseMargin*nativeBaseFrame.ratio,
      canvas.width,canvas.height,0,0,canvas.width,canvas.height);
  }
}

export function insertionExport(rawContext, overlay, source, nativeFrame) {
  const renderer = { domElement:source }, insertion = { nativeFrame };
  rawContext.clearRect(0,0,overlay.width,overlay.height);
  rawContext.drawImage(renderer.domElement,insertion.nativeFrame.x*insertion.nativeFrame.ratio,
    insertion.nativeFrame.y*insertion.nativeFrame.ratio);
}

export function roomOcclusion({ occlusion, shelfType, plan, unitCount, unitWidth, height, depth, floorY, rows, floorLit, trash, darkFloorLight,
  createShelfOcclusion, mergeGeometries }) {
  occlusion.visible = shelfType !== 'baggebo';
  if (shelfType === 'baggebo') { occlusion.geometry = new THREE.BufferGeometry(); return; }
  const unitScale = plan[0], parts = [];
  for (let index = 0; index < unitCount; index++) {
    const x = plan[10 + index], last = index === unitCount - 1;
    const geometry = createShelfOcclusion({ width:unitWidth, height, depth, scale:unitScale, floorY,
      rows:rows.filter(row => (row.unit ?? 0) === index), floorLight:floorLit && last ? darkFloorLight : null,
      footprints:trash && last ? [{ x:trash.position.x - x, z:trash.position.z, radius:trash.userData.radius }] : [] });
    geometry.translate(x, 0, 0); parts.push(geometry);
  }
  occlusion.geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (parts.length > 1) for (const part of parts) part.dispose();
}

export function roomFloor(floor, roomWall, room) {
  floor.geometry.dispose();
  floor.geometry = new THREE.BoxGeometry(room[2], 2, room[3]);
  floor.geometry.computeBoundingBox();
  floor.position.set(room[4], room[5], room[6]);
  roomWall.scale.set(room[7], room[7], 1);
  roomWall.position.set(0, room[8], room[9]);
}

export function moveStage(stage, next, originalHeight, originalTop, alreadyScene, originalStyles, semanticCovers, restoreButtons,
  [canvas, inspectionCanvas, inspectionOverviewCanvas, nativeRoomClip]) {
  stage.style.height = originalHeight;
  stage.style.top = originalTop;
  if (!alreadyScene) stage.classList.remove('has-scene');
  restoreButtons(originalStyles, semanticCovers);
  originalStyles.clear();
  stage = next;
  originalHeight = stage.style.height;
  originalTop = stage.style.top;
  alreadyScene = stage.classList.contains('has-scene');
  stage.classList.add('has-scene');
  stage.prepend(canvas);
  stage.append(inspectionCanvas);
  stage.append(inspectionOverviewCanvas);
  if(nativeRoomClip)stage.append(nativeRoomClip);
  return [originalHeight, originalTop, alreadyScene];
}

export function releaseStage(stage, originalHeight, alreadyScene, originalStyles, restoreButtons, [canvas, inspectionCanvas, inspectionOverviewCanvas]) {
  canvas.remove(); inspectionCanvas.remove(); inspectionCanvas.width = inspectionCanvas.height = 1;
  inspectionOverviewCanvas.remove(); inspectionOverviewCanvas.width = inspectionOverviewCanvas.height = 1;
  stage.style.height = originalHeight;
  if (!alreadyScene) stage.classList.remove('has-scene');
  restoreButtons(originalStyles, undefined);
}

export function trashDropRecord(resolve, now, reduced, duration, model, trash) {
  const reducedMotion = { matches:reduced }, entry = { model };
  return { resolve, settled:false, complete:false, started:now, lastFrame:now, elapsed:0,
    duration:reducedMotion.matches ? 0 : Math.max(0, Number(duration) || 0),
    start:entry.model.position.clone(), startScale:entry.model.scale.x,
    startQuaternion:entry.model.quaternion.clone(), endQuaternion:new THREE.Quaternion(),
    bookQuaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(-.22, .18, -.46)),
    initialOpenness:Number(trash.userData.openness) || 0 };
}
