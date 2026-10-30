//! The bookshelf's layout requests (bookshelf-layout.js): the spine style of every book, the packing of books and
//! pots into fixed-width shelves, the split of the library into sections and the whole plan of the home shelf.
//!
//! Every decision is the numeric core's (rust-core/src/shelf_layout.rs, a separate WebAssembly module with its
//! own memory and allocator). This module does what the JavaScript host did around it: it merges the options over
//! their defaults, reads the books, calls the host's callbacks (`plantWidthFor`, `displayWidthFor`,
//! `prepareStyles`) with the same arguments, receivers and order, writes the core's arena, calls its kernels and
//! builds the objects bookshelf.js consumes, with the same keys in the same order and the same table objects.
//! Collation (the alphabetical sort of the sections) stays the browser's `Intl.Collator`.
use std::cell::RefCell;

use js_sys::{Array, Float64Array, Function, JsString, Map, Object, Reflect, Uint16Array};
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::{absent, get, get_at, num, number_string, read, set, text, text_value, truthy};

type R<T> = Result<T, JsValue>;

/// What the host hands over: the catalogue core's exports and its frozen tables.
struct Host {
    core: JsValue,
    palette: JsValue,
    textures: JsValue,
    spine: JsValue,
    layout: JsValue,
    sections: JsValue,
}

impl Host {
    fn of(host: &JsValue) -> R<Host> {
        Ok(Host {
            core: read(host, "core")?,
            palette: read(host, "palette")?,
            textures: read(host, "textures")?,
            spine: read(host, "spine")?,
            layout: read(host, "layout")?,
            sections: read(host, "sections")?,
        })
    }

    /// `core[name](...args)`.
    fn kernel(&self, name: &str, args: &[f64]) -> R<f64> {
        let function: Function = read(&self.core, name)?.dyn_into().map_err(|_| js_sys::TypeError::new(&format!("core.{name} is not a function")))?;
        let list = Array::new();
        for value in args {
            list.push(&JsValue::from_f64(*value));
        }
        Ok(num(&function.apply(&self.core, &list)?))
    }

    fn buffer(&self) -> R<JsValue> { read(&read(&self.core, "memory")?, "buffer") }

    /// `new Float64Array(core.memory.buffer, pointer + at * 8, size)`.
    fn f64s(&self, pointer: f64, at: usize, size: usize) -> R<Float64Array> {
        Ok(Float64Array::new_with_byte_offset_and_length(&self.buffer()?, (pointer as usize + at * 8) as u32, size as u32))
    }

    fn write(&self, pointer: f64, at: usize, values: &[f64]) -> R<()> {
        self.f64s(pointer, at, values.len())?.copy_from(values);
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
        let pointer = self.kernel("alloc_f64", &[words])?;
        if pointer == 0.0 || pointer.is_nan() {
            return Err(js_sys::RangeError::new("Shelf kernel: request too large").into());
        }
        let result = work(pointer, &at);
        self.kernel("free_f64", &[pointer, words])?;
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

/// The UTF-16 units of `texts` one after another, and the `count + 1` offsets where each starts.
fn seed_units(texts: &[JsValue]) -> R<(Vec<u16>, Vec<f64>)> {
    let mut offsets = Vec::with_capacity(texts.len() + 1);
    let mut units = Vec::new();
    for text in texts {
        offsets.push(units.len() as f64);
        let text: &JsString = text.dyn_ref().ok_or_else(|| js_sys::TypeError::new("a shelf seed is not a string"))?;
        for index in 0..text.length() {
            units.push(text.char_code_at(index) as u16);
        }
    }
    offsets.push(units.len() as f64);
    Ok((units, offsets))
}

fn write_units(host: &Host, pointer: f64, at: usize, units: &[u16]) -> R<()> {
    Uint16Array::new_with_byte_offset_and_length(&host.buffer()?, (pointer as usize + at * 8) as u32, units.len() as u32).copy_from(units);
    Ok(())
}

/// `Math.ceil(total / 4)`: the f64 words that hold `total` UTF-16 units.
fn unit_words(total: usize) -> usize { total.div_ceil(4) }

fn object(fields: &[(&str, &JsValue)]) -> R<JsValue> {
    let value: JsValue = Object::new().into();
    for (key, field) in fields {
        set(&value, key, field)?;
    }
    Ok(value)
}

fn items(list: &JsValue) -> Vec<JsValue> {
    let list: &Array = list.unchecked_ref();
    (0..list.length()).map(|index| list.get(index)).collect()
}

// ------------------------------------------------------------------------------------------------ spine styles

fn spine_styles(host: &Host, books: &JsValue, options: &JsValue) -> R<Array> {
    let cfg = with_defaults(&host.spine, &or_empty(options))?;
    if !Array::is_array(books) {
        return Err(js_sys::TypeError::new("books.map is not a function").into());
    }
    let books = items(books);
    let seeds = books.iter().map(|book| crate::book_data::book_seed_for(book.clone())).collect::<R<Vec<_>>>()?;
    let count = seeds.len();
    let (units, offsets) = seed_units(&seeds)?;
    let total = units.len();
    let thickness = read(&cfg, "pageThickness")?;
    let binding = read(&cfg, "bindingThickness")?;
    let config = [
        num(&read(&cfg, "minWidth")?), num(&read(&cfg, "maxWidth")?), num(&read(&cfg, "minHeightRatio")?), num(&read(&cfg, "maxHeightRatio")?),
        thickness.as_f64().unwrap_or(f64::NAN), if truthy(&thickness) { 1.0 } else { 0.0 }, if truthy(&binding) { num(&binding) } else { 0.0 },
    ];
    let words = books.iter().map(|book| Ok(get(book, "wordCount").as_f64().unwrap_or(f64::NAN))).collect::<R<Vec<f64>>>()?;
    let out = host.in_arena(&[7, count, count + 1, count * 5, unit_words(total)], |pointer, at| {
        host.write(pointer, at[0], &config)?;
        host.write(pointer, at[1], &words)?;
        host.write(pointer, at[2], &offsets)?;
        write_units(host, pointer, at[4], &units)?;
        let p = |index: usize| pointer + (at[index] * 8) as f64;
        if host.kernel("spine_styles", &[p(0), p(1), p(2), p(4), count as f64, total as f64, p(3)])? != 1.0 {
            return Err(js_sys::RangeError::new("Shelf layout: spine styles rejected").into());
        }
        Ok(host.f64s(pointer, at[3], count * 5)?.to_vec())
    })?;
    let styles = Array::new();
    for (index, seed) in seeds.iter().enumerate() {
        let row = &out[index * 5..index * 5 + 5];
        let palette = Reflect::get(&host.palette, &JsValue::from_f64(row[0]))?;
        let style = object(&[
            ("seed", seed), ("palette", &palette), ("color", &read(&palette, "base")?), ("shade", &read(&palette, "shade")?),
            ("ink", &read(&palette, "ink")?), ("width", &JsValue::from_f64(row[2])), ("heightRatio", &JsValue::from_f64(row[3])),
            ("texture", &Reflect::get(&host.textures, &JsValue::from_f64(row[1]))?),
        ])?;
        styles.push(&style);
    }
    Ok(styles)
}

/// `spineStylesFor(books, options = {})`: the spine of every book, deterministic for its seed.
#[wasm_bindgen]
pub fn shelf_spine_styles(host: &JsValue, books: &JsValue, options: &JsValue) -> R<Array> { spine_styles(&Host::of(host)?, books, options) }

// ------------------------------------------------------------------------------------------------ shelves

/// `cfg.name(...args)`, a method call as `cfg.name?.(...)` makes it (the caller checked it is present).
fn call_on(cfg: &JsValue, function: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> {
    let function: &Function = function.dyn_ref().ok_or_else(|| js_sys::TypeError::new(&format!("cfg.{name} is not a function")))?;
    let list = Array::new();
    for value in args {
        list.push(value);
    }
    function.apply(cfg, &list)
}

fn layout_shelves(host: &Host, books: &JsValue, options: &JsValue, prepared: &JsValue) -> R<Array> {
    let cfg = with_defaults(&host.layout, &or_empty(options))?;
    let shelves = Array::new();
    if !Array::is_array(books) || books.unchecked_ref::<Array>().length() == 0 {
        return Ok(shelves);
    }
    let shelf_width = read(&cfg, "shelfWidth")?;
    if !(num(&shelf_width) - num(&read(&cfg, "padding")?) * 2.0 > 0.0) {
        return Ok(shelves);
    }
    let books = items(books);
    let count = books.len();
    let display_width_for = read(&cfg, "displayWidthFor")?;
    let spine = read(&cfg, "spine")?;
    let (mut styles, mut requested) = (Vec::with_capacity(count), Vec::with_capacity(count));
    for (index, book) in books.iter().enumerate() {
        let given = if absent(prepared) { JsValue::UNDEFINED } else { get_at(prepared, index as u32) };
        let style = if absent(&given) { spine_styles(host, &Array::of1(book), &spine)?.get(0) } else { given };
        requested.push(if display_width_for.is_function() { num(&call_on(&cfg, &display_width_for, "displayWidthFor", &[book, &style])?) } else { f64::NAN });
        styles.push(style);
    }

    // Each species takes its real size (`plantWidthFor`); without it, a fixed width.
    let variants = read(&cfg, "plantVariants")?;
    let plant_width_for = read(&cfg, "plantWidthFor")?;
    let width_of = |variant: &JsValue| -> R<JsValue> {
        let value = if absent(&plant_width_for) { JsValue::UNDEFINED } else { call_on(&cfg, &plant_width_for, "plantWidthFor", &[variant])? };
        if absent(&value) { read(&cfg, "plantWidth") } else { Ok(value) }
    };
    let list: &Array = variants.unchecked_ref();
    let species = items(&variants);
    let keys: Vec<f64> = species.iter().map(|variant| f64::from(list.index_of(variant, 0))).collect();
    let widths = species.iter().map(|variant| Ok(num(&width_of(variant)?))).collect::<R<Vec<f64>>>()?;
    let mut distinct = keys.clone();
    distinct.sort_by(f64::total_cmp);
    distinct.dedup();
    let undefined_width = if species.is_empty() || species.len() > 1 && distinct.len() == 1 { width_of(&JsValue::UNDEFINED)? } else { read(&cfg, "plantWidth")? };
    let seeds = styles.iter().map(|style| Ok(text_value(&read(style, "seed")?))).collect::<R<Vec<JsValue>>>()?;
    let (units, offsets) = seed_units(&seeds)?;
    let total = units.len();
    let config = [
        num(&shelf_width), num(&read(&cfg, "padding")?), num(&read(&cfg, "gap")?), num(&read(&cfg, "plantEvery")?), num(&read(&cfg, "plantWidth")?),
        num(&read(&cfg, "maxTailPlants")?), num(&read(&cfg, "tiltThreshold")?), num(&read(&cfg, "maxTilt")?), num(&undefined_width),
    ];
    let spine_widths = styles.iter().map(|style| Ok(num(&read(style, "width")?))).collect::<R<Vec<f64>>>()?;
    let kinds = species.len();
    // The plan, or the length it needs when `capacity` is too small.
    let run = |capacity: usize| -> R<Result<Vec<f64>, usize>> {
        host.in_arena(&[9, kinds, kinds, count, count, count + 1, unit_words(total), capacity], |pointer, at| {
            host.write(pointer, at[0], &config)?;
            host.write(pointer, at[1], &widths)?;
            host.write(pointer, at[2], &keys)?;
            host.write(pointer, at[3], &spine_widths)?;
            host.write(pointer, at[4], &requested)?;
            host.write(pointer, at[5], &offsets)?;
            write_units(host, pointer, at[6], &units)?;
            let p = |index: usize| pointer + (at[index] * 8) as f64;
            let length = host.kernel("layout_shelves", &[p(0), p(1), p(2), kinds as f64, p(3), p(4), p(5), p(6), count as f64, total as f64, p(7), capacity as f64])?;
            if length == 0.0 {
                return Err(js_sys::RangeError::new("Shelf layout: request rejected").into());
            }
            let length = length as usize;
            Ok(if length > capacity { Err(length) } else { Ok(host.f64s(pointer, at[7], length)?.to_vec()) })
        })
    };
    let plan = match run(2 + count * 3 + (count * 2 + 16) * 6)? {
        Ok(plan) => plan,
        Err(length) => match run(length)? {
            Ok(plan) => plan,
            Err(_) => return Err(js_sys::RangeError::new("Shelf layout: request rejected").into()),
        },
    };

    let shelf_count = plan[0] as usize;
    let mut item = 2 + shelf_count * 3;
    for index in 0..shelf_count {
        let at = 2 + index * 3;
        let (item_count, used, free) = (plan[at], plan[at + 1], plan[at + 2]);
        let row = Array::new();
        let mut n = 0.0;
        while n < item_count {
            let [plant, refer, width, tilt, position, salt] = [plan[item], plan[item + 1], plan[item + 2], plan[item + 3], plan[item + 4], plan[item + 5]];
            let width = JsValue::from_f64(width);
            let placed = if plant != 0.0 {
                let variant = if refer < 0.0 { JsValue::UNDEFINED } else { Reflect::get(&variants, &JsValue::from_f64(refer))? };
                let tail = if salt == 0.0 { "mid".to_string() } else { format!("tail-{}", number_string(salt - 1.0)) };
                let seed = format!("shelf-{index}-{}-{tail}", number_string(position));
                object(&[("kind", &"plant".into()), ("variant", &variant), ("width", &width), ("seed", &seed.into())])?
            } else {
                let refer = refer as usize;
                object(&[("kind", &"book".into()), ("book", &books[refer]), ("style", &styles[refer]), ("width", &width), ("displayWidth", &width),
                    ("tilt", &JsValue::from_f64(tilt))])?
            };
            row.push(&placed);
            n += 1.0;
            item += 6;
        }
        let shelf = object(&[("index", &JsValue::from_f64(index as f64)), ("items", &row), ("usedWidth", &JsValue::from_f64(used)),
            ("freeWidth", &JsValue::from_f64(free)), ("width", &shelf_width)])?;
        shelves.push(&shelf);
    }
    Ok(shelves)
}

/// `layoutShelves(books, options = {}, preparedStyles)`: the books packed into fixed-width shelves with pots between
/// them, in the order received.
#[wasm_bindgen]
pub fn shelf_layout_shelves(host: &JsValue, books: &JsValue, options: &JsValue, prepared: &JsValue) -> R<Array> {
    layout_shelves(&Host::of(host)?, books, options, prepared)
}

// ------------------------------------------------------------------------------------------------ sections

thread_local! {
    /// Made on the first sort that needs it: making it at start-up loads the locale's collation data.
    static COMPARE: RefCell<Option<Function>> = const { RefCell::new(None) };
}

fn compare_text() -> Function {
    COMPARE.with(|slot| {
        slot.borrow_mut().get_or_insert_with(|| {
            let options = Object::new();
            let _ = Reflect::set(&options, &"sensitivity".into(), &"base".into());
            let _ = Reflect::set(&options, &"numeric".into(), &JsValue::TRUE);
            js_sys::Intl::Collator::new(&Array::of1(&"es".into()), &options).compare()
        }).clone()
    })
}

/// `value ?? ''`.
fn or_blank(value: JsValue) -> JsValue { if absent(&value) { "".into() } else { value } }

fn sections(host: &Host, books: &JsValue, options: &JsValue) -> R<(Array, JsValue)> {
    let cfg = with_defaults(&host.sections, &or_empty(options))?;
    let found = Array::new();
    let list: Vec<JsValue> = if Array::is_array(books) { items(books).into_iter().filter(truthy).collect() } else { Vec::new() };
    if list.is_empty() {
        return Ok((found, cfg));
    }
    let count = list.len();
    let sort = read(&cfg, "sort")?;
    let mode = if text(&sort, "none") { 0.0 } else if text(&sort, "author") { 1.0 } else { 2.0 };
    let mut rank = vec![0.0; count];
    if mode != 0.0 {
        let compare = compare_text();
        let authors = list.iter().map(|book| Ok(or_blank(read(book, "author")?))).collect::<R<Vec<_>>>()?;
        let titles = list.iter().map(|book| Ok(or_blank(read(book, "title")?))).collect::<R<Vec<_>>>()?;
        let mut failure = None;
        let mut order: Vec<usize> = (0..count).collect();
        order.sort_by(|&a, &b| {
            if failure.is_some() {
                return std::cmp::Ordering::Equal;
            }
            let mut step = |x: &JsValue, y: &JsValue| match compare.call2(&JsValue::UNDEFINED, x, y) {
                Ok(value) => num(&value),
                Err(error) => {
                    failure = Some(error);
                    0.0
                }
            };
            let mut value = if mode == 1.0 { step(&authors[a], &authors[b]) } else { 0.0 };
            if value == 0.0 || value.is_nan() {
                value = step(&titles[a], &titles[b]);
            }
            if value == 0.0 || value.is_nan() {
                value = a as f64 - b as f64;
            }
            if value < 0.0 { std::cmp::Ordering::Less } else if value > 0.0 { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Equal }
        });
        if let Some(error) = failure {
            return Err(error);
        }
        for (position, index) in order.into_iter().enumerate() {
            rank[index] = position as f64;
        }
    }
    let first = Map::new();
    let mut groups = Vec::with_capacity(count);
    let mut data = Vec::with_capacity(count * 5);
    for (index, book) in list.iter().enumerate() {
        if !first.has(book) {
            first.set(book, &JsValue::from_f64(index as f64));
        }
        groups.push(num(&first.get(book)));
        let fraction = get(book, "progressFraction");
        let raw = num(&if absent(&fraction) { get(book, "progress") } else { fraction });
        let opened = read(book, "lastOpenedAt")?;
        let last = num(&opened);
        let order = read(book, "shelfOrder")?.as_f64().filter(|value| value.is_finite()).unwrap_or(f64::INFINITY);
        data.extend_from_slice(&[raw, if absent(&opened) { 0.0 } else { 1.0 }, if last == 0.0 || last.is_nan() { 0.0 } else { last }, order, rank[index]]);
    }
    let config = [num(&read(&cfg, "recentLimit")?), mode];
    let out = host.in_arena(&[2, count * 5, count, count + 2], |pointer, at| {
        host.write(pointer, at[0], &config)?;
        host.write(pointer, at[1], &data)?;
        host.write(pointer, at[2], &groups)?;
        let p = |index: usize| pointer + (at[index] * 8) as f64;
        let length = host.kernel("library_sections", &[p(0), p(1), p(2), count as f64, p(3)])?;
        if length == 0.0 {
            return Err(js_sys::RangeError::new("Shelf sections: request rejected").into());
        }
        Ok(host.f64s(pointer, at[3], length as usize)?.to_vec())
    })?;
    let recent_end = 2 + out[0] as usize;
    let pick = |range: &[f64]| range.iter().map(|&index| list[index as usize].clone()).collect::<Array>();
    let (recent, rest) = (pick(&out[2..recent_end]), pick(&out[recent_end..]));
    if recent.length() > 0 {
        found.push(&object(&[("id", &"recent".into()), ("title", &read(&cfg, "recentTitle")?), ("books", &recent)])?);
    }
    if rest.length() > 0 {
        // The only shelf needs no title: it is plainly everything.
        let title = if found.length() == 0 { "".into() } else { read(&cfg, "libraryTitle")? };
        found.push(&object(&[("id", &"library".into()), ("title", &title), ("books", &rest)])?);
    }
    Ok((found, cfg))
}

/// `buildSections(books, options = {})`: "keep reading" and the library; a book appears in one section only.
#[wasm_bindgen]
pub fn shelf_sections(host: &JsValue, books: &JsValue, options: &JsValue) -> R<Array> { Ok(sections(&Host::of(host)?, books, options)?.0) }

/// `planBookshelf(books, options = {}, prepareStyles)`: the whole library as sections already packed into shelves.
#[wasm_bindgen]
pub fn shelf_plan_bookshelf(host: &JsValue, books: &JsValue, options: &JsValue, prepare: &JsValue) -> R<Array> {
    let host = Host::of(host)?;
    let options = or_empty(options);
    let plan = Array::new();
    for section in items(&sections(&host, books, &options)?.0) {
        let shelved = read(&section, "books")?;
        let count = read(&shelved, "length")?;
        let prepared = if prepare.is_function() {
            let spine = if absent(&options) { JsValue::UNDEFINED } else { get(&options, "spine") };
            prepare.unchecked_ref::<Function>().call2(&JsValue::UNDEFINED, &shelved, &spine)?
        } else {
            JsValue::UNDEFINED
        };
        let shelves = layout_shelves(&host, &shelved, &options, &prepared)?;
        plan.push(&object(&[("id", &read(&section, "id")?), ("title", &read(&section, "title")?), ("count", &count), ("shelves", &shelves)])?);
    }
    Ok(plan)
}
