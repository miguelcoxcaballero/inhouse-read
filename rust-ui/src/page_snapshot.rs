//! One-shot images of an already laid out reading page. Opening a book must use its
//! restored page, not a fabricated block of text or the cover thumbnail. Text is
//! painted at the browser's measured glyph positions, so pagination, headings,
//! chosen fonts and images remain tied to the live reader. The DOM, the canvases and
//! the measured rectangles keep their JavaScript identity; every decision is made here
//! and every canvas call is made in the order the page produced it.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Function, JsString, Map, Object, Promise, RegExp, Reflect};
use web_sys::Range;
use crate::eager::{eager, settled};
use crate::host::{absent, clock, construct, get, get_at, global, jmax, jmin, method, method_opt, num, number_string, read, request_frame, set, truthy};

const MAX_EDGE: f64 = 1600.0;
const DECODE_BUDGET: f64 = 1500.0;
// A line whose measured width differs from the font's natural width by more than
// this was stretched by the browser (justified text, word-spacing).
const STRETCH_TOLERANCE: f64 = 0.6;
// Collapsed white space and soft hyphens inside a line measure 0 (or a 1/64 px sliver).
const ZERO_WIDTH: f64 = 0.25;
const SOFT_HYPHEN: u16 = 0xad;
const INITIAL_PROPERTIES: [&str; 5] = ["fontSize", "fontFamily", "fontWeight", "fontStyle", "color"];

thread_local! {
    static LETTER: RegExp = RegExp::new(r"\p{L}", "u");
    static LETTER_BEFORE: RegExp = RegExp::new(r"[\p{L}\p{N}'’]", "u");
    // What ::first-letter styles: the first letter or digit and the punctuation before it.
    static INITIAL: RegExp = RegExp::new(r"^[\s\p{P}\p{S}]*[\p{L}\p{N}]", "u");
    // Zero-width marks that belong to the character before them.
    static ATTACHED: RegExp = RegExp::new(r"[\p{M}‌‍]", "u");
    static PAINT_URL: RegExp = RegExp::new(r#"url\(\s*(['"]?)(.*?)\1\s*\)"#, "gi");
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = parseFloat)]
    fn parse_float(value: &JsValue) -> f64;
    #[wasm_bindgen(js_name = String)]
    fn string(value: &JsValue) -> String;
}

/// The white space of a regular expression `\s`.
fn is_space(unit: u32) -> bool {
    matches!(unit, 9..=13 | 32 | 160 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn units(text: &JsValue) -> Vec<u16> {
    let text: JsString = text.clone().unchecked_into();
    (0..text.length()).map(|index| text.char_code_at(index) as u16).collect()
}
fn from_units(units: &[u16]) -> JsValue { JsString::from_char_code(units).into() }
/// One code point of UTF-16 text and the number of code units it takes.
fn code_point(text: &[u16], at: usize) -> (u32, usize) {
    let first = text[at] as u32;
    if (0xd800..0xdc00).contains(&first) && at + 1 < text.len() && (0xdc00..0xe000).contains(&(text[at + 1] as u32)) {
        (0x10000 + ((first - 0xd800) << 10) + (text[at + 1] as u32 - 0xdc00), 2)
    } else { (first, 1) }
}
/// Does the (non-global) expression match this UTF-16 text? Lone surrogates survive the trip.
fn matches(expression: &'static std::thread::LocalKey<RegExp>, text: &[u16]) -> Result<bool, JsValue> {
    expression.with(|pattern| Ok(method(pattern.as_ref(), "test", &[&from_units(text)])?.is_truthy()))
}
fn object(entries: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let value = Object::new();
    for (name, entry) in entries { set(&value, name, entry)?; }
    Ok(value.into())
}
fn or_else(value: JsValue, otherwise: JsValue) -> JsValue { if truthy(&value) { value } else { otherwise } }
fn document() -> JsValue { get(&global(), "document") }
fn pixel_ratio() -> f64 {
    let ratio = get(&get(&global(), "window"), "devicePixelRatio");
    jmin(2.0, if truthy(&ratio) { num(&ratio) } else { 1.0 })
}

/// `{ left, top, width, height }` copied from a rectangle, or null.
#[wasm_bindgen]
pub fn snapshot_bounds(rect: &JsValue) -> Result<JsValue, JsValue> {
    if !truthy(rect) { return Ok(JsValue::NULL); }
    object(&[("left", get(rect, "left")), ("top", get(rect, "top")), ("width", get(rect, "width")), ("height", get(rect, "height"))])
}

struct Target { canvas: JsValue, context: JsValue, ratio: f64 }
fn canvas_for(width: &JsValue, height: &JsValue, scale: f64) -> Result<Option<Target>, JsValue> {
    let (width, height) = (num(width), num(height));
    if !(width > 0.0 && height > 0.0) { return Ok(None); }
    let ratio = jmin(jmax(1.0, scale), MAX_EDGE / jmax(width, height));
    let canvas = method(&document(), "createElement", &[&"canvas".into()])?;
    set(&canvas, "width", &jmax(1.0, js_sys::Math::round(width * ratio)).into())?;
    set(&canvas, "height", &jmax(1.0, js_sys::Math::round(height * ratio)).into())?;
    let context = method(&canvas, "getContext", &[&"2d".into()])?;
    Ok(if truthy(&context) { Some(Target { canvas, context, ratio }) } else { None })
}
fn target_record(canvas: &JsValue) -> Result<JsValue, JsValue> {
    object(&[("source", canvas.clone()), ("width", get(canvas, "width")), ("height", get(canvas, "height"))])
}

/// Copies before returning: subsequent PDF renders cannot alter the preview.
#[wasm_bindgen]
pub fn snapshot_canvas(source: &JsValue, filter: &JsValue, display_bounds: &JsValue, paper: bool, paper_source: &JsValue) -> Result<JsValue, JsValue> {
    let Some(target) = canvas_for(&get(source, "width"), &get(source, "height"), 1.0)? else { return Ok(JsValue::NULL) };
    set(&target.context, "filter", filter)?;
    let (width, height) = (get(&target.canvas, "width"), get(&target.canvas, "height"));
    method(&target.context, "drawImage", &[source, &0.into(), &0.into(), &width, &height])?;
    let bounds = if truthy(display_bounds) { display_bounds.clone() } else { method(source, "getBoundingClientRect", &[])? };
    let snapshot = object(&[("source", target.canvas.clone()), ("width", width), ("height", height), ("displayBounds", snapshot_bounds(&bounds)?)])?;
    // Physical pages keep the original PDF pixels, without the reader's theme
    // or brightness filters. The separately themed copy is untouched.
    let paper_target = if paper { canvas_for(&get(paper_source, "width"), &get(paper_source, "height"), 1.0)? } else { None };
    if let Some(paper_target) = paper_target {
        set(&paper_target.context, "filter", &"none".into())?;
        method(&paper_target.context, "drawImage", &[paper_source, &0.into(), &0.into(), &get(&paper_target.canvas, "width"), &get(&paper_target.canvas, "height")])?;
        set(&snapshot, "paper", &target_record(&paper_target.canvas)?)?;
    }
    Ok(snapshot)
}

/// Wait for fonts (unless told not to) and two paints: column expansion and CSS
/// background replacement run in rAF, and restored offsets settle in between.
#[wasm_bindgen]
pub fn snapshot_settle(doc: JsValue, options: JsValue) -> Promise {
    eager(async move {
        if get(&options, "waitForFonts") != JsValue::FALSE { settled(get(&get(&doc, "fonts"), "ready")).await?; }
        let frames = Promise::new(&mut |resolve, _| {
            let second = Closure::once_into_js(move |_: JsValue| -> Result<(), JsValue> { request_frame(&resolve)?; Ok(()) });
            let _ = request_frame(&second);
        });
        settled(frames.into()).await
    })
}

/// The filters in force over an element up to the reader viewport, as one value.
#[wasm_bindgen]
pub fn snapshot_filter(element: &JsValue, theme_filter: &JsValue) -> Result<String, JsValue> {
    let mut filters: Vec<String> = Vec::new();
    let mut node = element.clone();
    while truthy(&node) {
        let value = if node == *element && !absent(theme_filter) { theme_filter.clone() } else {
            let view = read(&read(&node, "ownerDocument")?, "defaultView")?;
            get(&method(&view, "getComputedStyle", &[&node])?, "filter")
        };
        if truthy(&value) && value != "none" { filters.push(string(&value)); }
        if method(&read(&node, "classList")?, "contains", &[&"reader-viewport".into()])?.is_truthy() { break; }
        node = get(&node, "parentElement");
    }
    let joined = filters.join(" ");
    Ok(if joined.is_empty() { "none".into() } else { joined })
}

fn unsafe_paint_url(value: &JsValue) -> Result<bool, JsValue> {
    let matches = PAINT_URL.with(|pattern| method(value, "matchAll", &[pattern.as_ref()]))?;
    for found in Array::from(&matches).iter() {
        let url = string(&get_at(&found, 2));
        let url = url.trim();
        if !url.starts_with('#') && !url.starts_with("data:") { return Ok(true); }
    }
    Ok(false)
}

/// Rasterize existing inline SVG without requesting any network resources.
#[wasm_bindgen]
pub fn snapshot_svg(svg: JsValue, options: JsValue, wait: Function, blob_of: Function, data_of: Function, load_image: Function) -> Promise {
    eager(async move {
        let deadline = get(&options, "deadline");
        let deadline = if deadline.is_undefined() { JsValue::from_f64(clock()? + DECODE_BUDGET) } else { deadline };
        let clone = method(&svg, "cloneNode", &[&JsValue::TRUE])?;
        let originals = Array::of1(&svg).concat(&Array::from(&method(&svg, "querySelectorAll", &[&"*".into()])?));
        let copies = Array::of1(&clone).concat(&Array::from(&method(&clone, "querySelectorAll", &[&"*".into()])?));
        const PROPERTIES: [&str; 19] = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
            "stroke-linejoin", "stroke-dasharray", "opacity", "color", "font-family", "font-size", "font-weight", "font-style",
            "letter-spacing", "text-anchor", "dominant-baseline", "visibility"];
        const XLINK: &str = "http://www.w3.org/1999/xlink";
        for index in 0..copies.length() {
            let (element, original) = (copies.get(index), originals.get(index));
            if ["script", "foreignObject", "iframe", "object", "embed"].iter().any(|name| get(&element, "localName") == *name) {
                method(&element, "remove", &[])?;
                continue;
            }
            let view = read(&read(&svg, "ownerDocument")?, "defaultView")?;
            let computed = method(&view, "getComputedStyle", &[&original])?;
            for property in PROPERTIES {
                let value = method(&computed, "getPropertyValue", &[&property.into()])?;
                if truthy(&value) && !unsafe_paint_url(&value)? { method(&get(&element, "style"), "setProperty", &[&property.into(), &value])?; }
            }
            for attribute in Array::from(&get(&element, "attributes")).iter() {
                if string(&get(&attribute, "name")).starts_with("on") { method(&element, "removeAttributeNode", &[&attribute])?; continue; }
                // External stylesheet/paint server URLs cannot be resolved safely inside
                // an SVG image. Embedded fragment references remain within this clone.
                if unsafe_paint_url(&get(&attribute, "value"))? { method(&element, "removeAttributeNode", &[&attribute])?; }
            }
            if get(&element, "localName") == "image" {
                let href = or_else(method(&element, "getAttribute", &[&"href".into()])?, method(&element, "getAttributeNS", &[&XLINK.into(), &"href".into()])?);
                let href = if truthy(&href) { string(&href) } else { String::new() };
                let mut embedded = if href.starts_with("data:") { JsValue::from_str(&href) } else { JsValue::NULL };
                if href.starts_with("blob:") {
                    // The ebook already loaded this local Blob. Reading it performs no
                    // network request; inline data lets SVG-as-image retain illustrations.
                    let attempt = async {
                        let blob = settled(wait.call2(&JsValue::UNDEFINED, &blob_of.call1(&JsValue::UNDEFINED, &href.as_str().into())?, &deadline)?).await?;
                        if num(&get(&blob, "size")) <= 8.0 * 1024.0 * 1024.0 {
                            embedded = settled(wait.call2(&JsValue::UNDEFINED, &data_of.call1(&JsValue::UNDEFINED, &blob)?, &deadline)?).await?;
                        }
                        Ok::<(), JsValue>(())
                    }.await;
                    let _ = attempt; // an unavailable local illustration
                }
                if !truthy(&embedded) { method(&element, "remove", &[])?; continue; }
                method(&element, "removeAttributeNS", &[&XLINK.into(), &"href".into()])?;
                method(&element, "setAttribute", &[&"href".into(), &embedded])?;
            } else {
                for name in ["href", "xlink:href", "src"] {
                    let value = method(&element, "getAttribute", &[&name.into()])?;
                    if truthy(&value) && !string(&value).starts_with('#') { method(&element, "removeAttribute", &[&name.into()])?; }
                }
            }
        }
        for element in Array::from(&method(&clone, "querySelectorAll", &[&"style,link".into()])?).iter() { method(&element, "remove", &[])?; }
        let rect = method(&svg, "getBoundingClientRect", &[])?;
        let (rect_width, rect_height) = (num(&get(&rect, "width")), num(&get(&rect, "height")));
        let scale = jmin(1.0, MAX_EDGE / jmax(rect_width, rect_height));
        let width = jmax(1.0, js_sys::Math::round(rect_width * scale));
        let height = jmax(1.0, js_sys::Math::round(rect_height * scale));
        if !method(&clone, "hasAttribute", &[&"viewBox".into()])?.is_truthy() {
            let view_box = format!("0 0 {} {}", number_string(jmax(1.0, rect_width)), number_string(jmax(1.0, rect_height)));
            method(&clone, "setAttribute", &[&"viewBox".into(), &view_box.into()])?;
        }
        method(&clone, "setAttribute", &[&"width".into(), &width.into()])?;
        method(&clone, "setAttribute", &[&"height".into(), &height.into()])?;
        let style = get(&clone, "style");
        set(&style, "width", &format!("{}px", number_string(width)).into())?;
        set(&style, "height", &format!("{}px", number_string(height)).into())?;
        let markup = method(&construct("XMLSerializer", &[])?, "serializeToString", &[&clone])?;
        let blob = construct("Blob", &[&Array::of1(&markup), &object(&[("type", "image/svg+xml".into())])?])?;
        let url = method(&get(&global(), "URL"), "createObjectURL", &[&blob])?;
        let image = construct("Image", &[])?;
        let mut loaded = false;
        let outcome = async {
            settled(wait.call2(&JsValue::UNDEFINED, &load_image.call2(&JsValue::UNDEFINED, &image, &url)?, &deadline)?).await?;
            loaded = true;
            Ok::<(), JsValue>(())
        }.await;
        set(&image, "onload", &JsValue::NULL)?;
        set(&image, "onerror", &JsValue::NULL)?;
        if !loaded { method_opt(&image, "removeAttribute", &[&"src".into()])?; }
        method(&get(&global(), "URL"), "revokeObjectURL", &[&url])?;
        outcome.map(|_| image)
    })
}

/// Composite visible fixed-layout spread frames into the same reader viewport.
#[wasm_bindgen]
pub fn snapshot_composite(snapshots: &JsValue, options: &JsValue) -> Result<JsValue, JsValue> {
    let snapshots = &Array::from(snapshots);
    let viewport = get(options, "viewport");
    let background = get(options, "background");
    let background = if background.is_undefined() { "#faf9f5".into() } else { background };
    let filter = get(options, "filter");
    let filter = if filter.is_undefined() { "none".into() } else { filter };
    let paper_background = get(options, "paperBackground");
    let scale = pixel_ratio();
    let Some(target) = canvas_for(&get(&viewport, "width"), &get(&viewport, "height"), scale)? else { return Ok(JsValue::NULL) };
    if snapshots.length() == 0 { return Ok(JsValue::NULL); }
    let (canvas, context) = (&target.canvas, &target.context);
    set(context, "filter", &filter)?;
    set(context, "fillStyle", &background)?;
    method(context, "fillRect", &[&0.into(), &0.into(), &get(canvas, "width"), &get(canvas, "height")])?;
    set(context, "filter", &"none".into())?; // each frame has its final reading filters already
    for snapshot in snapshots.iter() {
        method(context, "drawImage", &[&get(&snapshot, "source"), &0.into(), &0.into(), &get(canvas, "width"), &get(canvas, "height")])?;
    }
    let texts = Array::new();
    for snapshot in snapshots.iter() { let text = get(&snapshot, "text"); if truthy(&text) { texts.push(&text); } }
    let composite = object(&[("source", canvas.clone()), ("width", get(canvas, "width")), ("height", get(canvas, "height")),
        ("displayBounds", snapshot_bounds(&viewport)?), ("text", texts.join(" ").into())])?;
    // The physical paper copy uses the same spread geometry, with no reader filter.
    let every_paper = snapshots.iter().all(|snapshot| truthy(&get(&get(&snapshot, "paper"), "source")));
    let paper = if !absent(&paper_background) && every_paper { canvas_for(&get(&viewport, "width"), &get(&viewport, "height"), scale)? } else { None };
    if let Some(paper) = paper {
        set(&paper.context, "filter", &"none".into())?;
        set(&paper.context, "fillStyle", &paper_background)?;
        method(&paper.context, "fillRect", &[&0.into(), &0.into(), &get(&paper.canvas, "width"), &get(&paper.canvas, "height")])?;
        for snapshot in snapshots.iter() {
            method(&paper.context, "drawImage", &[&get(&get(&snapshot, "paper"), "source"), &0.into(), &0.into(), &get(&paper.canvas, "width"), &get(&paper.canvas, "height")])?;
        }
        set(&composite, "paper", &target_record(&paper.canvas)?)?;
    }
    Ok(composite)
}

fn color_key(value: &JsValue) -> String {
    let text = if truthy(value) { string(value) } else { String::new() };
    let text = JsString::from(text).trim().to_lower_case().as_string().unwrap_or_default();
    if text.len() == 7 && text.starts_with('#') && text[1..].chars().all(|digit| matches!(digit, '0'..='9' | 'a'..='f')) {
        let channel = |at: usize| u8::from_str_radix(&text[at..at + 2], 16).unwrap_or(0);
        return format!("rgb({},{},{})", channel(1), channel(3), channel(5));
    }
    text.chars().filter(|character| !is_space(*character as u32)).collect()
}
/// Does a computed CSS colour (rgb()) equal a theme colour (#rrggbb)?
#[wasm_bindgen]
pub fn snapshot_same_color(a: &JsValue, b: &JsValue) -> bool { truthy(a) && truthy(b) && color_key(a) == color_key(b) }

fn style_decorations(element: &JsValue, style_of: &mut impl FnMut(&JsValue) -> Result<JsValue, JsValue>) -> Result<Vec<(JsValue, JsValue)>, JsValue> {
    let mut lines = Vec::new();
    let mut node = element.clone();
    while truthy(&node) {
        let style = style_of(&node)?;
        let line = get(&style, "textDecorationLine");
        if truthy(&line) && line != "none" { lines.push((line, or_else(get(&style, "textDecorationColor"), get(&style, "color")))); }
        if !method(&get(&style, "display"), "startsWith", &[&"inline".into()])?.is_truthy() { break; }
        node = get(&node, "parentElement");
    }
    Ok(lines)
}

#[derive(Clone)]
struct Glyph { text: Vec<u16>, left: f64, right: f64, space: bool }
struct Run { left: f64, right: f64, top: f64, height: f64, direction: Option<&'static str>, initial: JsValue, chars: Vec<Glyph>, text: Vec<u16>, hyphen: bool }
struct Rect { left: f64, top: f64, right: f64, bottom: f64, width: f64, height: f64 }
fn read_rect(rect: &JsValue) -> Rect {
    let field = |name: &str| num(&get(rect, name));
    Rect { left: field("left"), top: field("top"), right: field("right"), bottom: field("bottom"), width: field("width"), height: field("height") }
}
struct Bounds { left: f64, top: f64, right: f64, bottom: f64 }
fn intersects(rect: &Rect, bounds: &Bounds) -> bool {
    rect.width > 0.0 && rect.height > 0.0 && rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom
}
/// `[...range.getClientRects()]`.
fn client_rects(range: &Range) -> Result<Vec<JsValue>, JsValue> {
    let list = method(range, "getClientRects", &[])?;
    let length = num(&get(&list, "length"));
    Ok((0..if length.is_finite() && length > 0.0 { length as u32 } else { 0 }).map(|index| get_at(&list, index)).collect())
}
fn font_size_of(style: &JsValue, fallback: f64) -> f64 { let size = parse_float(&get(style, "fontSize")); if size != 0.0 && !size.is_nan() { size } else { fallback } }

/// Paints into the page canvas and, when asked, into its twin on physical white paper.
struct Painter { all: Vec<JsValue>, ctx: JsValue, paper_ctx: Option<JsValue>, paper: JsValue, offset_x: f64, offset_y: f64 }
impl Painter {
    fn set_ink(&self, color: &JsValue) -> Result<(), JsValue> {
        set(&self.ctx, "fillStyle", &or_else(color.clone(), "#292821".into()))?;
        if let Some(paper_ctx) = &self.paper_ctx {
            // Only the theme's own ink becomes dark paper ink; a publisher's own colour stays.
            let value = if snapshot_same_color(color, &get(&self.paper, "themeColor")) { get(&self.paper, "color") } else { get(&self.ctx, "fillStyle") };
            set(paper_ctx, "fillStyle", &value)?;
        }
        Ok(())
    }
    fn set_font(&self, source: &JsValue, size: f64) -> Result<(f64, f64), JsValue> {
        let font = format!("{} {} {}px {}", string(&or_else(get(source, "fontStyle"), "normal".into())),
            string(&or_else(get(source, "fontWeight"), "400".into())), number_string(size), string(&or_else(get(source, "fontFamily"), "serif".into())));
        for c in &self.all {
            set(c, "font", &font.as_str().into())?;
            if Reflect::has(c, &"fontVariantCaps".into())? { set(c, "fontVariantCaps", &or_else(get(source, "fontVariantCaps"), "normal".into()))?; }
            if Reflect::has(c, &"letterSpacing".into())? {
                let spacing = get(source, "letterSpacing");
                set(c, "letterSpacing", &if !truthy(&spacing) || spacing == "normal" { "0px".into() } else { spacing })?;
            }
            set(c, "textBaseline", &"alphabetic".into())?;
        }
        let metrics = method(&self.ctx, "measureText", &[&"Hg".into()])?;
        let (ascent, descent) = (get(&metrics, "fontBoundingBoxAscent"), get(&metrics, "fontBoundingBoxDescent"));
        Ok((if truthy(&ascent) { num(&ascent) } else { size * 0.8 }, if truthy(&descent) { num(&descent) } else { size * 0.2 }))
    }
    fn put(&self, glyphs: &[u16], x: f64, baseline: f64) -> Result<(), JsValue> {
        let text = from_units(glyphs);
        for c in &self.all { method(c, "fillText", &[&text, &(x - self.offset_x).into(), &baseline.into()])?; }
        Ok(())
    }
    fn width_of(&self, glyphs: &[u16]) -> Result<f64, JsValue> {
        Ok(num(&get(&method(&self.ctx, "measureText", &[&from_units(glyphs)])?, "width")))
    }
}

/// The text of one node being painted: its style, its inks and the runs it has produced.
struct Text<'a> { painter: &'a Painter, style: &'a JsValue, font_size: f64, base_face: (f64, f64), base_direction: JsValue, lines: Vec<(JsValue, JsValue)> }
impl Text<'_> {
    /// A run is one stretch of one line, painted in one go. A line the browser
    /// stretched (justification, word-spacing) is painted word by word, each at
    /// its measured position, instead of with the font's natural spacing.
    fn paint(&self, run: &Run, visible: &mut Vec<Vec<u16>>) -> Result<(), JsValue> {
        let painter = self.painter;
        let initial = truthy(&run.initial);
        let size = if initial { font_size_of(&run.initial, self.font_size) } else { self.font_size };
        let face = if initial { painter.set_font(&run.initial, size)? } else { self.base_face };
        if initial { painter.set_ink(&get(&run.initial, "color"))?; }
        let direction = match run.direction { Some(direction) => JsValue::from_str(direction), None => self.base_direction.clone() };
        let reverse = direction == "rtl";
        for c in &painter.all {
            set(c, "direction", &direction)?;
            set(c, "textAlign", &if reverse { "right" } else { "left" }.into())?;
        }
        let anchor = |item: &Glyph| if reverse { item.right } else { item.left };
        let baseline = run.top - painter.offset_y + (run.height - face.0 - face.1) / 2.0 + face.0;
        let hyphen: &[u16] = if run.hyphen { &[45] } else { &[] };
        let glyphs: Vec<u16> = run.chars.iter().flat_map(|item| item.text.iter().copied()).collect();
        let stretch = run.right - run.left - painter.width_of(&glyphs)?;
        let joined = |text: &[u16], tail: &[u16]| -> Vec<u16> { text.iter().chain(tail).copied().collect() };
        if !(stretch > STRETCH_TOLERANCE) {
            painter.put(&joined(&glyphs, hyphen), if reverse { run.right } else { run.left }, baseline)?;
        } else {
            let mut word: Vec<&Glyph> = Vec::new();
            let emit = |word: &mut Vec<&Glyph>, last: bool| -> Result<(), JsValue> {
                if word.is_empty() { return Ok(()); }
                let tail: &[u16] = if last { hyphen } else { &[] };
                let text: Vec<u16> = word.iter().flat_map(|item| item.text.iter().copied()).collect();
                let width = word.iter().fold(f64::NEG_INFINITY, |a, item| jmax(a, item.right)) - word.iter().fold(f64::INFINITY, |a, item| jmin(a, item.left));
                // Words that do not match their natural width (letter-spaced scripts,
                // tabular figures) keep their characters where they are.
                if !(width - painter.width_of(&text)? > STRETCH_TOLERANCE) {
                    painter.put(&joined(&text, tail), anchor(word[0]), baseline)?;
                } else {
                    for item in word.iter() { painter.put(&item.text, anchor(item), baseline)?; }
                    if !tail.is_empty() {
                        let end = word[word.len() - 1];
                        painter.put(tail, if reverse { end.left - painter.width_of(tail)? } else { end.right }, baseline)?;
                    }
                }
                word.clear();
                Ok(())
            };
            for item in &run.chars { if item.space { emit(&mut word, false)?; } else { word.push(item); } }
            emit(&mut word, true)?;
        }
        let inked: Vec<&Glyph> = run.chars.iter().filter(|item| !item.space).collect();
        if !self.lines.is_empty() && !inked.is_empty() {
            let left = inked.iter().fold(f64::INFINITY, |a, item| jmin(a, item.left));
            let right = inked.iter().fold(f64::NEG_INFINITY, |a, item| jmax(a, item.right));
            let thickness = jmax(1.0, js_sys::Math::round(size / 18.0 * 4.0) / 4.0);
            for (line, color) in &self.lines {
                let line = string(line);
                for (kind, y) in [("underline", baseline + size * 0.12), ("line-through", baseline - size * 0.3)] {
                    if !line.contains(kind) { continue; }
                    for (which, c) in painter.all.iter().enumerate() {
                        let ink = if which > 0 && snapshot_same_color(color, &get(&painter.paper, "themeColor")) { get(&painter.paper, "color") } else { or_else(color.clone(), "#292821".into()) };
                        set(c, "fillStyle", &ink)?;
                        method(c, "fillRect", &[&(left - painter.offset_x).into(), &(y - thickness / 2.0).into(), &(right - left).into(), &thickness.into()])?;
                    }
                }
            }
            painter.set_ink(&if initial { get(&run.initial, "color") } else { get(self.style, "color") })?;
        }
        visible.push(run.text.clone());
        if initial { painter.set_font(self.style, self.font_size)?; painter.set_ink(&get(self.style, "color"))?; }
        Ok(())
    }
}

/// Computed styles of the ancestors, shared by the text nodes, and the `::first-letter` look of each block.
struct Styles { view: JsValue, document: JsValue, known: Map, letters: Map }
impl Styles {
    fn of(&self, element: &JsValue) -> Result<JsValue, JsValue> {
        let known = self.known.get(element);
        if truthy(&known) { return Ok(known); }
        let value = method(&self.view, "getComputedStyle", &[element])?;
        self.known.set(element, &value);
        Ok(value)
    }
    /// `(length, style)` of the ::first-letter group (drop caps, enlarged initials) when `node` opens its block.
    fn initial(&self, node: &JsValue, start: u32) -> Result<Option<(usize, JsValue)>, JsValue> {
        if start > 0 { return Ok(None); }
        let found = INITIAL.with(|pattern| method(pattern.as_ref(), "exec", &[&get(node, "nodeValue")]))?;
        let block = get(node, "parentElement");
        if !truthy(&found) || !truthy(&block) || method(&get(&self.of(&block)?, "display"), "startsWith", &[&"inline".into()])?.is_truthy() { return Ok(None); }
        if !self.letters.has(&block) {
            let own = self.of(&block)?;
            let pseudo = method(&self.view, "getComputedStyle", &[&block, &"::first-letter".into()])?;
            let differs = parse_float(&get(&pseudo, "fontSize")) > 0.0 && INITIAL_PROPERTIES.iter().any(|name| get(&pseudo, name) != get(&own, name));
            self.letters.set(&block, &if differs { pseudo } else { JsValue::NULL });
        }
        let pseudo = self.letters.get(&block);
        if !truthy(&pseudo) { return Ok(None); }
        let first = method(&self.document, "createTreeWalker", &[&block, &4.into()])?;
        let mut text = method(&first, "nextNode", &[])?;
        while truthy(&text) && !truthy(&method(&get(&text, "nodeValue"), "trim", &[])?) { text = method(&first, "nextNode", &[])?; }
        Ok(if text == *node { Some((num(&get(&get_at(&found, 0), "length")) as usize, pseudo)) } else { None })
    }
}

/// The ranges of `from..to` that touch the visible bounds, found by halving: a single
/// paragraph can contain an entire novel, and off-page text must not cost a layout
/// query per character (also for long PDF reflow paragraphs).
fn visible_chunks(measured: &Range, node: &JsValue, text: &[u16], from: u32, to: u32, bounds: &Bounds, segments: &mut Vec<(u32, u32)>) -> Result<(), JsValue> {
    let target: &web_sys::Node = node.unchecked_ref();
    measured.set_start(target, from)?;
    measured.set_end(target, to)?;
    if !client_rects(measured)?.iter().any(|rect| intersects(&read_rect(rect), bounds)) { return Ok(()); }
    if to - from <= 128 { segments.push((from, to)); return Ok(()); }
    let mut middle = (from + to) / 2;
    if (0xdc00..=0xdfff).contains(&text[middle as usize]) { middle += 1; }
    visible_chunks(measured, node, text, from, middle, bounds, segments)?;
    visible_chunks(measured, node, text, middle, to, bounds, segments)
}

/// The code unit before `at` as a one-unit string, or `otherwise` when there is none.
fn unit_before(text: &[u16], at: usize, otherwise: &[u16]) -> Vec<u16> { if at > 0 { vec![text[at - 1]] } else { otherwise.to_vec() } }

/// Paint every visible character of the text nodes under `root`; returns the text that was painted.
fn paint_text(painter: &Painter, root: &JsValue, range: &JsValue, bounds: &Bounds) -> Result<Vec<Vec<u16>>, JsValue> {
    let document = get(root, "ownerDocument");
    let walker = method(&document, "createTreeWalker", &[root, &4.into()])?;
    let measured: Range = method(&document, "createRange", &[])?.unchecked_into();
    let styles = Styles { view: get(&document, "defaultView"), document: document.clone(), known: Map::new(), letters: Map::new() };
    let mut visible = Vec::new();
    loop {
        let node = method(&walker, "nextNode", &[])?;
        if !truthy(&node) { break; }
        let value = get(&node, "nodeValue");
        if !truthy(&value) || !truthy(&method(&value, "trim", &[])?) { continue; }
        let parent = get(&node, "parentElement");
        if truthy(&parent) && truthy(&method(&parent, "closest", &[&"script,style,noscript,svg".into()])?) { continue; }
        if truthy(range) && !method(range, "intersectsNode", &[&node])?.is_truthy() { continue; }
        let text = units(&value);
        let start = if get(range, "startContainer") == node { num(&get(range, "startOffset")) } else { 0.0 };
        let end = if get(range, "endContainer") == node { num(&get(range, "endOffset")) } else { text.len() as f64 };
        if end <= start { continue; }
        let mut segments = Vec::new();
        visible_chunks(&measured, &node, &text, start as u32, end as u32, bounds, &mut segments)?;
        if segments.is_empty() { continue; }
        let style = styles.of(&parent)?;
        let color = get(&style, "color");
        if get(&style, "display") == "none" || color == "transparent" || color == "rgba(0, 0, 0, 0)" { continue; }
        let initial = styles.initial(&node, start as u32)?;
        let base_direction = or_else(get(&style, "direction"), "ltr".into());
        let font_size = font_size_of(&style, 20.0);
        let base_face = painter.set_font(&style, font_size)?;
        painter.set_ink(&color)?;
        let lines = style_decorations(&parent, &mut |element| styles.of(element))?;
        let transform = get(&style, "textTransform");
        // The generated hyphen of `hyphens:auto` (and of a soft hyphen) is not a text character.
        let hyphenates = get(&style, "hyphens") == "auto" && or_else(get(&style, "overflowWrap"), "normal".into()) == "normal"
            && or_else(get(&style, "wordBreak"), "normal".into()) == "normal";
        let paint = Text { painter, style: &style, font_size, base_face, base_direction, lines };
        let mut run: Option<Run> = None;
        for (from, to) in segments {
            let slice = &text[from as usize..to as usize];
            let mut index = from as usize;
            let mut cursor = 0;
            while cursor < slice.len() {
                let (point, width) = code_point(slice, cursor);
                let character = &slice[cursor..cursor + width];
                cursor += width;
                let at = index;
                index += width;
                measured.set_start(node.unchecked_ref(), at as u32)?;
                measured.set_end(node.unchecked_ref(), index as u32)?;
                // A character that wraps carries two rects: the line-end hyphen of a
                // soft hyphen leaks into the next character's list. The last one is its own.
                let rect = client_rects(&measured)?.pop().map(|rect| read_rect(&rect));
                // Collapsed white space and zero-width marks occupy no space: they neither paint nor break the line.
                let Some(rect) = rect.filter(|rect| !(rect.width < ZERO_WIDTH)) else {
                    // A mark, joiner or variation selector has no width of its own: it is drawn with the character before it.
                    if let Some(open) = run.as_mut() {
                        if let Some(last) = open.chars.last_mut() {
                            if !last.space && matches(&ATTACHED, character)? { last.text.extend_from_slice(character); open.text.extend_from_slice(character); }
                        }
                    }
                    continue;
                };
                if !intersects(&rect, bounds) { if let Some(open) = run.take() { paint.paint(&open, &mut visible)?; } continue; }
                let variant = match &initial { Some((length, style)) if at < *length => style.clone(), _ => JsValue::NULL };
                let capital = transform == "capitalize" && !matches(&LETTER_BEFORE, &unit_before(&text, at, &[32]))?;
                let glyph: Vec<u16> = if character == [SOFT_HYPHEN] { vec![45] }
                    else if transform == "uppercase" || capital { units(&JsValue::from(JsString::from_char_code(character).to_locale_upper_case(None))) }
                    else if transform == "lowercase" { units(&JsValue::from(JsString::from_char_code(character).to_locale_lower_case(None))) }
                    else { character.to_vec() };
                let space = is_space(point);
                let previous = run.as_ref().and_then(|open| open.chars.last().map(|last| (open.top, open.height, last.clone())));
                // The code points of one glyph (emoji sequences, flags, a base letter and its accent) all report the rect of the whole glyph.
                if let Some((top, height, last)) = &previous {
                    if !last.space && !space && character != [SOFT_HYPHEN]
                        && (rect.left - last.left).abs() < 0.5 && (rect.right - last.right).abs() < 0.5
                        && (top - rect.top).abs() <= 1.0 && (height - rect.height).abs() <= 1.0 {
                        let open = run.as_mut().unwrap();
                        open.chars.last_mut().unwrap().text.extend_from_slice(&glyph);
                        open.text.extend_from_slice(character);
                        continue;
                    }
                }
                // The way the characters advance tells their direction: right for left-to-right
                // text, left for right-to-left, so mixed scripts in one paragraph keep their own runs.
                let way: Option<&'static str> = previous.as_ref().and_then(|(_, _, last)| {
                    if (rect.left - last.right).abs() <= 2.0 && (rect.right - last.left).abs() <= 2.0 { Some("either") }
                    else if (rect.left - last.right).abs() <= 2.0 { Some("ltr") }
                    else if (rect.right - last.left).abs() <= 2.0 { Some("rtl") }
                    else { None }
                });
                let joins = match (&run, way) {
                    (Some(open), Some(way)) => open.initial == variant && (open.top - rect.top).abs() <= 1.0 && (open.height - rect.height).abs() <= 1.0
                        && (way == "either" || open.direction.is_none() || open.direction == Some(way)),
                    _ => false,
                };
                if !joins {
                    // Same word on the next line: the browser broke it with a hyphen it generated.
                    if let Some(open) = run.as_mut() {
                        if hyphenates && rect.top > open.top + open.height / 2.0 && at > 0
                            && matches(&LETTER, &[text[at - 1]])? && matches(&LETTER, character)? { open.hyphen = true; }
                    }
                    if let Some(open) = run.take() { paint.paint(&open, &mut visible)?; }
                    run = Some(Run { left: rect.left, right: rect.right, top: rect.top, height: rect.height, direction: None, initial: variant, chars: Vec::new(), text: Vec::new(), hyphen: false });
                } else {
                    let open = run.as_mut().unwrap();
                    if way != Some("either") && open.direction.is_none() { open.direction = way; }
                    open.left = jmin(open.left, rect.left);
                    open.right = jmax(open.right, rect.right);
                }
                let open = run.as_mut().unwrap();
                open.chars.push(Glyph { text: glyph, left: rect.left, right: rect.right, space });
                if character != [SOFT_HYPHEN] { open.text.extend_from_slice(character); }
            }
        }
        if let Some(open) = run.take() { paint.paint(&open, &mut visible)?; }
    }
    Ok(visible)
}

/// `texts.join(' ').replace(/\s+/g, ' ').trim()`.
fn collapse(texts: &[Vec<u16>]) -> Vec<u16> {
    let mut out: Vec<u16> = Vec::new();
    let mut pending = false;
    let joined = texts.iter().enumerate().flat_map(|(index, text)| (if index > 0 { Some(32u16) } else { None }).into_iter().chain(text.iter().copied()));
    for unit in joined {
        if is_space(unit as u32) { pending = true; continue; }
        if pending && !out.is_empty() { out.push(32); }
        pending = false;
        out.push(unit);
    }
    out
}

/// Snapshot DOM in its actual visible viewport, including iframe offset after a
/// Foliate column/CFI jump. No HTML serialization or remote image requests. This
/// is safe to use as a GPU canvas texture even with external ebook images.
#[wasm_bindgen]
pub fn snapshot_dom_page(root: JsValue, options: JsValue, wait: Function, blob_of: Function, data_of: Function, load_image: Function) -> Promise {
    eager(async move {
        let option = |name: &str, default: JsValue| { let value = get(&options, name); if value.is_undefined() { default } else { value } };
        let viewport = get(&options, "viewport");
        if !truthy(&root) || !truthy(&viewport) { return Ok(JsValue::NULL); }
        let (offset_x, offset_y) = (num(&option("offsetX", 0.into())), num(&option("offsetY", 0.into())));
        let background = option("background", "#faf9f5".into());
        let filter = option("filter", "none".into());
        let (scale_x, scale_y) = (num(&option("coordinateScaleX", 1.into())), num(&option("coordinateScaleY", 1.into())));
        let (range, clip, paper) = (get(&options, "range"), get(&options, "clipBounds"), get(&options, "paper"));
        let deadline = { let value = get(&options, "deadline"); if value.is_undefined() { JsValue::from_f64(clock()? + DECODE_BUDGET) } else { value } };
        let doc = get(&root, "ownerDocument");
        let (view_width, view_height) = (get(&viewport, "width"), get(&viewport, "height"));
        let Some(target) = canvas_for(&view_width, &view_height, pixel_ratio())? else { return Ok(JsValue::NULL) };
        let (canvas, ctx, ratio) = (target.canvas, target.context, target.ratio);
        // `paper` ({ background, color, themeColor }) paints the very same laid out
        // page a second time on physical white paper: the layout (the expensive part)
        // is measured once, text and background are drawn on both canvases and
        // images, which no theme recolours, are shared.
        let paper_target = if truthy(&paper) { canvas_for(&view_width, &view_height, pixel_ratio())? } else { None };
        let paper_ctx = paper_target.as_ref().map(|paper| paper.context.clone());
        let mut all = vec![ctx.clone()];
        if let Some(paper_ctx) = &paper_ctx { all.push(paper_ctx.clone()); }
        let (view_w, view_h) = (num(&view_width), num(&view_height));
        for (index, c) in all.iter().enumerate() {
            method(c, "scale", &[&(ratio * scale_x).into(), &(ratio * scale_y).into()])?;
            if truthy(&clip) {
                method(c, "beginPath", &[])?;
                method(c, "rect", &[&((num(&get(&clip, "left")) - num(&get(&viewport, "left"))) / scale_x).into(),
                    &((num(&get(&clip, "top")) - num(&get(&viewport, "top"))) / scale_y).into(),
                    &(num(&get(&clip, "width")) / scale_x).into(), &(num(&get(&clip, "height")) / scale_y).into()])?;
                method(c, "clip", &[])?;
            }
            set(c, "filter", &if index > 0 { "none".into() } else { filter.clone() })?;
            set(c, "fillStyle", &if index > 0 { get(&paper, "background") } else { background.clone() })?;
            method(c, "fillRect", &[&0.into(), &0.into(), &(view_w / scale_x).into(), &(view_h / scale_y).into()])?;
        }
        let bounds = Bounds { left: offset_x, top: offset_y, right: offset_x + view_w / scale_x, bottom: offset_y + view_h / scale_y };

        // Blob/data ebook resources are same-origin. Cross-origin images are omitted
        // rather than poisoning the canvas and preventing WebGL from uploading it.
        let images = Array::new();
        if get(&root, "localName") == "svg" { images.push(&root); }
        for image in Array::from(&method(&root, "querySelectorAll", &[&"img, canvas, svg".into()])?).iter() { images.push(&image); }
        for image in images.iter() {
            let parent = get(&image, "parentElement");
            if truthy(&parent) && truthy(&method(&parent, "closest", &[&"svg".into()])?) { continue; } // rasterize nested SVG once with its parent
            let rect = read_rect(&method(&image, "getBoundingClientRect", &[])?);
            if !intersects(&rect, &bounds) { continue; }
            if get(&image, "localName") == "img" {
                let url = string(&or_else(or_else(get(&image, "currentSrc"), get(&image, "src")), "".into()));
                if !url.starts_with("blob:") && !url.starts_with("data:") {
                    let origin = construct("URL", &[&url.as_str().into(), &get(&doc, "baseURI")]).map(|parsed| get(&parsed, "origin"));
                    match origin { Ok(origin) if origin == get(&get(&get(&global(), "window"), "location"), "origin") => {}, _ => continue }
                }
                let decoded = async {
                    let decoding = method_opt(&image, "decode", &[])?.unwrap_or(JsValue::UNDEFINED);
                    settled(wait.call2(&JsValue::UNDEFINED, &decoding, &deadline)?).await
                }.await;
                if decoded.is_err() { continue; }
            }
            let drawn = async {
                let source = if get(&image, "localName") == "svg" {
                    settled(snapshot_svg(image.clone(), object(&[("deadline", deadline.clone())])?, wait.clone(), blob_of.clone(), data_of.clone(), load_image.clone()).into()).await?
                } else { image.clone() };
                for c in &all {
                    method(c, "drawImage", &[&source, &(rect.left - offset_x).into(), &(rect.top - offset_y).into(), &rect.width.into(), &rect.height.into()])?;
                }
                Ok::<(), JsValue>(())
            }.await;
            let _ = drawn; // missing embedded image
        }

        let painter = Painter { all, ctx, paper_ctx, paper, offset_x, offset_y };
        let visible = paint_text(&painter, &root, &range, &bounds)?;
        let mut entries = vec![("source", canvas.clone()), ("width", get(&canvas, "width")), ("height", get(&canvas, "height")),
            ("displayBounds", snapshot_bounds(&viewport)?), ("text", from_units(&collapse(&visible)))];
        if let Some(paper) = &paper_target { entries.push(("paper", target_record(&paper.canvas)?)); }
        object(&entries)
    })
}
