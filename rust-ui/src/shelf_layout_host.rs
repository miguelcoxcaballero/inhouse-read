//! The spine style of every book (bookshelf-layout.js `spineStylesFor`): its palette, finish, width and height,
//! deterministic for the book's seed.
//!
//! Every decision is the numeric core's (rust-core/src/shelf_layout.rs `spine_styles`, a separate WebAssembly module
//! with its own memory and allocator). This module makes the whole request the JavaScript host made around it: it
//! merges the options over their defaults, finds each book's seed, writes the core's arena in one copy, calls the
//! kernel and builds the style objects with the same keys in the same order and the same palette and finish entries.
//!
//! Speed: each step that crosses to the engine costs more than the work around it, so the per-book work crosses as
//! little as it can, and the request is faster than the JavaScript it replaced (which asked book_data for every seed).
//! Property names are made once; the core's kernels are typed method calls; the style objects made here are filled
//! with a plain `Reflect.set` and their numbers are passed as numbers; a record's seed is its string `id`, read once
//! (any other record asks book_data's `book_seed_for`, as the host did); a seed's text crosses once, as UTF-8, and only
//! a seed that decodes to U+FFFD (a lone surrogate, or the character itself) is read unit by unit. The packing into
//! shelves and the sections stay in JavaScript: they build an object per book around one kernel call, and from here
//! each of those objects cost several crossings more than the engine takes to make it (measured 2-3x slower).
use std::cell::RefCell;
use std::rc::Rc;

use js_sys::{Array, Float64Array, JsString, Object, Reflect, Uint8Array};
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::{absent, read, truthy};

type R<T> = Result<T, JsValue>;

/// The property names of the per-book work, made once per module instance: making a JS string from Rust decodes it
/// every time, which cost more than the work around it.
macro_rules! keys {
    ($($field:ident = $name:literal),* $(,)?) => {
        struct Keys { $($field: JsValue),* }
        impl Keys { fn new() -> Keys { Keys { $($field: JsValue::from_str($name)),* } } }
    };
}
keys!(seed = "seed", palette = "palette", color = "color", shade = "shade", ink = "ink", width = "width",
    height_ratio = "heightRatio", texture = "texture", base = "base", word_count = "wordCount", id = "id",
    shelf_visual_id = "shelfVisualId", min_width = "minWidth", max_width = "maxWidth", min_height_ratio = "minHeightRatio",
    max_height_ratio = "maxHeightRatio", page_thickness = "pageThickness", binding_thickness = "bindingThickness");
thread_local! {
    static KEYS: Keys = Keys::new();
}

#[wasm_bindgen]
extern "C" {
    /// The catalogue core's exports: its kernels are called as methods, as `core.name(...)` calls them.
    type Core;
    #[wasm_bindgen(method, catch)]
    fn alloc_f64(this: &Core, words: f64) -> R<JsValue>;
    #[wasm_bindgen(method, catch)]
    fn free_f64(this: &Core, pointer: f64, words: f64) -> R<()>;
    #[wasm_bindgen(method, catch)]
    fn spine_styles(this: &Core, config: f64, words: f64, offsets: f64, units: f64, count: f64, total: f64, out: f64) -> R<f64>;
    #[wasm_bindgen(method, getter, catch)]
    fn memory(this: &Core) -> R<JsValue>;
    /// `Reflect.set` on an object made here: a fresh plain object has no setter that could throw.
    #[wasm_bindgen(js_namespace = Reflect, js_name = set)]
    fn put(target: &JsValue, key: &JsValue, value: &JsValue) -> bool;
    /// The same, for a number (no handle is made for it).
    #[wasm_bindgen(js_namespace = Reflect, js_name = set)]
    fn put_number(target: &JsValue, key: &JsValue, value: f64) -> bool;
}

/// `target[key]` for a cached key, throwing like the engine for null/undefined.
fn take(target: &JsValue, key: &JsValue) -> R<JsValue> {
    // An object answers the first read; only a failed read asks what the value was (each question crosses too).
    Reflect::get(target, key).or_else(|error| {
        if absent(target) {
            return Err(js_sys::TypeError::new(&format!("Cannot read properties of {} (reading '{}')", if target.is_null() { "null" } else { "undefined" },
                key.as_string().unwrap_or_default())).into());
        }
        if target.is_object() || target.is_function() {
            return Err(error);
        }
        Reflect::get(&crate::host::boxed(target), key)
    })
}

/// `target?.[key]` for a cached key.
fn peek(target: &JsValue, key: &JsValue) -> JsValue {
    Reflect::get(target, key).unwrap_or_else(|_| {
        if absent(target) || target.is_object() || target.is_function() { JsValue::UNDEFINED }
        else { Reflect::get(&crate::host::boxed(target), key).unwrap_or(JsValue::UNDEFINED) }
    })
}

/// `Number(value)`: a number answers in one question.
fn num(value: &JsValue) -> f64 { crate::host::num(value) }

/// One input region of a kernel arena.
enum Region<'a> {
    F64(&'a [f64]),
    U16(&'a [u16]),
}

impl Region<'_> {
    fn words(&self) -> usize {
        match self {
            Region::F64(values) => values.len(),
            Region::U16(units) => unit_words(units.len()),
        }
    }
}

/// What the host hands over: the catalogue core's exports and its frozen tables.
struct Host {
    core: Core,
    palette: JsValue,
    textures: JsValue,
    spine: JsValue,
}

thread_local! {
    /// The last host read, with the object it was read from: bookshelf-layout.js hands the same object on every
    /// call, so its fields are read once per module copy.
    static HOST: RefCell<Option<(JsValue, Rc<Host>)>> = const { RefCell::new(None) };
}

impl Host {
    fn of(host: &JsValue) -> R<Rc<Host>> {
        let known = HOST.with(|slot| slot.borrow().as_ref().filter(|(object, _)| object == host).map(|(_, read)| read.clone()));
        if let Some(known) = known {
            return Ok(known);
        }
        let made = Rc::new(Host {
            core: read(host, "core")?.unchecked_into(),
            palette: read(host, "palette")?,
            textures: read(host, "textures")?,
            spine: read(host, "spine")?,
        });
        HOST.with(|slot| *slot.borrow_mut() = Some((host.clone(), made.clone())));
        Ok(made)
    }

    fn buffer(&self) -> R<JsValue> { Ok(self.core.memory()?.unchecked_into::<js_sys::WebAssembly::Memory>().buffer()) }

    /// `new Float64Array(core.memory.buffer, pointer + at * 8, size)`, copied out.
    fn f64s(&self, pointer: f64, at: usize, size: usize) -> R<Vec<f64>> {
        Ok(Float64Array::new_with_byte_offset_and_length(&self.buffer()?, (pointer as usize + at * 8) as u32, size as u32).to_vec())
    }

    /// Writes every input region of an arena in one copy: the image spans the arena up to the end of the last
    /// region (gaps, such as an output region before the seeds, are zero), the seeds' UTF-16 units packed four to a
    /// word in little-endian order, as a `Uint16Array` over the same bytes reads them.
    fn fill(&self, pointer: f64, at: &[usize], regions: &[(usize, Region)]) -> R<()> {
        let end = regions.iter().map(|(slot, region)| at[*slot] + region.words()).max().unwrap_or(0);
        let mut image = vec![0u8; end * 8];
        for (slot, region) in regions {
            let start = at[*slot] * 8;
            match region {
                Region::F64(values) => {
                    for (index, value) in values.iter().enumerate() {
                        image[start + index * 8..start + index * 8 + 8].copy_from_slice(&value.to_le_bytes());
                    }
                }
                Region::U16(units) => {
                    for (index, unit) in units.iter().enumerate() {
                        image[start + index * 2..start + index * 2 + 2].copy_from_slice(&unit.to_le_bytes());
                    }
                }
            }
        }
        Uint8Array::new_with_byte_offset_and_length(&self.buffer()?, pointer as u32, image.len() as u32).copy_from(&image);
        Ok(())
    }

    /// One arena for a kernel call (catalogue-core.js `inArena`): `sizes` are f64 counts; `work` gets the base pointer
    /// and the offset (in f64) of each region. The arena is released whatever `work` does; a failure to release it
    /// wins, as a `finally` that throws does.
    fn in_arena<T>(&self, sizes: &[usize], work: impl FnOnce(f64, &[usize]) -> R<T>) -> R<T> {
        let mut at = Vec::with_capacity(sizes.len());
        let mut length = 0;
        for size in sizes {
            at.push(length);
            length += size;
        }
        let words = length.max(1) as f64;
        let pointer = self.core.alloc_f64(words)?;
        if !truthy(&pointer) {
            return Err(js_sys::RangeError::new("Shelf kernel: request too large").into());
        }
        let pointer = num(&pointer);
        let result = work(pointer, &at);
        self.core.free_f64(pointer, words)?;
        result
    }
}

/// `withDefaults(defaults, options)`: the defaults with every own enumerable option that is not `undefined`.
fn with_defaults(defaults: &JsValue, options: &JsValue) -> R<JsValue> {
    let merged: JsValue = Object::assign(&Object::new(), defaults.unchecked_ref()).into();
    if !truthy(options) {
        return Ok(merged);
    }
    for entry in Object::entries(options.unchecked_ref()).iter() {
        let entry: Array = entry.unchecked_into();
        let value = entry.get(1);
        if !value.is_undefined() {
            Reflect::set(&merged, &entry.get(0), &value)?;
        }
    }
    Ok(merged)
}

/// A parameter with the default `{}`.
fn or_empty(options: &JsValue) -> JsValue { if options.is_undefined() { Object::new().into() } else { options.clone() } }

/// The UTF-16 units of seeds one after another, and the `count + 1` offsets where each starts.
struct Units {
    units: Vec<u16>,
    offsets: Vec<f64>,
}

impl Units {
    fn with_capacity(count: usize) -> Units { Units { units: Vec::with_capacity(count * 24), offsets: Vec::with_capacity(count + 1) } }

    /// Appends `value` (a string), whose UTF-8 copy is `copy` when it already crossed. A copy without U+FFFD is the
    /// string itself; one with it may have replaced a lone surrogate, so that string is read unit by unit.
    fn push(&mut self, value: &JsValue, copy: Option<String>) -> R<()> {
        self.offsets.push(self.units.len() as f64);
        let copy = match copy {
            Some(copy) => Some(copy),
            None => value.as_string(),
        };
        match copy {
            Some(rust) if !rust.contains('\u{FFFD}') => self.units.extend(rust.encode_utf16()),
            Some(_) => {
                let text: &JsString = value.unchecked_ref();
                self.units.extend((0..text.length()).map(|index| text.char_code_at(index) as u16));
            }
            None => return Err(js_sys::TypeError::new("a shelf seed is not a string").into()),
        }
        Ok(())
    }

    fn finish(mut self) -> Units {
        self.offsets.push(self.units.len() as f64);
        self
    }
}

/// `Math.ceil(total / 4)`: the f64 words that hold `total` UTF-16 units.
fn unit_words(total: usize) -> usize { total.div_ceil(4) }

fn items(list: &JsValue) -> Vec<JsValue> {
    let list: &Array = list.unchecked_ref();
    (0..list.length()).map(|index| list.get(index)).collect()
}

// ------------------------------------------------------------------------------------------------ spine styles

/// `seedFor(book)` (book_data's `book_seed_for`) and the seed's UTF-8 copy when it is already known. The common
/// record, without `shelfVisualId` and with a non-empty string `id`, has that id as its seed: `String` of a string is
/// the string itself. Any other book (no object, a visual id, an id that is not a non-empty string) asks
/// `book_seed_for`, which reads the record as it always did.
fn seed_of(k: &Keys, book: &JsValue) -> R<(JsValue, Option<String>)> {
    if let Ok(visual) = Reflect::get(book, &k.shelf_visual_id) {
        if visual.is_undefined() {
            if let Ok(id) = Reflect::get(book, &k.id) {
                if let Some(copy) = id.as_string() {
                    if !copy.is_empty() {
                        return Ok((id, Some(copy)));
                    }
                }
            }
        }
    }
    Ok((crate::book_data::book_seed_for(book.clone())?, None))
}

/// The spine options of a request: `withDefaults(DEFAULT_SPINE, options)` as the kernel reads it.
fn spine_config(k: &Keys, host: &Host, options: &JsValue) -> R<[f64; 7]> {
    let cfg = with_defaults(&host.spine, &or_empty(options))?;
    let thickness = take(&cfg, &k.page_thickness)?;
    let binding = take(&cfg, &k.binding_thickness)?;
    Ok([
        num(&take(&cfg, &k.min_width)?), num(&take(&cfg, &k.max_width)?), num(&take(&cfg, &k.min_height_ratio)?),
        num(&take(&cfg, &k.max_height_ratio)?), thickness.as_f64().unwrap_or(f64::NAN), if truthy(&thickness) { 1.0 } else { 0.0 },
        if truthy(&binding) { num(&binding) } else { 0.0 },
    ])
}

/// The style of every book of `books` under `config`, in order.
fn spine_styles_with(k: &Keys, host: &Host, books: &[JsValue], config: &[f64; 7]) -> R<Vec<JsValue>> {
    let count = books.len();
    let mut seeds = Vec::with_capacity(count);
    let mut units = Units::with_capacity(count);
    let mut words = Vec::with_capacity(count);
    for book in books {
        let (seed, copy) = seed_of(k, book)?;
        units.push(&seed, copy)?;
        seeds.push(seed);
    }
    // `typeof book?.wordCount === 'number' ? book.wordCount : NaN`, after every seed, as the original read them.
    for book in books {
        words.push(peek(book, &k.word_count).as_f64().unwrap_or(f64::NAN));
    }
    let Units { units, offsets } = units.finish();
    let total = units.len();
    let out = host.in_arena(&[7, count, count + 1, count * 5, unit_words(total)], |pointer, at| {
        host.fill(pointer, at, &[(0, Region::F64(config)), (1, Region::F64(&words)), (2, Region::F64(&offsets)), (4, Region::U16(&units))])?;
        let p = |index: usize| pointer + (at[index] * 8) as f64;
        if host.core.spine_styles(p(0), p(1), p(2), p(4), count as f64, total as f64, p(3))? != 1.0 {
            return Err(js_sys::RangeError::new("Shelf layout: spine styles rejected").into());
        }
        host.f64s(pointer, at[3], count * 5)
    })?;
    // The catalogue's palette and textures are frozen tables: each entry is read once per request.
    let mut palettes: Vec<(u64, [JsValue; 4])> = Vec::new();
    let mut textures: Vec<(u64, JsValue)> = Vec::new();
    let mut styles = Vec::with_capacity(count);
    for (index, seed) in seeds.iter().enumerate() {
        let row = &out[index * 5..index * 5 + 5];
        let at = match palettes.iter().position(|(key, _)| *key == row[0].to_bits()) {
            Some(at) => at,
            None => {
                let palette = Reflect::get(&host.palette, &JsValue::from_f64(row[0]))?;
                let entry = [take(&palette, &k.base)?, take(&palette, &k.shade)?, take(&palette, &k.ink)?, palette];
                palettes.push((row[0].to_bits(), entry));
                palettes.len() - 1
            }
        };
        let texture = match textures.iter().position(|(key, _)| *key == row[1].to_bits()) {
            Some(at) => at,
            None => {
                textures.push((row[1].to_bits(), Reflect::get(&host.textures, &JsValue::from_f64(row[1]))?));
                textures.len() - 1
            }
        };
        let [color, shade, ink, palette] = &palettes[at].1;
        let style: JsValue = Object::new().into();
        put(&style, &k.seed, seed);
        put(&style, &k.palette, palette);
        put(&style, &k.color, color);
        put(&style, &k.shade, shade);
        put(&style, &k.ink, ink);
        put_number(&style, &k.width, row[2]);
        put_number(&style, &k.height_ratio, row[3]);
        put(&style, &k.texture, &textures[texture].1);
        styles.push(style);
    }
    Ok(styles)
}

/// `spineStylesFor(books, options = {})`: the spine of every book, deterministic for its seed.
#[wasm_bindgen]
pub fn shelf_spine_styles(host: &JsValue, books: &JsValue, options: &JsValue) -> R<Array> {
    KEYS.with(|k| {
        let host = Host::of(host)?;
        let config = spine_config(k, &host, options)?;
        if !Array::is_array(books) {
            return Err(js_sys::TypeError::new("books.map is not a function").into());
        }
        Ok(spine_styles_with(k, &host, &items(books), &config)?.into_iter().collect())
    })
}
