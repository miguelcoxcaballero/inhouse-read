//! What the shelf's lamp lights read from the scene's entries, in the order the original read it: which fixture
//! kind a lamp needs (a culled model is known from the catalogue, so scrolling a lamp out of the pool's reach
//! never changes the set of lights; on the shelf a filament lamp is one point light of the same flux), which
//! entries are candidates (a visible lamp with an emitter, not away or falling into the bin), the stable
//! numeric ids of their keys, the packed candidate and slot rows `LampPoolState` plans with, how a slot of a
//! kind is set up, and every emitter value a light or a filament strip is aimed from. Property reads, their
//! coercions (`Number`, `Math.floor(...) | 0`, `+`) and their order are the original's, getters included.
use wasm_bindgen::prelude::*;
use js_sys::{Array, Function, Map, Set};
use crate::host::{absent, get_at, method, num, read, truthy};

type R<T> = Result<T, JsValue>;

/// `a?.b`: undefined for an absent `a`.
fn optional(value: &JsValue, key: &str) -> R<JsValue> { if absent(value) { Ok(JsValue::UNDEFINED) } else { read(value, key) } }
fn is_string(value: &JsValue, text: &str) -> bool { value.as_string().is_some_and(|value| value == text) }
/// `entry.node?.classList.contains(name)`.
fn node_has(entry: &JsValue, name: &str) -> R<bool> {
    let node = read(entry, "node")?;
    if absent(&node) { return Ok(false); }
    Ok(truthy(&method(&read(&node, "classList")?, "contains", &[&name.into()])?))
}

/// The light a lamp needs: `'cone'`, `'point'`, `'filaments:<n>'` (only with `filament_areas`, the catalogue's
/// studio) or the catalogue's own light for a lamp without a model (`lookup(entry.lampId)`), else null.
fn kind_of(entry: &JsValue, filament_areas: bool, lookup: &Function) -> R<JsValue> {
    let model = read(entry, "model")?;
    let emitter = if absent(&model) { JsValue::UNDEFINED } else { read(&read(&model, "userData")?, "lightEmitter")? };
    if truthy(&emitter) {
        let filaments = read(&emitter, "filaments")?;
        if truthy(&optional(&filaments, "length")?) {
            if !filament_areas { return Ok("point".into()); }
            return Ok(format!("filaments:{}", crate::host::text_of(&read(&read(&emitter, "filaments")?, "length")?)).into());
        }
        return Ok(if Array::is_array(&read(&emitter, "direction")?) { "cone" } else { "point" }.into());
    }
    let lamp = lookup.call1(&JsValue::UNDEFINED, &read(entry, "lampId")?)?;
    let light = optional(&lamp, "light")?;
    let light = if absent(&light) { JsValue::NULL } else { light };
    if !filament_areas && !absent(&light) && truthy(&method(&light, "startsWith", &[&JsValue::from_str("filaments:")])?) { return Ok("point".into()); }
    Ok(light)
}
/// `kind === 'cone' ? 0 : kind === 'point' ? 1 : Number(kind.slice(10)) + 1`.
fn kind_code(kind: &JsValue) -> R<f64> {
    if is_string(kind, "cone") { return Ok(0.0); }
    if is_string(kind, "point") { return Ok(1.0); }
    Ok(num(&method(kind, "slice", &[&10.0.into()])?) + 1.0)
}
/// The code of an entry's kind, or -1 when it needs none.
fn code_of(entry: &JsValue, filament_areas: bool, lookup: &Function) -> R<f64> {
    if truthy(&kind_of(entry, filament_areas, lookup)?) { kind_code(&kind_of(entry, filament_areas, lookup)?) } else { Ok(-1.0) }
}

/// The fixture code every entry of the library asks a light of (`-1` for a non-lamp or a lamp needing none),
/// for `LampPoolState#reconcile`.
#[wasm_bindgen]
pub fn lamp_entry_kinds(entries: &JsValue, filament_areas: bool, lookup: &Function) -> R<Vec<f64>> {
    let count = num(&read(entries, "length")?) as u32;
    let mut out = Vec::with_capacity(count as usize);
    for index in 0..count {
        let entry = get_at(entries, index);
        let kind = if is_string(&read(&entry, "kind")?, "lamp") { kind_of(&entry, filament_areas, lookup)? } else { JsValue::NULL };
        out.push(if truthy(&kind) { kind_code(&kind)? } else { -1.0 });
    }
    Ok(out)
}

/// The code of a kind name (a slot's).
#[wasm_bindgen]
pub fn lamp_kind_code(kind: &JsValue) -> R<f64> { kind_code(kind) }

/// The kind name of a code: 0 cone, 1 point, n + 1 the n filament strips.
#[wasm_bindgen]
pub fn lamp_kind_name(code: f64) -> String { if code == 0.0 { "cone".into() } else if code == 1.0 { "point".into() } else { format!("filaments:{}", crate::host::number_string(code - 1.0)) } }

/// How a slot of a kind is made: `[filament strips, spotlight, casts a shadow]`, then the cone's shadow map
/// size, blur radius and samples, bias and intensity. Only the first two cones cast shadows, avoiding six
/// shadow passes per exposed bulb.
#[wasm_bindgen]
pub fn lamp_slot_plan(kind: &JsValue, index: f64) -> R<Vec<f64>> {
    let filaments = if truthy(&method(kind, "startsWith", &[&JsValue::from_str("filaments:")])?) { num(&method(kind, "slice", &[&10.0.into()])?) } else { 0.0 };
    let spotlight = is_string(kind, "cone");
    Ok(vec![filaments, if spotlight { 1.0 } else { 0.0 }, if spotlight && index < 2.0 { 1.0 } else { 0.0 }, 512.0, 2.0, 4.0, -0.0002, 0.8])
}

/// Stable numeric ids of entry keys (any value; a Map keeps identity) and the candidates of one frame.
#[wasm_bindgen]
pub struct LampEntries { ids: Map, next: f64, filament_areas: bool, lookup: Function }

#[wasm_bindgen]
impl LampEntries {
    #[wasm_bindgen(constructor)]
    pub fn new(filament_areas: bool, lookup: Function) -> LampEntries { LampEntries { ids: Map::new(), next: 0.0, filament_areas, lookup } }

    fn id_of(&mut self, key: &JsValue) -> f64 {
        let known = self.ids.get(key);
        if let Some(id) = known.as_f64() { if !known.is_undefined() { return id; } }
        let id = self.next; self.next += 1.0;
        self.ids.set(key, &id.into());
        id
    }

    /// The candidates among `entries` (iterated): a lamp whose model is visible and has an emitter, not away and
    /// not falling into the bin.
    pub fn candidates(&self, entries: &JsValue) -> R<Array> {
        let out = Array::new();
        for entry in js_sys::try_iter(entries)?.ok_or_else(|| JsValue::from(js_sys::TypeError::new("entries is not iterable")))? {
            let entry = entry?;
            if !is_string(&read(&entry, "kind")?, "lamp") { continue; }
            if !truthy(&optional(&read(&entry, "model")?, "visible")?) { continue; }
            if !truthy(&read(&read(&read(&entry, "model")?, "userData")?, "lightEmitter")?) { continue; }
            if node_has(&entry, "is-away")? { continue; }
            if truthy(&read(&entry, "trashDrop")?) { continue; }
            out.push(&entry);
        }
        Ok(out)
    }

    /// The rows `LampPoolState#plan` takes: three per slot (`[code, key id, lit]`) and seven per candidate
    /// (code, key id, dragged, power, vertical centre, first index of the same entry). The id table is pruned
    /// first once it outgrows the live keys.
    pub fn pack(&mut self, candidates: &Array, slot_codes: &[f64], slot_keys: &Array, slot_lit: &[f64], slots_out: &mut [f64], out: &mut [f64]) -> R<()> {
        let (count, total) = (candidates.length(), slot_codes.len());
        if f64::from(self.ids.size()) > crate::host::jmax(32.0, 2.0 * (f64::from(count) + total as f64)) {
            let live = Set::new(&JsValue::UNDEFINED);
            for entry in candidates.iter() { live.add(&read(&entry, "key")?); }
            for key in slot_keys.iter() { live.add(&key); }
            let stale = Array::new();
            self.ids.for_each(&mut |_, key| { if !live.has(&key) { stale.push(&key); } });
            for key in stale.iter() { self.ids.delete(&key); }
        }
        for index in 0..total {
            slots_out[3 * index] = slot_codes[index];
            slots_out[3 * index + 1] = self.id_of(&slot_keys.get(index as u32));
            slots_out[3 * index + 2] = slot_lit[index];
        }
        let identities = Map::new();
        for index in 0..count {
            let entry = candidates.get(index);
            let at = 7 * index as usize;
            out[at] = code_of(&entry, self.filament_areas, &self.lookup)?;
            out[at + 1] = self.id_of(&read(&entry, "key")?);
            out[at + 2] = if node_has(&entry, "is-dragging")? { 1.0 } else { 0.0 };
            let power = read(&read(&read(&read(&entry, "model")?, "userData")?, "lightEmitter")?, "power")?;
            out[at + 3] = if absent(&power) { 1.0 } else { num(&power) };
            let rect = read(&entry, "rect")?;
            let (top, bottom) = (optional(&rect, "top")?, { let rect = read(&entry, "rect")?; optional(&rect, "bottom")? });
            out[at + 4] = num(&(&(&top + &bottom) / &JsValue::from_f64(2.0)));
            let first = identities.get(&entry);
            let first = if first.is_undefined() { identities.set(&entry, &f64::from(index).into()); f64::from(index) } else { num(&first) };
            out[at + 5] = first;
        }
        Ok(())
    }
}

fn number_at(list: &JsValue, index: u32) -> R<f64> { Ok(num(&read(list, &index.to_string())?)) }
/// `Math.floor(value ?? 0xffd19a) | 0`.
fn colour(emitter: &JsValue) -> R<f64> {
    let value = read(emitter, "color")?;
    let value = if absent(&value) { 0xffd19a as f64 } else { num(&value) };
    let floored = value.floor();
    Ok(if floored.is_finite() { floored.trunc().rem_euclid(4294967296.0) as u64 as u32 as i32 as f64 } else { 0.0 })
}
/// `emitter.tint`: whether it is set, then its three channels.
fn tint(emitter: &JsValue, out: &mut [f64], at: usize) -> R<()> {
    let tint = read(emitter, "tint")?;
    out[at] = if truthy(&tint) { 1.0 } else { 0.0 };
    if truthy(&tint) { for k in 0..3 { out[at + 1 + k] = number_at(&tint, k as u32)?; } }
    Ok(())
}

/// The emitter part of a light's input (`LampLightState#light`), from index 82: position, direction (cones),
/// colour, tint, intensity, the slot's power, distance, the entry's width, decay, angle and penumbra (with
/// whether each is set), and whether any raw position, direction or distance is not a number (such a value
/// compared unequal to its stamp even when its numeric conversion was unchanged).
#[wasm_bindgen]
pub fn lamp_light_input(emitter: &JsValue, entry: &JsValue, power: f64, spotlight: bool, out: &mut [f64]) -> R<()> {
    for k in 0..3 { out[82 + k] = number_at(&read(emitter, "position")?, k as u32)?; }
    if spotlight { for k in 0..3 { out[85 + k] = number_at(&read(emitter, "direction")?, k as u32)?; } }
    out[88] = colour(emitter)?;
    tint(emitter, out, 89)?;
    out[93] = num(&read(emitter, "intensity")?); out[94] = power; out[95] = num(&read(emitter, "distance")?);
    out[96] = num(&read(entry, "width")?); out[97] = num(&read(emitter, "decay")?);
    for (at, key) in [(98, "angle"), (100, "penumbra")] {
        out[at] = if absent(&read(emitter, key)?) { 0.0 } else { 1.0 };
        out[at + 1] = num(&read(emitter, key)?);
    }
    let not_number = |value: R<JsValue>| -> R<bool> { Ok(value?.as_f64().is_none()) };
    let mut raw = not_number(read(emitter, "distance"))?;
    for k in 0..3 { raw = raw || not_number(read(&read(emitter, "position")?, &k.to_string()))?; }
    if spotlight && !raw { for k in 0..3 { raw = raw || not_number(read(&read(emitter, "direction")?, &k.to_string()))?; } }
    out[102] = if raw { 1.0 } else { 0.0 };
    Ok(())
}

/// The emitter part of a filament lamp's input (`LampLightState#filaments`), from index 16: the strip count,
/// colour, tint, intensity and the slot's power, then ten numbers per strip (start, end, normal, width).
#[wasm_bindgen]
pub fn lamp_filament_input(emitter: &JsValue, count: u32, power: f64, out: &mut [f64]) -> R<()> {
    out[16] = f64::from(count); out[17] = colour(emitter)?;
    tint(emitter, out, 18)?;
    out[22] = num(&read(emitter, "intensity")?); out[23] = power;
    for index in 0..count {
        let strip = get_at(&read(emitter, "filaments")?, index);
        let at = 24 + 10 * index as usize;
        for (offset, key) in [(0, "start"), (3, "end"), (6, "normal")] { for k in 0..3 { out[at + offset + k] = number_at(&read(&strip, key)?, k as u32)?; } }
        out[at + 9] = num(&read(&strip, "width")?);
    }
    Ok(())
}
