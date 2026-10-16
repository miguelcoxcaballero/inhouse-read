//! The paper and board textures of a book, painted on the 2D context the host hands over: the
//! page edges' atlas, the endpaper, the thumbnail's page block, the joint, edges and corners of a
//! board, and the lettering of a plain cloth case. Each makes the same calls in the same order with
//! the same numbers as the JavaScript it replaces (tests/unit/helpers/reference-book-paint.js),
//! so the pixels are the ones the page always drew: sines come from the engine's own Math, numbers
//! become text the way the engine prints them, and a stream of random numbers the cloth painter
//! began is continued through the host's function rather than copied.
use std::f64::consts::PI;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array, Function, JsString, Math};
use crate::host::{absent, get, jmax, jmin, js_round, method_opt, number_string, num};

#[wasm_bindgen]
extern "C" {
    /// A CanvasRenderingContext2D, or whatever stands in for one.
    pub type Canvas2d;
    #[wasm_bindgen(method, js_name = fillRect)] fn fill_rect(this: &Canvas2d, x: f64, y: f64, width: f64, height: f64);
    #[wasm_bindgen(method, js_name = strokeRect)] fn stroke_rect(this: &Canvas2d, x: f64, y: f64, width: f64, height: f64);
    #[wasm_bindgen(method, js_name = beginPath)] fn begin_path(this: &Canvas2d);
    #[wasm_bindgen(method, js_name = moveTo)] fn move_to(this: &Canvas2d, x: f64, y: f64);
    #[wasm_bindgen(method, js_name = lineTo)] fn line_to(this: &Canvas2d, x: f64, y: f64);
    #[wasm_bindgen(method, js_name = quadraticCurveTo)] fn quadratic_curve_to(this: &Canvas2d, cx: f64, cy: f64, x: f64, y: f64);
    #[wasm_bindgen(method, js_name = closePath)] fn close_path(this: &Canvas2d);
    #[wasm_bindgen(method)] fn stroke(this: &Canvas2d);
    #[wasm_bindgen(method)] fn fill(this: &Canvas2d);
    #[wasm_bindgen(method)] fn save(this: &Canvas2d);
    #[wasm_bindgen(method)] fn restore(this: &Canvas2d);
    #[wasm_bindgen(method)] fn translate(this: &Canvas2d, x: f64, y: f64);
    #[wasm_bindgen(method)] fn rotate(this: &Canvas2d, angle: f64);
    #[wasm_bindgen(method, js_name = createLinearGradient)] fn linear_gradient(this: &Canvas2d, x0: f64, y0: f64, x1: f64, y1: f64) -> JsValue;
    #[wasm_bindgen(method, js_name = createRadialGradient)] fn radial_gradient(this: &Canvas2d, x0: f64, y0: f64, r0: f64, x1: f64, y1: f64, r1: f64) -> JsValue;
    #[wasm_bindgen(method, js_name = measureText)] fn measure_text(this: &Canvas2d, text: &JsString) -> JsValue;
    #[wasm_bindgen(method, js_name = fillText)] fn fill_text(this: &Canvas2d, text: &JsString, x: f64, y: f64, max_width: f64);
    #[wasm_bindgen(method, setter, js_name = fillStyle)] fn set_fill_style(this: &Canvas2d, value: &JsValue);
    #[wasm_bindgen(method, setter, js_name = strokeStyle)] fn set_stroke_style(this: &Canvas2d, value: &JsValue);
    #[wasm_bindgen(method, setter, js_name = lineWidth)] fn set_line_width(this: &Canvas2d, value: f64);
    #[wasm_bindgen(method, setter, js_name = lineCap)] fn set_line_cap(this: &Canvas2d, value: &str);
    #[wasm_bindgen(method, setter, js_name = globalAlpha)] fn set_global_alpha(this: &Canvas2d, value: f64);
    #[wasm_bindgen(method, setter, js_name = font)] fn set_font(this: &Canvas2d, value: &JsString);
    #[wasm_bindgen(method, setter, js_name = textAlign)] fn set_text_align(this: &Canvas2d, value: &str);
    #[wasm_bindgen(method, setter, js_name = textBaseline)] fn set_text_baseline(this: &Canvas2d, value: &str);
}

fn fill_with(c: &Canvas2d, style: &str) { c.set_fill_style(&JsValue::from_str(style)); }
fn stroke_with(c: &Canvas2d, style: &str) { c.set_stroke_style(&JsValue::from_str(style)); }

/// `withStops(gradient, stops)`: tolerant of partial canvas implementations.
fn with_stops(gradient: JsValue, stops: &[(f64, &str)]) -> JsValue {
    if !absent(&gradient) {
        for (at, color) in stops {
            let _ = method_opt(&gradient, "addColorStop", &[&JsValue::from_f64(*at), &JsValue::from_str(color)]);
        }
    }
    gradient
}
fn shade(red: u8, green: u8, blue: u8, alpha: f64) -> String { format!("rgba({red},{green},{blue},{})", number_string(alpha)) }

/// The small deterministic generator behind the page's seeded textures (`seededRandom`).
struct Random(i32);
impl Random {
    fn new(seed: u32) -> Random { Random((if seed == 0 { 1 } else { seed }) as i32) }
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6D2B79F5u32 as i32);
        let s = self.0;
        let mut t = (s ^ ((s as u32) >> 15) as i32).wrapping_mul(1 | s);
        t = t.wrapping_add((t ^ ((t as u32) >> 7) as i32).wrapping_mul(61 | t)) ^ t;
        (((t ^ ((t as u32) >> 14) as i32) as u32) as f64) / 4294967296.0
    }
}

/// Page edges: individual leaves, darker signature folds, a slight cockle and a silk headband.
/// u runs across the leaves (tiled by physical thickness); v .02-.46 is the fore-edge, .54-.98
/// head and tail (spine side at .98).
#[wasm_bindgen]
pub fn book_page_edges(c: &Canvas2d, size: f64) {
    let mut random = Random::new((size * 131.0 + 7.0) as u32);
    let unit = size / 256.0;
    fill_with(c, "#ffffff");
    c.fill_rect(0.0, 0.0, size, size);
    let leaf = |random: &mut Random, x: f64, style: &str, weight: f64| {
        let phase = random.next() * PI * 2.0;
        let amplitude = (0.25 + random.next() * 0.55) * unit;
        stroke_with(c, style);
        c.set_line_width(weight);
        for offset in [0.0, -size] {
            c.begin_path();
            let mut y = 0.0;
            while y <= size {
                let px = x + offset + Math::sin(y / size * PI * 5.0 + phase) * amplitude;
                if y != 0.0 { c.line_to(px, y); } else { c.move_to(px, y); }
                y += 8.0 * unit;
            }
            c.stroke();
        }
    };
    let mut x = 0.0;
    while x < size {
        let tone = random.next();
        let style = if tone > 0.74 { shade(108, 108, 108, 0.08 + random.next() * 0.12) }
            else if tone > 0.32 { shade(255, 255, 255, 0.22 + random.next() * 0.34) }
            else { shade(150, 150, 150, 0.05 + random.next() * 0.08) };
        let weight = (0.45 + random.next() * 0.6) * unit;
        leaf(&mut random, x, &style, weight);
        x += (1.1 + random.next() * 1.5) * unit;
    }
    let mut x = random.next() * 18.0 * unit;
    while x < size {
        let style = shade(88, 88, 88, 0.16 + random.next() * 0.14);
        leaf(&mut random, x, &style, 1.15 * unit);
        x += (20.0 + random.next() * 18.0) * unit;
    }
    // Head/tail: the gutter falls into shadow where the leaves bend into the spine.
    c.set_fill_style(&with_stops(c.linear_gradient(0.0, size * 0.02, 0.0, size * 0.2),
        &[(0.0, "rgba(64,64,64,.34)"), (0.45, "rgba(64,64,64,.1)"), (1.0, "rgba(64,64,64,0)")]));
    c.fill_rect(0.0, 0.0, size, size * 0.2);
    // Dust settles on both ends of the fore-edge first.
    for (from, to) in [(size * 0.54, size * 0.6), (size * 0.98, size * 0.92)] {
        c.set_fill_style(&with_stops(c.linear_gradient(0.0, from, 0.0, to), &[(0.0, "rgba(100,100,100,.16)"), (1.0, "rgba(100,100,100,0)")]));
        c.fill_rect(0.0, jmin(from, to), size, (to - from).abs());
    }
    fill_with(c, "#ffffff");
    c.fill_rect(0.0, size * 0.47, size, size * 0.06);
    // Headband: two-tone silk wound over a cord, rounded by its own shading.
    let band = size * 0.016;
    let stripe = 4.0 * unit;
    let (mut x, mut i) = (0.0, 0u32);
    while x < size {
        fill_with(c, if i % 2 != 0 { "#f6f6f6" } else { "#7b1f28" });
        c.begin_path();
        c.move_to(x, 0.0);
        c.line_to(x + stripe, 0.0);
        c.line_to(x + stripe * 1.6, size * 0.02 + band);
        c.line_to(x + stripe * 0.6, size * 0.02 + band);
        c.close_path();
        c.fill();
        x += stripe;
        i += 1;
    }
    c.set_fill_style(&with_stops(c.linear_gradient(0.0, size * 0.02, 0.0, size * 0.02 + band),
        &[(0.0, "rgba(0,0,0,.35)"), (0.45, "rgba(255,255,255,.12)"), (1.0, "rgba(0,0,0,.45)")]));
    c.fill_rect(0.0, size * 0.02, size, band);
}

/// Endpaper: a white wove stock with a faint speckle and a few long fibres. White-based so the
/// material colour tints it; every stroke wraps the tile.
#[wasm_bindgen]
pub fn book_endpaper(c: &Canvas2d) {
    let size = 256.0;
    let mut random = Random::new(90127);
    fill_with(c, "#fff");
    c.fill_rect(0.0, 0.0, size, size);
    for _ in 0..2400 {
        let style = if random.next() > 0.55 { shade(86, 86, 86, 0.035 + random.next() * 0.05) } else { shade(255, 255, 255, 0.3 + random.next() * 0.4) };
        fill_with(c, &style);
        let x = Math::floor(random.next() * size);
        let y = Math::floor(random.next() * size);
        c.fill_rect(x, y, 1.0, 1.0);
    }
    c.set_line_cap("round");
    for _ in 0..70 {
        let x = random.next() * size;
        let y = random.next() * size;
        let a = random.next() * PI;
        let length = 6.0 + random.next() * 22.0;
        let bend = (random.next() - 0.5) * length * 0.5;
        let dx = Math::cos(a) * length;
        let dy = Math::sin(a) * length;
        stroke_with(c, &shade(112, 112, 112, 0.05 + random.next() * 0.07));
        c.set_line_width(0.5 + random.next() * 0.5);
        for ox in [-size, 0.0, size] {
            for oy in [-size, 0.0, size] {
                c.begin_path();
                c.move_to(x + ox, y + oy);
                c.quadratic_curve_to(x + ox + dx / 2.0 - dy / length * bend, y + oy + dy / 2.0 + dx / length * bend, x + ox + dx, y + oy + dy);
                c.stroke();
            }
        }
    }
}

/// A thumbnail keeps a plain block and one tiny owned raster.
#[wasm_bindgen]
pub fn book_thumbnail_pages(c: &Canvas2d) {
    fill_with(c, "#ffffff");
    c.fill_rect(0.0, 0.0, 32.0, 32.0);
    let mut i = 1;
    while i < 32 {
        fill_with(c, if i % 9 == 1 { "rgba(112,112,112,.18)" } else { "rgba(255,255,255,.4)" });
        c.fill_rect(0.0, i as f64, 32.0, 1.0);
        i += 3;
    }
}

/// Joint groove distance from the spine edge, as a fraction of board height.
const HINGE_GROOVE: f64 = 0.026;

fn draw(random: &Function) -> f64 { random.call0(&JsValue::UNDEFINED).map(|value| num(&value)).unwrap_or(f64::NAN) }

/// Wear that belongs to the board rather than the artwork, drawn in design units (1024 = board
/// height) over printed and cloth covers alike. `random` is the host's stream: the cloth painter
/// that came before continues here.
#[wasm_bindgen]
pub fn book_finish_board(c: &Canvas2d, design_width: f64, random: &Function, wear: bool) {
    let hinge = HINGE_GROOVE * 1024.0;
    let edge = 14.0;
    c.set_global_alpha(1.0);
    // The strip beside the spine flexes at every opening and dulls first.
    fill_with(c, "rgba(0,0,0,.05)");
    c.fill_rect(0.0, 0.0, hinge - 9.0, 1024.0);
    // Pressed joint groove: shadowed spine-side wall, lit far wall.
    c.set_fill_style(&with_stops(c.linear_gradient(hinge - 11.0, 0.0, hinge + 11.0, 0.0),
        &[(0.0, "rgba(0,0,0,0)"), (0.3, "rgba(0,0,0,.26)"), (0.5, "rgba(0,0,0,.12)"), (0.7, "rgba(255,248,236,.11)"), (1.0, "rgba(255,248,236,0)")]));
    c.fill_rect(hinge - 11.0, 0.0, 22.0, 1024.0);
    // The covering turns over the board edges here.
    for (x0, y0, x1, y1) in [(0.0, 0.0, 0.0, edge), (0.0, 1024.0, 0.0, 1024.0 - edge), (design_width, 0.0, design_width - edge, 0.0)] {
        c.set_fill_style(&with_stops(c.linear_gradient(x0, y0, x1, y1), &[(0.0, "rgba(0,0,0,.16)"), (1.0, "rgba(0,0,0,0)")]));
        if x0 == x1 { c.fill_rect(0.0, jmin(y0, y1), design_width, edge); } else { c.fill_rect(design_width - edge, 0.0, edge, 1024.0); }
    }
    // A thumbnail cannot show single fibres or rubbed corners.
    if !wear { return; }
    // Rubbed fibres: short paler runs along the edges that meet the shelf.
    fill_with(c, "#fff6e6");
    for (length, vertical, at) in [(design_width, false, 0.0), (design_width, false, 1021.6), (1024.0, true, design_width - 2.4)] {
        let mut p = 0.0;
        while p < length {
            let run = 6.0 + draw(random) * 42.0;
            c.set_global_alpha(if draw(random) < 0.45 { draw(random) * 0.24 } else { 0.0 });
            if vertical { c.fill_rect(at, p, 2.4, run); } else { c.fill_rect(p, at, run, 2.4); }
            p += run;
        }
    }
    c.set_global_alpha(1.0);
    // Corners at the fore-edge take the knocks.
    for y in [0.0, 1024.0] {
        c.set_fill_style(&with_stops(c.radial_gradient(design_width, y, 0.0, design_width, y, 30.0),
            &[(0.0, "rgba(255,244,226,.3)"), (1.0, "rgba(255,244,226,0)")]));
        c.fill_rect(design_width - 30.0, if y != 0.0 { 994.0 } else { 0.0 }, 30.0, 30.0);
    }
}

/// The lettering of a plain cloth case after its dyed cloth and weave: a blind-stamped panel,
/// the title in as many lines as fit (at most six), a small fleuron rule, the author in italics,
/// and, on a full-size case, the publisher's device at the foot pressed in twice, then the
/// board's own finish. `device` is the mark's number or negative for none; `draw_device(c, kind,
/// size)` draws it; `font_weight` and `family` are the host's already-built font parts.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn book_cover_case(c: &Canvas2d, design_width: f64, title: &JsString, author: &JsString, ink: &JsValue, font_weight: &JsValue,
    family: &JsString, thumb: bool, device: f64, draw_device: &Function, random: &Function) -> Result<(), JsValue> {
    // Design in physical cover proportions so lettering is never stretched, centred on the board
    // beyond the joint as a real case is.
    let hinge = HINGE_GROOVE * 1024.0;
    let center = (hinge + design_width) / 2.0;
    let cover_scale = design_width / 676.0;
    let title_size = jmax(36.0, jmin(82.0, 54.0 * cover_scale));
    let title_width = jmin(480.0 * cover_scale, design_width - hinge - 110.0);
    // Blind-stamped panel: pressed into the cloth, no ink.
    c.set_line_width(2.4);
    stroke_with(c, "rgba(0,0,0,.26)");
    c.stroke_rect(hinge + 34.0, 42.0, design_width - hinge - 76.0, 940.0);
    stroke_with(c, "rgba(255,248,236,.1)");
    c.stroke_rect(hinge + 36.0, 44.0, design_width - hinge - 76.0, 940.0);
    // `c.fillStyle = c.strokeStyle = ink` assigns the stroke first.
    c.set_stroke_style(ink);
    c.set_fill_style(ink);
    c.set_text_align("center");
    c.set_text_baseline("middle");
    let weight = if font_weight.is_truthy() { crate::host::text_of(font_weight) } else { "700".to_string() };
    c.set_font(&JsString::from(format!("{weight} {}px ", number_string(title_size)).as_str()).concat(family));
    let space = JsString::from(" ");
    let words = title.split(" ");
    let mut line = JsString::from("");
    let lines = Array::new();
    for word in words.iter() {
        let word: JsString = word.unchecked_into();
        let width = num(&get(&c.measure_text(&line.concat(&word)), "width"));
        if width > title_width && line.length() > 0 {
            lines.push(&line.trim());
            line = JsString::from("");
        }
        line = line.concat(&word).concat(&space);
    }
    lines.push(&line.trim());
    let visible = jmin(lines.length() as f64, 6.0) as u32;
    let spacing = title_size * 1.2;
    let top = 400.0 - (visible as f64 - 1.0) * spacing / 2.0;
    for i in 0..visible {
        let mut text: JsString = lines.get(i).unchecked_into();
        if i == 5 && lines.length() > 6 { text = text.concat(&JsString::from("\u{2026}")); }
        c.fill_text(&text, center, top + i as f64 * spacing, title_width);
    }
    // A small fleuron rule, then the author in the text face's italic.
    let ornament = top + (visible as f64 - 1.0) * spacing + title_size * 0.6 + 56.0;
    c.set_global_alpha(0.75);
    c.fill_rect(center - 66.0, ornament - 0.75, 50.0, 1.5);
    c.fill_rect(center + 16.0, ornament - 0.75, 50.0, 1.5);
    c.save(); c.translate(center, ornament); c.rotate(PI / 4.0); c.fill_rect(-4.5, -4.5, 9.0, 9.0); c.restore();
    if author.length() > 0 {
        c.set_global_alpha(0.92);
        let size = js_round(jmax(24.0, jmin(40.0, 30.0 * cover_scale)));
        c.set_font(&JsString::from(format!("italic 400 {}px ", number_string(size)).as_str()).concat(family));
        c.fill_text(author, center, ornament + 56.0, title_width);
    }
    // Publisher's device at the foot, blind-stamped like the panel: pressed in, no ink, so it never
    // reads as a printed arrow.
    if !thumb && device >= 0.0 {
        c.save(); c.set_global_alpha(1.0); c.translate(center, 904.0);
        fill_with(c, "rgba(0,0,0,.24)");
        draw_device.call3(&JsValue::UNDEFINED, c, &JsValue::from_f64(device), &JsValue::from_f64(24.0))?;
        c.translate(1.8, 1.8);
        fill_with(c, "rgba(255,248,236,.1)");
        draw_device.call3(&JsValue::UNDEFINED, c, &JsValue::from_f64(device), &JsValue::from_f64(24.0))?;
        c.restore();
    }
    book_finish_board(c, design_width, random, !thumb);
    Ok(())
}
