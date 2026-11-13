// Frozen: the entry stage of bookshelf-scene.js's updateEntries as it stood before the entries'
// state moved into the entry arena (1.7.326). The lift, the landing, the preview, the reorder
// offset and the pose live on the host's entry objects; every frame they are marshalled into the
// solver's arena (reference-gravity-frame.js) or a 40-number step packet, read back, composed
// by three and written into the entry frame's input for `step`.
// tests/unit/scene-entry-state-wasm.test.js holds the arena path (src/js/scene-entry-frame.js)
// to these bits.
import { ENTRY_OUTPUT } from '../../../src/js/scene-entry-frame.js';
const ENTRY_INPUT = 22;
export function createMarshalFrame({ gravityFrame, entryFrame, motionFrame }) {
  const stepIo = new Float64Array(40);
  let stepBatch = new Float64Array(0), stepBatchViews = [];
  return function frame(bookEntries, { usePhysics, bookGravity, sceneView, roomMotion, roomTransition, now, reduced, arranging, rows, width, pixelsPerMetre, room, leanOf }) {
    let moving = false, shelfMoving = false, previewing = false, previewed = 0, gravityOutput = null;
    if (usePhysics) {
      gravityFrame.prepare(bookEntries); gravityOutput = gravityFrame.output;
      for (let index = 0; index < bookEntries.length; index++) {
        const entry = bookEntries[index];
        const plant = entry.kind === 'plant', lamp = entry.kind === 'lamp', undershelf = lamp && entry.mount === 'undershelf';
        const kind = plant ? 1 : lamp ? 2 : 0;
        const row = rows[entry.shelf || 0] || rows[0] || {};
        gravityFrame.write(index, entry, kind, undershelf, row, pixelsPerMetre, width);
      }
      gravityFrame.advance(bookGravity, sceneView, now, reduced);
      gravityOutput = gravityFrame.output;
    }
    if (!usePhysics && stepBatchViews.length !== bookEntries.length) {
      stepBatch = new Float64Array(bookEntries.length * 40);
      stepBatchViews = Array.from({ length:bookEntries.length }, (_, index) => stepBatch.subarray(index * 40, (index + 1) * 40));
    }
    if (!usePhysics && bookEntries.length) {
      for (let index = 0; index < bookEntries.length; index++) {
        const entry = bookEntries[index], io = stepBatchViews[index];
        const plant = entry.kind === 'plant', lamp = entry.kind === 'lamp', undershelf = lamp && entry.mount === 'undershelf';
        const lift = entry.lift, landing = entry.landing, preview = entry.preview;
        io[0] = plant ? 1 : lamp ? 2 : 0; io[1] = undershelf ? 1 : 0; io[2] = entry.bits;
        io[3] = entry.dragNumberX; io[4] = entry.dragNumberY;
        io[5] = lift.value; io[6] = lift.from; io[7] = lift.target; io[8] = lift.started;
        io[9] = landing ? 1 : 0;
        if (landing) { io[10] = landing.from; io[11] = landing.started; io[12] = landing.duration; }
        io[13] = preview.x; io[14] = preview.y; io[15] = preview.fromX; io[16] = preview.fromY;
        io[17] = preview.targetX; io[18] = preview.targetY; io[19] = preview.started; io[20] = preview.active ? 1 : 0;
        io[21] = entry.offset.x; io[22] = entry.offset.y;
        io[23] = entry.x; io[24] = entry.y; io[25] = entry.width; io[26] = entry.height; io[27] = entry.depth; io[28] = entry.depthInset;
      }
      sceneView.stepEntries(stepBatch);
    }
    entryFrame.prepare(bookEntries.length);
    for (let entryIndex = 0; entryIndex < bookEntries.length; entryIndex++) {
      const entry = bookEntries[entryIndex];
      const plant = entry.kind === 'plant', lamp = entry.kind === 'lamp';
      const decorative = plant || lamp;
      const away = Boolean(entry.bits & 1);
      const kind = plant ? 1 : lamp ? 2 : 0, lift = entry.lift, preview = entry.preview;
      const io = usePhysics ? stepIo : stepBatchViews[entryIndex];
      if (usePhysics) gravityFrame.copyState(entryIndex, io);
      lift.value = io[5]; lift.from = io[6]; lift.target = io[7]; lift.started = io[8];
      if (!io[9]) entry.landing = null;
      preview.x = io[13]; preview.y = io[14]; preview.active = io[20] !== 0;
      const motion = io[36];
      moving ||= preview.active;
      previewing ||= preview.active;
      if (motion & 4) previewed++;
      shelfMoving ||= !away && (Boolean(motion & 1) || preview.active);
      const insertion = entry.insertion, trashDrop = entry.trashDrop;
      moving ||= Boolean(motion & 8);
      shelfMoving ||= !away && Boolean(motion & 24);
      const pose = entry.pose;
      pose.position.set(io[29], io[30], io[31]);
      const gravityAt = entryIndex * 4;
      if (usePhysics && !decorative) leanOf(entry, gravityOutput[gravityAt]);
      if (usePhysics && !decorative) pose.rotation.set(io[32], io[33], io[34], io[37] ? 'ZYX' : 'XYZ');
      else pose.rotation.set(io[32], io[33], io[34]);
      moving ||= usePhysics && Boolean(io[38]);
      shelfMoving ||= usePhysics && Boolean(io[38]);
      pose.scale.setScalar(io[35]);
      entryFrame.refresh();
      const input = entryFrame.input, at = entryIndex * ENTRY_INPUT, p = pose.position, q = pose.quaternion;
      input[at] = p.x; input[at + 1] = p.y; input[at + 2] = p.z;
      input[at + 3] = q.x; input[at + 4] = q.y; input[at + 5] = q.z; input[at + 6] = q.w; input[at + 7] = pose.scale.x;
      input[at + 8] = kind; input[at + 9] = usePhysics ? io[39] : entry.bits;
      input[at + 10] = trashDrop ? 1 : 0; input[at + 11] = insertion ? 1 : 0; input[at + 12] = entry.model ? 1 : 0;
      input[at + 13] = entry.overview ? 1 : 0; input[at + 14] = trashDrop?.complete ? 1 : 0; input[at + 15] = insertion?.overlayCanvas ? 1 : 0;
      input.set(entry.box, at + 16);
    }
    entryFrame.step(motionFrame.native, sceneView, roomMotion, roomTransition, now, arranging, room);
    for (let entryIndex = 0; entryIndex < bookEntries.length; entryIndex++) {
      const entry = bookEntries[entryIndex], pose = entry.pose;
      entryFrame.refresh();
      const live = entryFrame.output, at = entryIndex * ENTRY_OUTPUT, liveFlags = live[at];
      if (liveFlags & 2) {
        pose.position.set(live[at+10],live[at+11],live[at+12]);
        pose.quaternion.set(live[at+13],live[at+14],live[at+15],live[at+16]);pose.scale.setScalar(live[at+17]);
      }
      if (liveFlags & 4) {
        pose.position.set(live[at+18],live[at+19],live[at+20]);
        pose.quaternion.set(live[at+21],live[at+22],live[at+23],live[at+24]);pose.scale.setScalar(live[at+25]);
      }
      pose.matrix.fromArray(live, at + 26); pose.matrixWorldNeedsUpdate = true;
    }
    return { moving, shelfMoving, previewing, previewed };
  };
}
