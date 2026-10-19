//! The paper IKEA plant catalogue clipped to the cabinet side: its printed cover, painted operation by
//! operation on the host's 2D canvas in the original order (the host's `Math`, numbers printed the way a
//! template literal prints them), and its model as a prop packet (see `shelf_models`): paper block, four
//! inset leaves, the relaxed front cover, the back, the folded spine, the steel bulldog clip with its wire
//! loops and staples, and the wall pin. The canvas element, its texture and the three.js objects stay host-side.
use wasm_bindgen::prelude::*;
use js_sys::Math;
use std::f64::consts::PI;
use crate::host::{method, number_string, set};
use crate::jsmath::Vec3;
use crate::shelf_models::{box_groups, cylinder_groups, packet, Node, EXTRUDED, LATHE, PLAIN};
use crate::three_curve::{tube, CatmullRom};
use crate::three_geo::{self, Geo};
use crate::three_shape::{extrude_beveled, Path};

type R<T> = Result<T, JsValue>;

fn val(x: f64) -> JsValue { JsValue::from_f64(x) }
fn txt(x: &str) -> JsValue { JsValue::from_str(x) }
fn call(c: &JsValue, name: &str, args: &[f64]) -> R<()> {
    let values: Vec<JsValue> = args.iter().map(|x| val(*x)).collect();
    let refs: Vec<&JsValue> = values.iter().collect();
    method(c, name, &refs)?;
    Ok(())
}
fn style(c: &JsValue, key: &str, value: &str) -> R<()> { set(c, key, &txt(value)) }
fn width(c: &JsValue, value: f64) -> R<()> { set(c, "lineWidth", &val(value)) }
fn fill_text(c: &JsValue, text: &str, x: f64, y: f64) -> R<()> { method(c, "fillText", &[&txt(text), &val(x), &val(y)])?; Ok(()) }
fn font(c: &JsValue, weight: &str, size: f64) -> R<()> {
    style(c, "font", &format!("{weight} {}px \"Noto Sans\", Verdana, Arial, sans-serif", number_string(size)))
}

/// Print the cover like a real IKEA booklet: a solid brand-blue masthead with the logo, a bold title and one
/// flat-printed illustration on uncoated paper. Big shapes and strong colour keep it recognisable at 25-40 px.
#[wasm_bindgen]
pub fn catalog_draw_cover(c: &JsValue, w: f64, h: f64) -> R<()> {
    let u = w / 512.0;
    style(c, "fillStyle", "#fbf8f0")?; call(c, "fillRect", &[0.0, 0.0, w, h])?;
    // Uncoated stock: faint fibres and a slightly warmer edge.
    let mut seed: u32 = 7;
    let mut random = || {
        let mixed = (seed ^ (seed >> 15)) as i32;
        seed = (mixed.wrapping_mul(0x2c1b3c6d) as u32).wrapping_add(0x6d2b79f5);
        f64::from(seed) / 4294967296.0
    };
    for _ in 0..900 {
        style(c, "fillStyle", &format!("rgba(120, 100, 70, {})", number_string(0.025 + random() * 0.035)))?;
        let (x, y, length) = (random() * w, random() * h, (1.0 + random() * 3.0) * u);
        call(c, "fillRect", &[x, y, length, 0.8 * u])?;
    }
    let edge = method(c, "createRadialGradient", &[&val(w / 2.0), &val(h / 2.0), &val(h * 0.35), &val(w / 2.0), &val(h / 2.0), &val(h * 0.75)])?;
    method(&edge, "addColorStop", &[&val(0.0), &txt("rgba(255,255,255,0)")])?;
    method(&edge, "addColorStop", &[&val(1.0), &txt("rgba(150,120,80,.08)")])?;
    set(c, "fillStyle", &edge)?; call(c, "fillRect", &[0.0, 0.0, w, h])?;
    let (blue, yellow, ink) = ("#0058a3", "#ffda1a", "#161616");
    // Masthead: full-bleed brand blue with the yellow oval logo.
    let band = 156.0 * u;
    style(c, "fillStyle", blue)?; call(c, "fillRect", &[0.0, 0.0, w, band])?;
    let (lw, lh, lx) = (212.0 * u, 92.0 * u, 34.0 * u);
    let ly = (band - lh) / 2.0;
    style(c, "fillStyle", yellow)?; call(c, "beginPath", &[])?;
    call(c, "ellipse", &[lx + lw / 2.0, ly + lh / 2.0, lw / 2.0, lh / 2.0, 0.0, 0.0, PI * 2.0])?; call(c, "fill", &[])?;
    style(c, "fillStyle", blue)?; font(c, "900", 60.0 * u)?; style(c, "textAlign", "center")?; style(c, "textBaseline", "middle")?;
    fill_text(c, "IKEA", lx + lw / 2.0, ly + lh / 2.0 + 3.0 * u)?;
    style(c, "fillStyle", yellow)?; call(c, "fillRect", &[0.0, band, w, 10.0 * u])?;
    style(c, "textAlign", "left")?; style(c, "textBaseline", "alphabetic")?;
    style(c, "fillStyle", ink)?; font(c, "800", 78.0 * u)?; fill_text(c, "PLANTAS", 32.0 * u, band + 96.0 * u)?;
    font(c, "400", 21.0 * u)?; style(c, "fillStyle", "#3c3c3c")?;
    fill_text(c, "Plantas y macetas de interior", 35.0 * u, band + 132.0 * u)?;
    // Flat-printed illustration: a sansevieria in a terracotta pot beside a small rosette, filled in two inks
    // with a fine keyline.
    style(c, "lineJoin", "round")?; style(c, "lineCap", "round")?;
    let (px, py, pw, ph) = (w * 0.38, h - 64.0 * u, 136.0 * u, 112.0 * u);
    let blades: [(f64, f64, f64); 6] = [(-40.0, 160.0, -0.24), (-16.0, 206.0, -0.08), (8.0, 222.0, 0.03), (28.0, 184.0, 0.15), (48.0, 140.0, 0.3), (-2.0, 124.0, -0.4)];
    for (offset, length, lean) in blades {
        let (x0, y0) = (px + offset * u, py - ph + 2.0 * u);
        let tip_x = x0 + Math::sin(lean) * length * u;
        let tip_y = y0 - Math::cos(lean) * length * u;
        let half = (13.0 + length / 34.0) * u;
        call(c, "beginPath", &[])?; call(c, "moveTo", &[x0 - half, y0])?;
        call(c, "bezierCurveTo", &[x0 - half * 1.25, y0 - length * 0.45 * u, tip_x - half * 0.5, tip_y + length * 0.2 * u, tip_x, tip_y])?;
        call(c, "bezierCurveTo", &[tip_x + half * 0.5, tip_y + length * 0.22 * u, x0 + half * 1.2, y0 - length * 0.4 * u, x0 + half, y0])?;
        call(c, "closePath", &[])?; style(c, "fillStyle", if lean < 0.0 { "#3d6f37" } else { "#4a8041" })?; call(c, "fill", &[])?;
        style(c, "strokeStyle", "#1f3a1d")?; width(c, 2.2 * u)?; call(c, "stroke", &[])?;
        // Pale cross bands, as on the real leaves.
        call(c, "save", &[])?; call(c, "clip", &[])?; style(c, "strokeStyle", "rgba(214, 226, 170, .55)")?; width(c, 3.4 * u)?;
        for step in 1..9 {
            let f = f64::from(step) / 9.0;
            let (bx, by) = (x0 + (tip_x - x0) * f, y0 + (tip_y - y0) * f);
            call(c, "beginPath", &[])?; call(c, "moveTo", &[bx - half * 1.4, by + 5.0 * u])?;
            call(c, "quadraticCurveTo", &[bx, by - 6.0 * u, bx + half * 1.4, by + 5.0 * u])?; call(c, "stroke", &[])?;
        }
        call(c, "restore", &[])?;
    }
    let pot = || -> R<()> {
        call(c, "beginPath", &[])?; call(c, "moveTo", &[px - pw / 2.0, py - ph])?; call(c, "lineTo", &[px - pw * 0.4, py])?;
        call(c, "quadraticCurveTo", &[px, py + 10.0 * u, px + pw * 0.4, py])?; call(c, "lineTo", &[px + pw / 2.0, py - ph])?; call(c, "closePath", &[])
    };
    let rim = [px - pw / 2.0 - 4.0 * u, py - ph - 4.0 * u, pw + 8.0 * u, 24.0 * u];
    pot()?; style(c, "fillStyle", "#c96f45")?; call(c, "fill", &[])?;
    style(c, "fillStyle", "#b25d38")?; call(c, "fillRect", &rim)?;
    pot()?; style(c, "strokeStyle", "#4a2414")?; width(c, 2.4 * u)?; call(c, "stroke", &[])?;
    call(c, "strokeRect", &rim)?;
    // Small rosette in a tapered pot.
    let (rx, ry) = (w * 0.79, h - 70.0 * u);
    for leaf in 0..9 {
        let angle = -PI / 2.0 + f64::from(leaf - 4) * 0.36;
        let length = (58.0 - f64::from(leaf - 4).abs() * 4.0) * u;
        let (bx, by) = (rx, ry - 62.0 * u);
        let (tx, ty) = (bx + Math::cos(angle) * length, by + Math::sin(angle) * length * 0.8);
        call(c, "beginPath", &[])?; call(c, "moveTo", &[bx, by])?;
        call(c, "quadraticCurveTo", &[(bx + tx) / 2.0 + Math::sin(angle) * 16.0 * u, (by + ty) / 2.0 - 10.0 * u, tx, ty])?;
        call(c, "quadraticCurveTo", &[(bx + tx) / 2.0 - Math::sin(angle) * 16.0 * u, (by + ty) / 2.0 + 8.0 * u, bx, by])?;
        style(c, "fillStyle", if leaf % 2 != 0 { "#7da08c" } else { "#8fb39d" })?; call(c, "fill", &[])?;
        style(c, "strokeStyle", "#2d4a3a")?; width(c, 1.8 * u)?; call(c, "stroke", &[])?;
    }
    call(c, "beginPath", &[])?; call(c, "moveTo", &[rx - 44.0 * u, ry - 64.0 * u])?; call(c, "lineTo", &[rx - 32.0 * u, ry])?;
    call(c, "lineTo", &[rx + 32.0 * u, ry])?; call(c, "lineTo", &[rx + 44.0 * u, ry - 64.0 * u])?; call(c, "closePath", &[])?;
    style(c, "fillStyle", "#e9e4da")?; call(c, "fill", &[])?; style(c, "strokeStyle", "#3a3a3a")?; width(c, 2.2 * u)?; call(c, "stroke", &[])?;
    // Ground line under both pots.
    style(c, "fillStyle", "rgba(40, 30, 20, .16)")?; call(c, "fillRect", &[28.0 * u, h - 52.0 * u, w - 56.0 * u, 3.0 * u])
}

/// The relaxed front cover: held flat by the clip, it lifts towards the free corner.
fn front_cover(width: f64, height: f64) -> Geo {
    let mut geo = three_geo::plane(width, height, 8.0, 10.0);
    for i in 0..geo.count() {
        let x = f64::from(geo.position[i * 3]) / width + 0.5;
        let y = f64::from(geo.position[i * 3 + 1]) / height + 0.5;
        let z = Math::pow(1.0 - y, 2.0) * 0.45 + Math::pow(x, 3.0) * Math::pow(1.0 - y, 3.0) * 1.5 + Math::sin(x * PI) * 0.12;
        geo.position[i * 3 + 2] = z as f32;
    }
    geo.compute_vertex_normals();
    geo
}

/// The bulldog clip: a bent steel jaw across the top edge, two folded wire handles whose loop hangs on the pin
/// and two staples on the fold, merged into one soup.
fn clip(width: f64, height: f64, thickness: f64) -> Geo {
    let jaw_width = crate::jsmath::jmin(width * 0.3, 24.0);
    let (gap, sheet, top) = (thickness / 2.0 + 0.45, 0.32, height / 2.0);
    let line = [[gap, -7.0], [gap + 1.1, -4.6], [gap + 2.3, -1.4], [gap + 1.6, 1.8], [0.0, 3.3], [-gap - 1.6, 1.8], [-gap - 2.3, -1.4], [-gap - 1.1, -4.6], [-gap, -7.0]];
    let n = line.len();
    let offset = |index: usize, side: f64| -> [f64; 2] {
        let ([z, y], [z0, y0], [z1, y1]) = (line[index], line[index.saturating_sub(1)], line[(index + 1).min(n - 1)]);
        let length = Math::hypot(z1 - z0, y1 - y0);
        if side > 0.0 { [z + (y1 - y0) / length * sheet, y - (z1 - z0) / length * sheet] } else { [z - (y1 - y0) / length * sheet, y + (z1 - z0) / length * sheet] }
    };
    let mut outline: Vec<[f64; 2]> = (0..n).map(|index| offset(index, 1.0)).collect();
    outline.extend((0..n).rev().map(|index| offset(index, -1.0)));
    let (mut bent, _) = extrude_beveled(&Path::from_points(&outline).points(2), jaw_width, 0.2, 0.08, 1);
    bent.rotate_y(-PI / 2.0);
    bent.translate(jaw_width / 2.0, top + 0.6, 0.0);
    // Smooth across the gentle bends of the spring steel, crisp at its cut ends, so the jaw shades as one curved
    // sheet instead of light and dark stripes.
    let jaw = three_geo::creased_normals(&bent, PI / 4.0);
    let pin_y = top + 13.5;
    let wire = |z: f64, spread: f64| -> Geo {
        let points: Vec<Vec3> = vec![[-jaw_width / 2.0 + 0.6, top + 3.0, z * 0.4], [-jaw_width * spread, top + 7.5, z],
            [-jaw_width * 0.18, pin_y + 0.3, z], [0.0, pin_y + 1.1, z * 0.8], [jaw_width * 0.18, pin_y + 0.3, z],
            [jaw_width * spread, top + 7.5, z], [jaw_width / 2.0 - 0.6, top + 3.0, z * 0.4]];
        tube(&CatmullRom::new(points), 22, 0.38, 5).to_non_indexed()
    };
    let fold = -width / 2.0 + 0.2 - (thickness + 0.6) / 2.0 * 0.55;
    let staple = |offset: f64| -> Geo {
        let mut staple = three_geo::box_geometry(0.3, height * 0.09, 0.3, 1, 1, 1);
        staple.translate(fold, offset * height, 0.0);
        staple.to_non_indexed()
    };
    three_geo::merge(&[jaw, wire(-0.5, 0.44), wire(0.5, 0.4), staple(-0.27), staple(0.27)])
}

/// `[canvas width, canvas height]` of the cover art: 512 px wide is ample for a booklet that is never more than
/// ~180 px tall; the height keeps the cover's aspect (`Math.round`).
#[wasm_bindgen]
pub fn catalog_canvas_size(width: f64, height: f64) -> Vec<f64> { vec![512.0, Math::round(512.0 * height / width)] }

/// The catalogue's model for `createShelfCatalog({ width, height, thickness })`; local +Z is the cover, -Z
/// faces the cabinet wall.
#[wasm_bindgen]
pub fn catalog_model(width: f64, height: f64, thickness: f64) -> Vec<u8> {
    let boxed = |w: f64, h: f64, d: f64| three_geo::box_geometry(w, h, d, 1, 1, 1);
    let mut nodes = vec![Node::mesh("catalog-paper-block", "BoxGeometry", "edge", boxed(width - 0.8, height - 0.8, thickness), PLAIN).grouped(box_groups()).at([0.0, 0.0, -0.2])];
    // Four narrow inset sheets produce stepped, shaded page edges at the bottom.
    for index in 0..4 {
        let k = f64::from(index);
        nodes.push(Node::mesh(format!("catalog-sheet-{index}"), "BoxGeometry", "paper", boxed(width - k * 0.3, height - k * 0.25, 0.2), PLAIN).grouped(box_groups())
            .at([k * 0.11, -k * 0.13, -thickness / 2.0 + k * thickness / 4.0]));
    }
    nodes.push(Node::mesh("catalog-front-cover", "PlaneGeometry", "cover", front_cover(width, height), PLAIN).at([0.0, 0.0, thickness / 2.0 + 0.18]));
    nodes.push(Node::mesh("catalog-back-cover", "BoxGeometry", "paper", boxed(width, height, 0.25), PLAIN).grouped(box_groups()).at([0.0, 0.0, -thickness / 2.0 - 0.18]));
    // Saddle-stitched fold: a rounded spine rather than a square block.
    let radius = (thickness + 0.6) / 2.0;
    nodes.push(Node::mesh("catalog-fold", "CylinderGeometry", "paper", three_geo::cylinder(radius, radius, height, 10, 1, false, PI, PI), PLAIN)
        .grouped(cylinder_groups(radius, radius, 10, 1, false)).at([-width / 2.0 + 0.2, 0.0, 0.0]).scaled([0.55, 1.0, 1.0]));
    nodes.push(Node::mesh("catalog-clip", "BufferGeometry", "clip", clip(width, height, thickness), EXTRUDED));
    // A round-headed steel pin driven into the cabinet side.
    let pin = [[0.0, -3.2], [0.45, -3.2], [0.45, 1.1], [1.7, 1.2], [1.8, 1.55], [1.4, 2.1], [0.7, 2.35], [0.0, 2.4]];
    nodes.push(Node::mesh("catalog-wall-pin", "LatheGeometry", "clip", three_geo::lathe(&pin, 14), LATHE)
        .turned([PI / 2.0, 0.0, 0.0], "XYZ").at([0.0, height / 2.0 + 13.5, 0.0]));
    packet(&nodes, CATALOG_MATERIALS, &[])
}

/// Uncoated paper, its rougher block edge, the clip's spring steel and the printed cover (`"map"` stands for the
/// cover's canvas texture), in the order they are made.
const CATALOG_MATERIALS: &str = concat!("[",
    r##"{"role":"paper","class":"MeshStandardMaterial","options":{"color":"#f7f3e8","roughness":0.93}},"##,
    r##"{"role":"edge","class":"MeshStandardMaterial","options":{"color":"#e9e3d3","roughness":0.97}},"##,
    r##"{"role":"clip","class":"MeshPhysicalMaterial","options":{"color":"#c3c7cb","metalness":0.88,"roughness":0.42,"clearcoat":0.3,"clearcoatRoughness":0.22}},"##,
    r##"{"role":"cover","class":"MeshStandardMaterial","options":{"color":"#ffffff","map":"map","roughness":0.62}}"##,
    "]");
