// Frozen from scene-entry-frame.js as of 1.7.330. A settled entry's frame, as the scene's host loop
// took it for every visible book and plant in every frame: its overview flag and resolution are stored
// on it as rust.scene_update_quality stores them, and the answer is whether that call has anything else
// to do: the model is at another quality (scene_quality.rs `matches`), or a replacement or a plant
// texture is under way. The pose call decides the same now (rust-ui/src/scene_entry_frame.rs, bit 8 of
// column 70) from what the entry arena was told the entry holds.
export function settledQualityWork(entry, overview, resolution) {
  entry.overview = overview; entry.inspectionResolution = resolution;
  const data = entry.model?.userData;
  return Boolean(entry.plantQuality || entry.qualityReplacement ||
    data && !(Boolean(data.overview) === overview && (data.inspectionResolution || 0) === resolution));
}
