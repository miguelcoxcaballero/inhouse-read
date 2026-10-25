// Object access remains in the host; Rust owns the retained numeric buffer,
// exact change detection, totals and resolution formatting.
export function createSceneCountFrame(rust) {
  const native = new rust.RustSceneCounts(), memory = native.memory();
  let count = -1, inputAt = 0, buffer = null, input, output, text = '', disposed = false;
  function refresh() {
    if (buffer === memory.buffer) return;
    buffer = memory.buffer;
    input = new Float64Array(buffer, inputAt, count * 5);
    output = new Float64Array(buffer, native.output_ptr(), 8);
  }
  return {
    sample(entries, target) {
      if (disposed) throw new Error('Scene counts have been disposed');
      if (count !== entries.length) {
        count = entries.length; native.resize(count); inputAt = native.input_ptr(); buffer = null;
      }
      refresh();
      for (let index = 0; index < count; index++) {
        const entry = entries[index], model = entry.model, at = index * 5;
        input[at] = entry.kind === 'plant' ? 1 : entry.kind === 'lamp' ? 2 : 0;
        input[at + 1] = model?.visible ? 1 : 0;
        input[at + 2] = entry.qualityReplacement || entry.plantQuality ? 1 : 0;
        input[at + 3] = model?.userData.overview ? 1 : 0;
        input[at + 4] = model?.userData.inspectionResolution;
      }
      const changed = native.sample();
      if (changed) text = native.resolutions();
      refresh();
      target.set(output);
      return text;
    },
    free() {
      if (disposed) return;
      native.free(); disposed = true; input = output = buffer = null;
    }
  };
}
