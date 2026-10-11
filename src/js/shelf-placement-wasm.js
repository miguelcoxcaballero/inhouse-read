// One complete placement job crosses the boundary. Objects, IDs and metadata
// stay in JavaScript; the core owns all collision, gap and mounting decisions.
const MAX_OBJECTS = 8192, INPUT_STRIDE = 7, OUTPUT_STRIDE = 6;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const isCeiling = object => object.kind === 'lamp' && object.mount === 'undershelf';

function configuration(options = {}) {
  const shelfWidth = finite(options.shelfWidth) ? options.shelfWidth : 360;
  const padding = finite(options.padding) ? Math.max(0, options.padding) : 16;
  const gap = finite(options.gap) ? Math.max(0, options.gap) : 3;
  return { ...options, shelfWidth, padding, gap, available:shelfWidth - padding * 2,
    minShelves:clamp(finite(options.minShelves) ? Math.floor(options.minShelves) : 3, 0, 1000) };
}
const shelfNumber = (value, fallback = 0) => finite(value) && value >= 0 ? clamp(Math.floor(value), 0, 999) : fallback;
function placementFor(value) {
  return !value || !finite(value.shelf) || value.shelf < 0 || !finite(value.x) ? null
    : { shelf:shelfNumber(value.shelf), x:clamp(value.x, 0, 1) };
}
function normalize(objects, cfg, group) {
  const keys = new Set();
  return (Array.isArray(objects) ? objects : []).filter(Boolean).flatMap((object, order) => {
    if (typeof object.key !== 'string' || !object.key || keys.has(object.key)) return [];
    keys.add(object.key);
    const requestedWidth = object.width ?? object.displayWidth ?? object.style?.width;
    const width = clamp(finite(requestedWidth) && requestedWidth > 0 ? requestedWidth : 32, 1, cfg.available);
    const saved = placementFor(cfg.placements?.[object.key]);
    const shelf = saved?.shelf ?? shelfNumber(object.shelf ?? object.row);
    const x = saved?.x ?? (finite(object.x) ? clamp(object.x, 0, 1) : null);
    const requestedCenter = x == null ? null : cfg.padding + x * cfg.available;
    const center = x == null ? null : clamp(requestedCenter, cfg.padding + width / 2, cfg.shelfWidth - cfg.padding - width / 2);
    return [{ object, key:object.key, width, shelf, desiredLeft:center == null ? null : center - width / 2,
      requestedX:center === requestedCenter ? x : null, order, group }];
  });
}
function snapshot(shelves) {
  const objects = shelves.flatMap(shelf => shelf.items);
  return { shelves, objects, placements:Object.fromEntries(objects.map(object => [object.key, { shelf:object.shelf, x:object.x }])) };
}
function joinShelves(floor, ceiling) {
  return Array.from({ length:Math.max(floor.length, ceiling.length) }, (_, index) => {
    const row = floor[index] || { ...ceiling[index], items:[], usedWidth:0, occupiedWidth:0,
      freeWidth:ceiling[index].freeWidth + ceiling[index].occupiedWidth };
    const items = [...row.items, ...(ceiling[index]?.items || [])];
    return { ...row, items, objects:items };
  });
}

// The original decoration API finishes one surface, including metadata
// getters, before it starts the next. Combining both surfaces is equivalent
// only for data records. Inspect descriptors without invoking accessors;
// accessor-backed records retain the original, sequential implementation.
// A browser cannot identify an arbitrary Proxy without running its traps.
// Proxies are consequently outside this adapter's data-record contract.
function dataOnlyInputs(objects, options, { move, target, separateMounts }) {
  const descriptors = new WeakMap();
  let safe = true;
  const describe = value => {
    const object = Object(value);
    if (!descriptors.has(object)) descriptors.set(object, Object.getOwnPropertyDescriptors(object));
    return descriptors.get(object);
  };
  const field = (value, key) => {
    if (value == null) return undefined;
    let object = Object(value);
    while (object !== null) {
      const own = describe(object);
      if (Object.hasOwn(own, key)) {
        const descriptor = own[key];
        if (!Object.hasOwn(descriptor, 'value')) { safe = false; return undefined; }
        return descriptor.value;
      }
      object = Object.getPrototypeOf(object);
    }
    return undefined;
  };
  const spread = value => {
    if (value == null) return;
    const own = describe(value);
    for (const key of Reflect.ownKeys(own)) {
      const descriptor = own[key];
      if (descriptor.enumerable && !Object.hasOwn(descriptor, 'value')) safe = false;
    }
  };
  const position = value => { if (value != null) { field(value, 'shelf'); field(value, 'x'); } };
  if (options === null) return false;
  spread(options);
  for (const key of ['shelfWidth', 'padding', 'gap', 'minShelves']) field(options, key);
  const placements = field(options, 'placements');
  if (move) { spread(placements); position(target); }
  if (!safe) return false;
  if (!Array.isArray(objects)) return !separateMounts;
  // Array subclasses and inherited array entries may change filter/find/some
  // traversal. Ordinary sparse arrays still follow the original hole rules.
  if (Object.getPrototypeOf(objects) !== Array.prototype) return false;
  const array = describe(objects), length = array.length.value;
  for (const key of ['filter', 'flatMap', 'some', 'find']) {
    if (Object.hasOwn(array, key)) return false;
    field(objects, key);
  }
  for (let prototype = Array.prototype; prototype !== null; prototype = Object.getPrototypeOf(prototype)) {
    for (const key of Reflect.ownKeys(describe(prototype))) {
      if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length) return false;
    }
  }
  if (!safe) return false;
  for (const key of Reflect.ownKeys(array)) {
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) continue;
    const descriptor = array[key];
    if (!Object.hasOwn(descriptor, 'value')) return false;
    const object = descriptor.value;
    if (!object) { if (separateMounts && object == null) return false; continue; }
    spread(object);
    const objectKey = field(object, 'key');
    for (const name of ['kind', 'mount', 'width', 'displayWidth', 'shelf', 'row', 'x']) field(object, name);
    const style = field(object, 'style');
    if (style != null) field(style, 'width');
    if (typeof objectKey === 'string' && objectKey) position(field(placements, objectKey));
    if (!safe) return false;
  }
  return safe;
}

/** undefined requests the unchanged implementation. An empty layout is a
 * valid result. Input arrays and nested metadata are never copied into WASM.
 * No cached arenas or views survive a call; nested host jobs are independent. */
export function rustShelfPlacement(core, objects, options = {}, {
  move = false, movedKey, target, separateMounts = false,
} = {}) {
  if (typeof core?.shelf_place !== 'function' || !core.memory
    || typeof core.alloc_f64 !== 'function' || typeof core.free_f64 !== 'function') return undefined;
  if (!dataOnlyInputs(objects, options, { move, target, separateMounts })) return undefined;
  // Host normalization and hydration intentionally live outside the WASM
  // failure boundary. User errors must propagate instead of being retried.
  const cfg = configuration(options), groups = separateMounts ? 2 : 1;
  if (!(cfg.available > 0)) return move ? snapshot([]) : [];
  let records = [], pin = -1;
  const movingConfig = (list, group) => {
    const position = placementFor(target);
    const exists = Array.isArray(list) && list.some(object => object?.key === movedKey);
    const local = exists && position ? { ...cfg, placements:{ ...cfg.placements, [movedKey]:position } } : cfg;
    const normalized = normalize(list, local, group);
    if (exists && position) {
      const at = normalized.findIndex(item => item.key === movedKey);
      if (at >= 0) pin = records.length + at;
    }
    records.push(...normalized);
  };
  if (separateMounts && move) {
    const ceiling = isCeiling(objects.find(object => object.key === movedKey) || {});
    const selected = objects.filter(object => isCeiling(object) === ceiling);
    const other = objects.filter(object => isCeiling(object) !== ceiling);
    movingConfig(selected, ceiling ? 1 : 0);
    records.push(...normalize(other, cfg, ceiling ? 0 : 1));
  } else if (separateMounts) {
    records = normalize(objects.filter(object => !isCeiling(object)), cfg, 0);
    records.push(...normalize(objects.filter(isCeiling), cfg, 1));
  } else if (move) movingConfig(objects, 0);
  else records = normalize(objects, cfg, 0);
  if (records.length > MAX_OBJECTS) return undefined;
  const shelves = executePlacement(core, preparePlacement(records, cfg, groups), pin);
  return shelves === undefined ? undefined : move ? snapshot(shelves) : shelves;
}

function preparePlacement(records, cfg, groups) {
  const count = records.length, input = new Float64Array(count * INPUT_STRIDE);
  records.forEach((record, index) => input.set([record.width, record.shelf, record.desiredLeft ?? 0,
    record.requestedX ?? 0, (record.desiredLeft == null ? 0 : 1) | (record.requestedX == null ? 0 : 2),
    record.order, record.group], index * INPUT_STRIDE));
  const maxRow = Array(groups).fill(-1), counts = Array(groups).fill(0);
  for (const record of records) { counts[record.group]++; maxRow[record.group] = Math.max(maxRow[record.group], record.shelf); }
  return { records, cfg, groups, count, input, maxRow, counts };
}

function executePlacement(core, job, pin, target = null) {
  const { records, cfg, groups, count, input:prepared, maxRow, counts } = job;
  // Upper bounds include all requested empty rows and the worst possible
  // one-object-per-row overflow, independently for each mounting surface.
  const rowLimits = counts.map((count, group) => Math.max(cfg.minShelves,
    Math.max(maxRow[group], pin >= 0 && records[pin].group === group && target ? target.shelf : -1) + 1 + count));
  const configOffset = count * INPUT_STRIDE, outputOffset = configOffset + 7;
  const outputLength = 4 + count * OUTPUT_STRIDE + rowLimits.reduce((sum, rows) => sum + rows * 3, 0);
  let pointer = 0;
  const length = outputOffset + outputLength;
  let output, rows, sizes;
  try {
    pointer = core.alloc_f64(length);
    if (!pointer) return undefined;
    const input = new Float64Array(core.memory.buffer, pointer, outputOffset);
    input.set(prepared);
    if (target && pin >= 0) {
      const record = records[pin], at = pin * INPUT_STRIDE;
      const requestedCenter = cfg.padding + target.x * cfg.available;
      const center = clamp(requestedCenter, cfg.padding + record.width / 2,
        cfg.shelfWidth - cfg.padding - record.width / 2);
      input[at + 1] = target.shelf;
      input[at + 2] = center - record.width / 2;
      input[at + 3] = center === requestedCenter ? target.x : 0;
      input[at + 4] = center === requestedCenter ? 3 : 1;
    }
    input.set([cfg.shelfWidth, cfg.padding, cfg.gap, cfg.available, cfg.minShelves, groups, pin], configOffset);
    const outputPointer = pointer + outputOffset * 8;
    if (core.shelf_place(pointer, count, pointer + configOffset * 8, outputPointer, outputLength) !== 1) return undefined;
    // Internal Vec allocations can grow memory. Copy the complete result out
    // before spreading host metadata, whose getters may invoke another job.
    const header = new Float64Array(core.memory.buffer, outputPointer, 4);
    rows = [header[1], header[3]]; sizes = [header[0], header[2]];
    if (!sizes.every(Number.isInteger) || sizes[0] < 0 || sizes[1] < 0 || sizes[0] + sizes[1] !== count
      || rows.some((value, group) => !Number.isInteger(value) || value < 0 || value > (rowLimits[group] || 0))) return undefined;
    const used = 4 + count * OUTPUT_STRIDE + (rows[0] + rows[1]) * 3;
    output = new Float64Array(core.memory.buffer, outputPointer, used).slice();
    const allocated = pointer; pointer = 0; core.free_f64(allocated, length);
  } catch { return undefined; }
  finally { if (pointer) core.free_f64(pointer, length); }
  let at = 4, statsAt = 4 + count * OUTPUT_STRIDE;
  const shelvesByGroup = [];
  for (let group = 0; group < groups; group++) {
    const shelves = Array.from({ length:rows[group] }, (_, index) => {
      const items = [], usedWidth = output[statsAt++], occupiedWidth = output[statsAt++], freeWidth = output[statsAt++];
      return { index, width:cfg.shelfWidth, usedWidth, occupiedWidth, freeWidth, items, objects:items };
    });
    for (let index = 0; index < sizes[group]; index++) {
      const source = output[at++], row = output[at++], width = output[at++], left = output[at++], center = output[at++], x = output[at++];
      if (!Number.isInteger(source) || !records[source] || records[source].group !== group || !Number.isInteger(row) || !shelves[row]) return undefined;
      const original = records[source];
      shelves[row].items.push({ ...original.object, key:original.key, width, shelf:row, row, x, left, center });
    }
    shelvesByGroup.push(shelves);
  }
  return groups === 2 ? joinShelves(...shelvesByGroup) : shelvesByGroup[0];
}

/** A short-lived, private drag snapshot. The source objects are not branded,
 * cached by identity, frozen or trusted on later calls. All geometry and top
 * level metadata are copied into owned storage now, after descriptor gating.
 * Nested metadata remains opaque and retains the previous reference identity.
 * No WASM allocation survives move(); dispose drops the owned JS snapshot. */
export function createShelfPlacementSession(objects, options = {}) {
  if (!dataOnlyInputs(objects, options, { move:true, separateMounts:true })) return null;
  const configurationValue = configuration(options);
  if (!(configurationValue.available > 0)) return null;
  const cfg = Object.freeze({ shelfWidth:configurationValue.shelfWidth, padding:configurationValue.padding,
    gap:configurationValue.gap, available:configurationValue.available, minShelves:configurationValue.minShelves });
  const records = [...normalize(objects.filter(object => !isCeiling(object)), configurationValue, 0),
    ...normalize(objects.filter(isCeiling), configurationValue, 1)];
  if (records.length > MAX_OBJECTS) return null;
  const bySurface = [new Map(), new Map()], firstSurface = new Map();
  for (const object of objects) {
    if (object == null) return null;
    if (typeof object.key === 'string' && object.key && !firstSurface.has(object.key))
      firstSurface.set(object.key, isCeiling(object) ? 1 : 0);
  }
  records.forEach((record, index) => {
    bySurface[record.group].set(record.key, index);
    record.object = Object.freeze({ ...record.object });
    Object.freeze(record);
  });
  const pins = new Map([...firstSurface].map(([key, group]) => [key, bySurface[group].get(key)]));
  let job = preparePlacement(Object.freeze(records), cfg, 2), active = false;
  return Object.freeze({
    move(core, key, shelf, x) {
      if (!job || active || typeof core?.shelf_place !== 'function' || !core.memory
        || typeof core.alloc_f64 !== 'function' || typeof core.free_f64 !== 'function') return undefined;
      const owned = job, target = placementFor({ shelf, x });
      const pin = target && pins.has(key) ? pins.get(key) : -1;
      active = true;
      try {
        const shelves = executePlacement(core, owned, pin, target);
        return job !== owned || shelves === undefined ? undefined : snapshot(shelves);
      } finally { active = false; }
    },
    dispose() { job = null; pins.clear(); },
  });
}
