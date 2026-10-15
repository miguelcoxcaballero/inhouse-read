// The coarse first look of a plant surface (its painter on an 8-pixel lattice, spread bilinearly) is
// drawn by the decor core from the surface's description; false means it declined.
const LENGTHS = [10, 4, 0, 5];
export function rustPlantLattice(core, { family, kind, config }, width, height, repeat, pigment, data) {
  if (typeof core?.plant_surface_lattice !== 'function' || !(family in LENGTHS) || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > 2048 || height > 2048 || config?.length !== undefined && config.length !== LENGTHS[family]
      || !(pigment instanceof Uint8Array) || !(data instanceof Uint8Array) || pigment.length !== width * height * 4 || data.length !== pigment.length) return false;
  const settings = LENGTHS[family], length = settings + Math.ceil(pigment.length * 2 / 8);
  let pointer;
  try { pointer = core.alloc_f64(length); } catch { return false; }
  if (!pointer) return false;
  try {
    if (settings) new Float64Array(core.memory.buffer, pointer, settings).set(config);
    const output = pointer + settings * 8;
    if (core.plant_surface_lattice(family, kind ?? 0, width, height, Number(Boolean(repeat)), pointer, output) !== 1) return false;
    pigment.set(new Uint8Array(core.memory.buffer, output, pigment.length));
    data.set(new Uint8Array(core.memory.buffer, output + pigment.length, data.length));
    return true;
  } catch { return false; } finally { core.free_f64(pointer, length); }
}
