// The scene tells its entry arena what its entries hold (columns 85-87: scene-entry-frame.js `hold`)
// and its flags and drag offsets (columns 2-4) only after something may have changed them
// (bookshelf-scene.js `censusStale`, `domDirty`), and the pose call keeps the quality the entry was
// told (columns 89-90). This wraps the entry frame for a test file: at every pose call and every
// census, the arena's record of each entry is checked against the entry itself, with the expressions
// the frame wrote for every entry in every frame (1.7.330; the completed drop was a bit of column 49).
// A change the scene failed to announce is a miss.
//   vi.mock('../../src/js/scene-entry-frame.js', async actual => (await import('./helpers/scene-census-audit.js')).auditedEntryFrame(actual))
export const censusAudit = globalThis.__sceneCensusAudit ||= { walked:0, kept:0, misses:[] };
const want = new Float64Array(8), COLUMNS = [85, 86, 87, 2, 3, 4, 89, 90];
function held(entry) {
  const model = entry.model, data = model?.userData, insertion = entry.insertion, quality = entry.plantQuality;
  want[0] = (model ? data.overview ? 9 : 1 : 0) | (model?.visible ? 2 : 0) | (entry.qualityReplacement || quality ? 4 : 0) |
    (insertion ? insertion.overlayCanvas ? 80 : 16 : 0) | (entry.trashDrop ? 32 : 0) | (entry.trashDrop?.complete ? 512 : 0) | (insertion?.nativePresentation ? 128 : 0) |
    (entry.qualityReplacement && !entry.replacementReady || quality && !quality.ready ? 256 : 0);
  want[1] = data?.inspectionResolution; want[2] = model ? model.id : 0;
  want[3] = entry.bits; want[4] = entry.dragNumberX; want[5] = entry.dragNumberY;
  want[6] = entry.overview ? 1 : 0; want[7] = entry.inspectionResolution;
  return want;
}
export async function auditedEntryFrame(importActual) {
  const actual = await importActual();
  return { ...actual, createSceneEntryFrame(rust) {
    const frame = actual.createSceneEntryFrame(rust);
    let entries = [], walked = false;
    const check = name => {
      if (walked) censusAudit.walked++; else censusAudit.kept++;
      walked = false; frame.refresh();
      entries.forEach((entry, index) => {
        const expected = held(entry), at = index * actual.ENTRY_STATE;
        // The census reads only what the host holds; the pose call has by then told entries a new quality.
        for (let column = 0; column < (name === 'census' ? 3 : 8); column++) if (!Object.is(frame.state[at + COLUMNS[column]], expected[column]))
          censusAudit.misses.push(`${name}: entry ${index} (${entry.key}) column ${COLUMNS[column]}: told ${frame.state[at + COLUMNS[column]]}, holds ${expected[column]}`);
      });
    };
    for (const name of ['bind', 'hold']) { const original = frame[name]; frame[name] = (list, ...rest) => { entries = list; if (name === 'hold') walked = true; return original(list, ...rest); }; }
    for (const name of ['poses', 'place', 'settled', 'census']) { const original = frame[name]; frame[name] = (...args) => { check(name); return original(...args); }; }
    return frame;
  } };
}
