//! The bookshelf's deterministic layout: the spine style of every book, the
//! packing of spines and pots into fixed-width shelves, the split of the
//! library into sections, and the bookmark ribbon. No DOM and no book objects:
//! the host extracts numbers and seeds, this module owns every decision, and
//! the host builds its object shapes from the answer. All arithmetic keeps the
//! original order in f64 and Math.round / Math.min / Math.max semantics.
//!
//! Hash: FNV-1a (32 bit) over the UTF-16 code units of the text. `unit(seed,
//! salt)` is the hash of `${seed}::${salt}` divided by 2^32, an independent
//! stream per salt from the same seed with no state between calls.
use crate::catalogue::{PALETTE_COUNT, TEXTURE_COUNT};
use crate::jsnum;
use std::cmp::Ordering;

const OFFSET: u32 = 0x811c_9dc5;
const PRIME: u32 = 0x0100_0193;
const MAX_BOOKS: usize = 1 << 20;
const MAX_UNITS: usize = 1 << 25;
/// A shelf never needs this many pots; a request that would is not a layout.
const MAX_TAIL_PLANTS: f64 = 100_000.0;

fn feed(mut state: u32, units: impl IntoIterator<Item = u16>) -> u32 {
    for unit in units { state = (state ^ unit as u32).wrapping_mul(PRIME); }
    state
}
fn text_hash(text: &str) -> u32 { feed(OFFSET, text.encode_utf16()) }
/// unit(seed, salt) for a seed whose hash is `base`.
fn unit_of(base: u32, salt: &str) -> f64 { feed(feed(base, "::".encode_utf16()), salt.encode_utf16()) as f64 / 4_294_967_296.0 }
/// Math.floor(unit * length) % length
fn pick_index(unit: f64, length: usize) -> usize { (unit * length as f64).floor() as usize % length }

unsafe fn view<'a, T>(pointer: *const T, length: usize) -> &'a [T] {
    if length == 0 { &[] } else { std::slice::from_raw_parts(pointer, length) }
}
fn aligned<T>(pointer: *const T) -> bool { !pointer.is_null() && (pointer as usize) % std::mem::align_of::<T>() == 0 }

// ------------------------------------------------------------------ spine styles

const WORDS_PER_PAGE: f64 = 300.0;
const DEFAULT_PAGES: f64 = 320.0;
const CONFIG: usize = 7;
const STYLE: usize = 5;

/// Palette, texture, width, height ratio and seed hash of `count` books.
/// `config`: minWidth, maxWidth, minHeightRatio, maxHeightRatio, pageThickness
/// (NaN when not a number), 1 if the option is truthy in JavaScript, binding
/// thickness (NaN when absent). `words` is each book's
/// word count (NaN when it has none), `offsets` the `count + 1` start
/// positions of the seeds in `units`, `out` receives 5 values per book.
/// Returns 1, or 0 for a rejected request.
/// # Safety
/// Live arrays of the stated lengths; `units` is 2-byte aligned, the rest are
/// 8-byte aligned f64. Nothing is retained.
#[no_mangle]
pub unsafe extern "C" fn spine_styles(config: *const f64, words: *const f64, offsets: *const f64, units: *const u16,
    count: usize, total_units: usize, out: *mut f64) -> u32 {
    if count > MAX_BOOKS || total_units > MAX_UNITS || !aligned(config) || !aligned(out) || (count > 0 && !aligned(words))
        || !aligned(offsets) || (total_units > 0 && !aligned(units)) { return 0; }
    let (cfg, words, offsets, units) = (view(config, CONFIG), view(words, count), view(offsets, count + 1), view(units, total_units));
    let out = std::slice::from_raw_parts_mut(out, count * STYLE);
    let (min_width, max_width, min_height, max_height) = (cfg[0], cfg[1], cfg[2], cfg[3]);
    let thick = cfg[4].is_finite() && cfg[4] > 0.0;
    let decimals = cfg[5] != 0.0;
    let binding = if cfg[6].is_nan() || cfg[6] == 0.0 { 0.0 } else { cfg[6] };
    let (low, high) = (40.0_f64.sqrt(), 900.0_f64.sqrt());
    for index in 0..count {
        let (from, to) = (offsets[index], offsets[index + 1]);
        if !(from >= 0.0 && from <= to && to <= total_units as f64) || from.fract() != 0.0 || to.fract() != 0.0 { return 0; }
        let seed = &units[from as usize..to as usize];
        let base = feed(OFFSET, seed.iter().copied());
        let palette = pick_index(unit_of(base, "palette"), PALETTE_COUNT);
        let texture = pick_index(unit_of(base, "texture"), TEXTURE_COUNT);
        let pages = if words[index].is_finite() && words[index] >= 0.0 { words[index] / WORDS_PER_PAGE } else { DEFAULT_PAGES };
        // Interpolation in root scale: 40 against 200 pages shows more than 700 against 900.
        let ratio = if !pages.is_finite() || pages <= 0.0 { 0.0 } else { jsnum::clamp((pages.sqrt() - low) / (high - low), 0.0, 1.0) };
        let width = if thick { binding + pages * cfg[4] } else { min_width + (max_width - min_width) * ratio };
        let height = min_height + (max_height - min_height) * unit_of(base, "height");
        let clamped = jsnum::clamp(width, min_width, max_width);
        out[index * STYLE..index * STYLE + STYLE].copy_from_slice(&[
            palette as f64, texture as f64,
            if decimals { jsnum::round(clamped * 100.0) / 100.0 } else { jsnum::round(clamped) },
            jsnum::round(height * 1000.0) / 1000.0, base as f64]);
    }
    1
}

// ------------------------------------------------------------------ packing

const ITEM: usize = 6;
const PLACED: usize = 3;
const LAYOUT: usize = 9;

struct Item { plant: bool, refer: i64, width: f64, tilt: f64, position: usize, salt: i32, key: i64, book: usize }
struct Shelf { index: usize, items: Vec<Item>, used: f64 }
struct Config { shelf_width: f64, padding: f64, gap: f64, plant_every: f64, plant_width: f64, max_tail: f64,
    tilt_threshold: f64, max_tilt: f64 }
struct Variants<'a> { widths: &'a [f64], keys: &'a [f64], undefined_width: f64 }

impl Shelf {
    fn cost(&self, gap: f64, width: f64) -> f64 { if self.items.is_empty() { width } else { gap + width } }
    fn push(&mut self, gap: f64, item: Item) { self.used += self.cost(gap, item.width); self.items.push(item); }
}

/// A pot for the shelf being filled; never the same species as its neighbour.
fn plant_item(shelf: &Shelf, variants: &Variants, salt: i32) -> Item {
    let name = if salt == 0 { "mid".to_string() } else { format!("tail-{}", salt - 1) };
    let base = text_hash(&format!("shelf-{}-{}-{}", shelf.index, shelf.items.len(), name));
    let previous = shelf.items.last().filter(|item| item.plant);
    let candidates: Vec<usize> = (0..variants.keys.len())
        .filter(|&i| !(previous.is_some() && variants.keys.len() > 1 && variants.keys[i] == previous.unwrap().key as f64)).collect();
    let (refer, width, key) = if candidates.is_empty() { (-1, variants.undefined_width, -1) } else {
        let chosen = candidates[pick_index(unit_of(base, "variant"), candidates.len())];
        (chosen as i64, variants.widths[chosen], variants.keys[chosen] as i64)
    };
    Item { plant: true, refer, width, tilt: 0.0, position: shelf.items.len(), salt, key, book: 0 }
}

/// Packs books in the order received, one pot every `plant_every` books when
/// the pot and the next book both fit, and closes each shelf with up to
/// `max_tail` pots (or tilts its last book towards the free space).
fn pack(cfg: &Config, variants: &Variants, widths: &[f64], bases: &[u32]) -> Option<Vec<Shelf>> {
    let available = cfg.shelf_width - cfg.padding * 2.0;
    if widths.is_empty() || !(available > 0.0) { return Some(Vec::new()); }
    let mut shelves: Vec<Shelf> = Vec::new();
    let mut shelf = Shelf { index: 0, items: Vec::new(), used: 0.0 };
    let mut since_plant = 0.0_f64;
    let close = |shelf: &mut Shelf, since_plant: &mut f64| -> bool {
        if shelf.items.is_empty() { return true; }
        let room = available - shelf.used;
        if room >= cfg.plant_width + cfg.gap {
            // A half-empty shelf closes with one or two pots: bare space reads as a mistake.
            let mut i = 0.0;
            while i < cfg.max_tail {
                if i >= MAX_TAIL_PLANTS { return false; }
                let tail = plant_item(shelf, variants, 1 + i as i32);
                if available - shelf.used < tail.width + cfg.gap { break; }
                shelf.push(cfg.gap, tail);
                i += 1.0;
            }
            *since_plant = 0.0;
        } else {
            let last = shelf.items.last().unwrap();
            if !last.plant && room >= cfg.tilt_threshold && unit_of(bases[last.book], "tilt") > 0.5 {
                let degrees = jsnum::round((2.0 + unit_of(bases[last.book], "tilt-deg") * (cfg.max_tilt - 2.0)) * 10.0) / 10.0;
                shelf.items.last_mut().unwrap().tilt = degrees;
            }
        }
        true
    };
    for (index, &width) in widths.iter().enumerate() {
        let book = Item { plant: false, refer: index as i64, width, tilt: 0.0, position: 0, salt: -1, key: -1, book: index };
        let mid = if since_plant >= cfg.plant_every && !shelf.items.is_empty() { Some(plant_item(&shelf, variants, 0)) } else { None };
        if let Some(mid) = mid {
            if shelf.used + cfg.gap + mid.width + cfg.gap + book.width <= available {
                shelf.push(cfg.gap, mid);
                since_plant = 0.0;
            }
        }
        if !shelf.items.is_empty() && shelf.used + shelf.cost(cfg.gap, book.width) > available {
            if !close(&mut shelf, &mut since_plant) { return None; }
            let next = shelves.len() + 1;
            shelves.push(std::mem::replace(&mut shelf, Shelf { index: next, items: Vec::new(), used: 0.0 }));
        }
        shelf.push(cfg.gap, book);
        since_plant += 1.0;
    }
    if !close(&mut shelf, &mut since_plant) { return None; }
    if !shelf.items.is_empty() { shelves.push(shelf); }
    Some(shelves)
}

/// Packs the books into shelves. `config`: shelfWidth, padding, gap,
/// plantEvery, plantWidth, maxTailPlants, tiltThreshold, maxTilt, and the
/// width of an absent species. `variants` are the species the host offers:
/// `variant_widths` their slot widths and `variant_keys` equal numbers for
/// equal names. Per book: `widths` (the drawn spine), `requested` (the cell
/// width the host asked for, NaN for none) and its seed in `units`/`offsets`.
/// Output: shelf count, item count, per shelf [items, used, free], per item 6
/// values [pot?, book or species, width, tilt, position, salt]. The result is
/// written when `capacity` allows; the length is returned (0 = rejected).
/// # Safety
/// Live arrays of the stated lengths (see `spine_styles`); `out` is writable
/// for `capacity` f64 values.
#[no_mangle]
pub unsafe extern "C" fn layout_shelves(config: *const f64, variant_widths: *const f64, variant_keys: *const f64,
    variant_count: usize, widths: *const f64, requested: *const f64, offsets: *const f64, units: *const u16,
    count: usize, total_units: usize, out: *mut f64, capacity: usize) -> usize {
    if count > MAX_BOOKS || total_units > MAX_UNITS || variant_count > 4096 || !aligned(config)
        || (variant_count > 0 && (!aligned(variant_widths) || !aligned(variant_keys)))
        || (count > 0 && (!aligned(widths) || !aligned(requested))) || !aligned(offsets)
        || (total_units > 0 && !aligned(units)) || (capacity > 0 && !aligned(out)) { return 0; }
    let cfg = view(config, LAYOUT);
    let config = Config { shelf_width: cfg[0], padding: cfg[1], gap: cfg[2], plant_every: cfg[3], plant_width: cfg[4],
        max_tail: cfg[5], tilt_threshold: cfg[6], max_tilt: cfg[7] };
    let variants = Variants { widths: view(variant_widths, variant_count), keys: view(variant_keys, variant_count), undefined_width: cfg[8] };
    let (styles, requested, offsets, units) = (view(widths, count), view(requested, count), view(offsets, count + 1), view(units, total_units));
    let mut bases = Vec::with_capacity(count);
    let mut displayed = Vec::with_capacity(count);
    for index in 0..count {
        let (from, to) = (offsets[index], offsets[index + 1]);
        if !(from >= 0.0 && from <= to && to <= total_units as f64) || from.fract() != 0.0 || to.fract() != 0.0 { return 0; }
        bases.push(feed(OFFSET, units[from as usize..to as usize].iter().copied()));
        // The cell is the drawn spine unless the host asks for a wider one.
        displayed.push(if requested[index].is_finite() { jsnum::max(styles[index], jsnum::round(requested[index])) } else { styles[index] });
    }
    let Some(shelves) = pack(&config, &variants, &displayed, &bases) else { return 0 };
    let items: usize = shelves.iter().map(|shelf| shelf.items.len()).sum();
    let length = 2 + shelves.len() * PLACED + items * ITEM;
    if capacity >= length && length > 0 {
        let out = std::slice::from_raw_parts_mut(out, length);
        out[0] = shelves.len() as f64; out[1] = items as f64;
        let available = config.shelf_width - config.padding * 2.0;
        let mut at = 2;
        for shelf in &shelves {
            out[at..at + PLACED].copy_from_slice(&[shelf.items.len() as f64, shelf.used, jsnum::max(0.0, available - shelf.used)]);
            at += PLACED;
        }
        for shelf in &shelves {
            for item in &shelf.items {
                out[at..at + ITEM].copy_from_slice(&[if item.plant { 1.0 } else { 0.0 }, item.refer as f64, item.width, item.tilt,
                    item.position as f64, item.salt as f64]);
                at += ITEM;
            }
        }
    }
    length
}

// ------------------------------------------------------------------ sections

const ENTRY: usize = 5;

struct Entry { index: usize, progress: f64, opened: bool, last: f64, order: f64, rank: f64, group: usize }

/// A book being read is started and not finished. `raw` is the host's
/// Number(progressFraction ?? progress): added but never opened (0) and
/// finished books go back to the general shelf; with no progress figure at
/// all, an opened book counts.
#[no_mangle]
pub extern "C" fn book_in_progress(raw: f64, opened: f64) -> u32 {
    (if raw.is_finite() { raw > 0.0 && raw < 1.0 } else { opened != 0.0 }) as u32
}

/// Math.slice(0, end) bound: the number of leading items kept.
fn slice_end(length: usize, end: f64) -> usize {
    if end.is_nan() { return 0; }
    let end = end.trunc();
    if end < 0.0 { (length as f64 + end).max(0.0) as usize } else { end.min(length as f64) as usize }
}

/// Splits the library into the books being read and the rest. `config`:
/// recentLimit, sort mode (0 keep, 1 author, 2 title). Per entry 5 values:
/// raw progress (NaN when none), 1 if it has an opened date, that date (0 when
/// missing), its manual shelf order (Infinity when none) and its position in
/// the collation order the host computed for modes 1 and 2. `groups` gives each
/// entry the first position of the same object: a book already shown among
/// the recent ones leaves the rest, wherever it appears. Output: recent count,
/// rest count, the recent positions, then the rest positions. Returns the
/// length written (0 = rejected).
/// # Safety
/// Live 8-byte aligned arrays of the stated lengths; `out` has `count + 2` slots.
#[no_mangle]
pub unsafe extern "C" fn library_sections(config: *const f64, data: *const f64, groups: *const f64, count: usize, out: *mut f64) -> usize {
    if count > MAX_BOOKS || !aligned(config) || (count > 0 && !(aligned(data) && aligned(groups))) || !aligned(out) { return 0; }
    let (cfg, data, groups) = (view(config, 2), view(data, count * ENTRY), view(groups, count));
    let entries: Vec<Entry> = (0..count).map(|index| {
        let row = &data[index * ENTRY..index * ENTRY + ENTRY];
        Entry { index, progress: row[0], opened: row[1] != 0.0, last: row[2], order: row[3], rank: row[4], group: groups[index] as usize }
    }).collect();
    let mut recent: Vec<&Entry> = entries.iter().filter(|entry| book_in_progress(entry.progress, entry.opened as u8 as f64) == 1).collect();
    recent.sort_by(|a, b| {
        if a.order != b.order { return if a.order - b.order < 0.0 { Ordering::Less } else { Ordering::Greater }; }
        let diff = b.last - a.last;
        if diff.is_nan() { Ordering::Equal } else if diff != 0.0 { if diff < 0.0 { Ordering::Less } else { Ordering::Greater } } else { a.index.cmp(&b.index) }
    });
    recent.truncate(slice_end(recent.len(), cfg[0]));
    let shown: Vec<usize> = recent.iter().map(|entry| entry.group).collect();
    let mut rest: Vec<&Entry> = entries.iter().filter(|entry| !shown.contains(&entry.group)).collect();
    let manual = rest.iter().any(|entry| entry.order.is_finite());
    if manual {
        rest.sort_by(|a, b| if a.order == b.order { Ordering::Equal } else if a.order < b.order { Ordering::Less } else { Ordering::Greater });
    } else if cfg[1] != 0.0 {
        rest.sort_by(|a, b| a.rank.partial_cmp(&b.rank).unwrap_or(Ordering::Equal));
    }
    let out = std::slice::from_raw_parts_mut(out, count + 2);
    out[0] = recent.len() as f64; out[1] = rest.len() as f64;
    for (slot, entry) in recent.iter().chain(rest.iter()).enumerate() { out[2 + slot] = entry.index as f64; }
    2 + recent.len() + rest.len()
}

// ------------------------------------------------------------------ progress and bookmark

/// Progress 0..1: the host's Number(progressFraction ?? progress), 0 when not finite.
#[no_mangle]
pub extern "C" fn progress_of(raw: f64) -> f64 { if raw.is_finite() { jsnum::min(1.0, jsnum::max(0.0, raw)) } else { 0.0 } }

/// The bookmark ribbon of a book: `out` = progress, percent, peek (px above
/// the spine) and finished (0/1). Returns 0 when there is nothing to mark: a
/// position saved on the first page still needs its ribbon, so a locator
/// counts as much as progress.
/// # Safety
/// `out` points to four writable, 8-byte aligned f64 values.
#[no_mangle]
pub unsafe extern "C" fn bookmark_for(raw: f64, has_locator: f64, min_peek: f64, max_peek: f64, out: *mut f64) -> u32 {
    if !aligned(out) { return 0; }
    let progress = progress_of(raw);
    if progress <= 0.0 && has_locator == 0.0 { return 0; }
    let peek = min_peek + (max_peek - min_peek) * progress;
    // Rounded down: 99.6 % is not "finished" and must not read 100 %.
    let percent = if progress >= 1.0 { 100.0 } else { jsnum::max(1.0, (progress * 100.0).floor()) };
    let out = std::slice::from_raw_parts_mut(out, 4);
    out.copy_from_slice(&[progress, percent, jsnum::round(peek * 10.0) / 10.0, if progress >= 1.0 { 1.0 } else { 0.0 }]);
    1
}
