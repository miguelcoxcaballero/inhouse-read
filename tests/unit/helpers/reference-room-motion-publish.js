// Frozen from src/js/bookshelf-scene.js (as of e90960b0): the shared room's local motion as the
// host kept it. Every frame gave each keyed entry a fresh `[key, shelf, x, y, z, quaternion,
// scale]` array; a quiet frame rebuilt the map of the poses at rest; a gesture's frame added to
// the set of moved keys and listed their rows. Reference only: the scene keeps this in the entry
// arena now (rust-ui/src/scene_entry_frame.rs, motion_rest / motion_begin / motion_publish).
export function createReferenceRoomMotion(motionKey) {
  let motionRest = new Map(), motionAffected = new Set();
  return {
    // updateEntries, per entry: `live` is the entry frame's output arena, `at` the entry's offset.
    sample(entry, key, live, at) {
      if (live[at] & 1) entry.localMotionPose = [key,live[at+1],live[at+2],live[at+3],live[at+4],live[at+5],live[at+6],live[at+7],live[at+8],live[at+9]];
    },
    rest(bookEntries) {
      motionRest = new Map(bookEntries.filter(e => e.localMotionPose).map(e => [motionKey(e), e.localMotionPose]));
    },
    begin() { motionAffected.clear(); },
    poses(bookEntries) {
      const poses = [];
      for (const entry of bookEntries) {
        const row = entry.localMotionPose, previous = motionRest.get(motionKey(entry));
        if (row && (!previous || entry.bits & 6 || row.some((v,i) => i && Math.abs(v - previous[i]) > .000001))) motionAffected.add(row[0]);
        // Each frame is a complete replacement for this gesture's affected set,
        // including a neighbour that moved and then returned to its starting pose.
        if (row && motionAffected.has(row[0])) poses.push(row);
      }
      return poses;
    }
  };
}
