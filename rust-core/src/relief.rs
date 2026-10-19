//! Bounded numeric cover-map passes. Inputs and outputs live in the caller's
//! aligned WASM arena; every export does at most the row/pixel range requested.
//! f32 is storage only: arithmetic follows JavaScript's f64 operation order.

use std::slice;

fn clamp(value: f64, low: f64, high: f64) -> f64 {
    if value.is_nan() { value } else { value.max(low).min(high) }
}

/// ECMA ToUint8Clamp, including ties to even (Rust's float-to-u8 cast truncates).
fn clamped_byte(value: f64) -> u8 {
    // f64.nearest rounds ties to even in one WASM instruction. Rust's float
    // cast saturates outside u8's range and maps NaN to zero, completing the
    // same conversion without four floor/fraction branches per RGBA pixel.
    value.round_ties_even() as u8
}

// Math.round followed by Uint8Array conversion, for finite nonnegative map data.
fn rounded_byte(value: f64) -> u8 {
    if !value.is_finite() { return 0; }
    let floor = value.floor();
    let rounded = if value - floor < 0.5 { floor } else { floor + 1.0 };
    (rounded as i64 & 255) as u8
}

fn extent(width: u32, height: u32, from: u32, to: u32, limit: u32) -> Option<usize> {
    let count = width.checked_mul(height)?;
    if width == 0 || height == 0 || count > 1_048_576 || from > to || to > limit {
        None
    } else { Some(count as usize) }
}

#[no_mangle]
pub unsafe extern "C" fn relief_distance_init(mask: *const u8, distance: *mut f32,
    count: u32, from: u32, to: u32) -> u32 {
    if count > 1_048_576 || from > to || to > count { return 0; }
    let mask = slice::from_raw_parts(mask, count as usize);
    let distance = slice::from_raw_parts_mut(distance, count as usize);
    for i in from as usize..to as usize { distance[i] = if mask[i] != 0 { 1e6 } else { 0.0 }; }
    1
}

#[no_mangle]
pub unsafe extern "C" fn relief_distance_rows(distance: *mut f32, width: u32,
    height: u32, from: u32, to: u32, reverse: u32) -> u32 {
    let Some(count) = extent(width, height, from, to, height) else { return 0; };
    let d = slice::from_raw_parts_mut(distance, count);
    let w = width as usize;
    for row in from..to {
        let y = if reverse != 0 { to - 1 - (row - from) } else { row } as usize;
        for column in 0..w {
            let x = if reverse != 0 { w - 1 - column } else { column };
            let at = y * w + x;
            if d[at] == 0.0 { continue; }
            let mut v = d[at] as f64;
            if reverse == 0 {
                if x > 0 { v = v.min(d[at - 1] as f64 + 1.0); }
                if y > 0 {
                    v = v.min(d[at - w] as f64 + 1.0);
                    if x > 0 { v = v.min(d[at - w - 1] as f64 + 1.4142); }
                    if x < w - 1 { v = v.min(d[at - w + 1] as f64 + 1.4142); }
                }
            } else {
                if x < w - 1 { v = v.min(d[at + 1] as f64 + 1.0); }
                if y < height as usize - 1 {
                    v = v.min(d[at + w] as f64 + 1.0);
                    if x < w - 1 { v = v.min(d[at + w + 1] as f64 + 1.4142); }
                    if x > 0 { v = v.min(d[at + w - 1] as f64 + 1.4142); }
                }
            }
            d[at] = v as f32;
        }
    }
    1
}

fn edge(index: i64, size: usize) -> usize { index.max(0).min(size as i64 - 1) as usize }

#[no_mangle]
pub unsafe extern "C" fn relief_blur_pass(input: *const f32, output: *mut f32,
    width: u32, height: u32, radius: u32, from: u32, to: u32, vertical: u32) -> u32 {
    let limit = if vertical != 0 { width } else { height };
    let Some(count) = extent(width, height, from, to, limit) else { return 0; };
    if radius == 0 || radius > 1024 { return 0; }
    let input = slice::from_raw_parts(input, count);
    let output = slice::from_raw_parts_mut(output, count);
    let w = width as usize;
    let h = height as usize;
    let r = radius as i64;
    let size = (radius * 2 + 1) as f64;
    for line in from as usize..to as usize {
        let mut sum = 0.0;
        if vertical == 0 {
            for x in -r..=r { sum += input[line * w + edge(x, w)] as f64; }
            for x in 0..w {
                output[line * w + x] = (sum / size) as f32;
                sum += input[line * w + edge(x as i64 + r + 1, w)] as f64
                    - input[line * w + edge(x as i64 - r, w)] as f64;
            }
        } else {
            for y in -r..=r { sum += input[edge(y, h) * w + line] as f64; }
            for y in 0..h {
                output[y * w + line] = (sum / size) as f32;
                sum += input[edge(y as i64 + r + 1, h) * w + line] as f64
                    - input[edge(y as i64 - r, h) * w + line] as f64;
            }
        }
    }
    1
}

// Scaled compensated sum, matching the browser's overflow-safe Math.hypot.
fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    let values = [x.abs(), y.abs(), z.abs()];
    let maximum = values[0].max(values[1]).max(values[2]);
    if maximum.is_infinite() { return f64::INFINITY; }
    if values.iter().any(|value| value.is_nan()) { return f64::NAN; }
    if maximum == 0.0 { return 0.0; }
    let mut sum = 0.0;
    let mut compensation = 0.0;
    for value in values {
        let scaled = value / maximum;
        let summand = scaled * scaled - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * maximum
}

#[no_mangle]
pub unsafe extern "C" fn relief_normal_rows(height_map: *const u8, owners: *const u8,
    mask: *const u8, output: *mut u8, width: u32, height: u32, from: u32, to: u32,
    has_owners: u32, preserve_ink: u32, unit: f64) -> u32 {
    normal_rows(height_map, owners, mask, output, width, height, from, to, has_owners,
        preserve_ink, unit, false, 0, std::ptr::null(), std::ptr::null())
}

// Pack the selection into the unused normal alpha while computing the normals.
// This avoids another RGBA allocation and JavaScript pixel pass in the 3D model.
#[no_mangle]
pub unsafe extern "C" fn relief_normal_selected_rows(height_map: *const u8, owners: *const u8,
    mask: *const u8, output: *mut u8, width: u32, height: u32, from: u32, to: u32,
    has_owners: u32, preserve_ink: u32, unit: f64, has_mask: u32, foil: *const u8, gloss: *const u8) -> u32 {
    if has_owners > 1 || preserve_ink > 1 || has_mask > 1 || !unit.is_finite()
        || (preserve_ink != 0 && has_mask == 0) { return 0; }
    normal_rows(height_map, owners, mask, output, width, height, from, to, has_owners,
        preserve_ink, unit, true, has_mask, foil, gloss)
}

unsafe fn normal_rows(height_map: *const u8, owners: *const u8, mask: *const u8,
    output: *mut u8, width: u32, height: u32, from: u32, to: u32,
    has_owners: u32, preserve_ink: u32, unit: f64, selection_alpha: bool,
    has_mask: u32, foil: *const u8, gloss: *const u8) -> u32 {
    let Some(count) = extent(width, height, from, to, height) else { return 0; };
    let heights = slice::from_raw_parts(height_map, count);
    let owners = if has_owners != 0 { Some(slice::from_raw_parts(owners, count)) } else { None };
    let mask = if preserve_ink != 0 || has_mask != 0 { Some(slice::from_raw_parts(mask, count)) } else { None };
    let foil = if selection_alpha && has_mask == 0 { Some(slice::from_raw_parts(foil, count)) } else { None };
    let gloss = if selection_alpha && has_mask == 0 { Some(slice::from_raw_parts(gloss, count)) } else { None };
    let out = slice::from_raw_parts_mut(output, count * 4);
    let w = width as usize;
    let h = height as usize;
    for y in from as usize..to as usize {
        for x in 0..w {
            let pixel = y * w + x;
            let at = pixel * 4;
            let alpha = if !selection_alpha { 255 } else if has_mask != 0 { mask.unwrap()[pixel] }
                else { heights[pixel].max(foil.unwrap()[pixel]).max(gloss.unwrap()[pixel]) };
            if preserve_ink != 0 && mask.is_some_and(|mask| mask[pixel] == 0) {
                out[at..at + 4].copy_from_slice(&[128, 128, 255, alpha]);
                continue;
            }
            let sample = |sx: i64, sy: i64| {
                let index = edge(sy, h) * w + edge(sx, w);
                if owners.is_some_and(|owners| owners[index] != owners[pixel]) { 0.0 }
                else { heights[index] as f64 }
            };
            let nx = -(sample(x as i64 + 1, y as i64) - sample(x as i64 - 1, y as i64)) * unit;
            let ny = (sample(x as i64, y as i64 + 1) - sample(x as i64, y as i64 - 1)) * unit;
            // Flat coated interiors dominate real cover masks. Their tangent
            // normal is exact, including signed zero and ties-to-even 127.5;
            // avoid square roots/divisions without changing any shaded pixel.
            if nx == 0.0 && ny == 0.0 {
                out[at..at + 4].copy_from_slice(&[128, 128, 255, alpha]);
                continue;
            }
            let length = hypot3(nx, ny, 1.0);
            out[at] = clamped_byte((nx / length * 0.5 + 0.5) * 255.0);
            out[at + 1] = clamped_byte((ny / length * 0.5 + 0.5) * 255.0);
            out[at + 2] = clamped_byte((1.0 / length * 0.5 + 0.5) * 255.0);
            out[at + 3] = alpha;
        }
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn relief_material_pixels(foil: *const u8, gloss: *const u8,
    owners: *const u8, profiles: *const f64, output: *mut u8, count: u32,
    from: u32, to: u32, profile_count: u32, preserve_ink: u32,
    base: f64, foil_roughness: f64, gloss_roughness: f64, gloss_coat_roughness: f64) -> u32 {
    if count > 1_048_576 || from > to || to > count || profile_count > 10 { return 0; }
    let foil = slice::from_raw_parts(foil, count as usize);
    let gloss = slice::from_raw_parts(gloss, count as usize);
    let owners = if profile_count > 0 { Some(slice::from_raw_parts(owners, count as usize)) } else { None };
    let profiles = slice::from_raw_parts(profiles, profile_count as usize * 2);
    let out = slice::from_raw_parts_mut(output, count as usize * 4);
    for i in from as usize..to as usize {
        let f = if preserve_ink != 0 { 0.0 } else { foil[i] as f64 / 255.0 };
        let g = gloss[i] as f64 / 255.0;
        let owner = owners.map_or(0, |owners| owners[i] as usize);
        let (roughness, coat_roughness) = if owner > 0 && owner <= profile_count as usize {
            (profiles[(owner - 1) * 2], profiles[(owner - 1) * 2 + 1])
        } else { (gloss_roughness, gloss_coat_roughness) };
        out[i * 4] = clamped_byte((base + (1.0 - base) * g) * 255.0);
        out[i * 4 + 1] = clamped_byte((1.0 - (f * (1.0 - foil_roughness)).max(g * (1.0 - roughness))) * 255.0);
        out[i * 4 + 2] = clamped_byte(f * 255.0);
        out[i * 4 + 3] = if preserve_ink != 0 {
            clamped_byte((1.0 - g * (1.0 - coat_roughness)) * 255.0)
        } else { 255 };
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn relief_compose_pixels(owners: *const u8, base_mask: *const u8,
    base_height: *const f32, strengths: *const f64, output: *mut u8, count: u32,
    from: u32, to: u32, layer_count: u32) -> u32 {
    if count > 1_048_576 || from > to || to > count || layer_count > 10 { return 0; }
    let owners = slice::from_raw_parts(owners, count as usize);
    let masks = slice::from_raw_parts(base_mask, count as usize);
    let heights = slice::from_raw_parts(base_height, count as usize);
    let strengths = slice::from_raw_parts(strengths, layer_count as usize);
    let out = slice::from_raw_parts_mut(output, count as usize * 3);
    let n = count as usize;
    for i in from as usize..to as usize {
        let owner = owners[i] as usize;
        let strength = if owner > 0 && owner <= layer_count as usize { strengths[owner - 1] } else { 0.0 };
        if strength > 0.0 {
            out[i] = masks[i];
            out[n + i] = rounded_byte(clamp(masks[i] as f64 / 255.0 * strength, 0.0, 1.0) * 255.0);
            out[n * 2 + i] = rounded_byte(heights[i] as f64 * strength);
        } else { out[i] = 0; out[n + i] = 0; out[n * 2 + i] = 0; }
    }
    1
}

fn preview_coordinate(value:i64,extent:usize,source:usize)->usize{
 let value=value as f64*extent as f64/source as f64;let base=value.floor();
 let rounded=base+if value-base>=0.5{1.0}else{0.0};rounded.max(0.0).min((extent-1) as f64) as usize
}
/// Bounded cover preview pass with original ink, alpha and specular response.
/// # Safety
/// Image/output contain width*height*4 bytes; map planes map_width*map_height.
/// Seven coefficients: normalized light(3), half-vector(3), physical slope.
#[no_mangle]
pub unsafe extern "C" fn relief_preview_rows(image:*const u8,height_map:*const u8,foil:*const u8,gloss:*const u8,mask:*const u8,coefficients:*const f64,output:*mut u8,width:u32,height:u32,map_width:u32,map_height:u32,from:u32,to:u32,preserve:u32)->u32{
 let Some(count)=extent(width,height,from,to,height) else{return 0;};let Some(map_count)=extent(map_width,map_height,0,map_height,map_height) else{return 0;};if to-from>8{return 0;}
 let c=slice::from_raw_parts(coefficients,7);if c.iter().any(|v|!v.is_finite())||c[..6].iter().any(|v|v.abs()>2.0)||c[6].abs()>1e6{return 0;}
 let data=slice::from_raw_parts(image,count*4);let heights=slice::from_raw_parts(height_map,map_count);let foil=slice::from_raw_parts(foil,map_count);let gloss=slice::from_raw_parts(gloss,map_count);
 let mask=if preserve!=0{Some(slice::from_raw_parts(mask,map_count))}else{None};let out=slice::from_raw_parts_mut(output,count*4);
 let w=width as usize;let h=height as usize;let mw=map_width as usize;let mh=map_height as usize;
 for y in from as usize..to as usize{
  let my=preview_coordinate(y as i64,mh,h);let up=preview_coordinate(y as i64-1,mh,h);let down=preview_coordinate(y as i64+1,mh,h);
  for x in 0..w{
   let at=(y*w+x)*4;let mx=preview_coordinate(x as i64,mw,w);let mi=my*mw+mx;
   if mask.is_some_and(|v|v[mi]==0){out[at..at+4].copy_from_slice(&data[at..at+4]);continue;}
   let left=preview_coordinate(x as i64-1,mw,w);let right=preview_coordinate(x as i64+1,mw,w);
   let nx= -(heights[my*mw+right] as f64-heights[my*mw+left] as f64)*c[6];let ny=(heights[down*mw+mx] as f64-heights[up*mw+mx] as f64)*c[6];
   let length=hypot3(nx,ny,1.0);let n=[nx/length,ny/length,1.0/length];
   let diffuse=n[0]*c[0]+n[1]*c[1]+n[2]*c[2];let shade=clamp(1.0+(diffuse-c[2])*2.6,0.45,1.55);
   let spec=(n[0]*c[3]+n[1]*c[4]+n[2]*c[5]).max(0.0).powf(40.0);
   let f=foil[mi] as f64/255.0;let g=gloss[mi] as f64/255.0;let shine=(spec*(0.35+1.5*f+0.7*g)+g*0.05+f*0.12)*255.0;
   for channel in 0..3{let base=data[at+channel] as f64*shade;out[at+channel]=clamped_byte(base+if f!=0.0{(255.0-base)*(shine/255.0).min(0.9)*0.9}else{shine*0.6});}
   out[at+3]=if preserve!=0{data[at+3]}else{255};
  }
 }
 1
}

/// Expand three grayscale relief planes in a single transfer. Channel values
/// and opaque alpha are exact; no color-space conversion is performed.
/// # Safety
/// Input contains count*3 bytes and output count*12 writable bytes.
#[no_mangle]
pub unsafe extern "C" fn relief_rgba_planes(input: *const u8, output: *mut u8, count: u32) -> u32 {
    if count == 0 || count > 1_048_576 { return 0; }
    let n = count as usize;
    let source = slice::from_raw_parts(input, n * 3);
    let target = slice::from_raw_parts_mut(output, n * 12);
    for plane in 0..3 {
        for i in 0..n {
            let gray = source[plane * n + i];
            let at = (plane * n + i) * 4;
            target[at..at + 4].copy_from_slice(&[gray, gray, gray, 255]);
        }
    }
    1
}

/// Threshold a membership plane without transferring it back to the host.
/// # Safety
/// Membership and hard each contain count readable/writable elements.
#[no_mangle]
pub unsafe extern "C" fn relief_membership_pixels(membership: *const f32, hard: *mut u8,
    count: u32, from: u32, to: u32) -> u32 {
    if count > 1_048_576 || from > to || to > count || to - from > 4096 { return 0; }
    let source = slice::from_raw_parts(membership, count as usize);
    let target = slice::from_raw_parts_mut(hard, count as usize);
    for i in from as usize..to as usize {
        if !source[i].is_finite() { return 0; }
        target[i] = u8::from(source[i] > 0.0);
    }
    1
}

/// Resolve a physical pigment bevel and exclusive layer ownership.
/// Owner zero builds the standalone byte map; 1..10 updates classification.
/// # Safety
/// Membership, distance and mask contain count elements. Nonzero owner also
/// requires owners/heights; zero owner instead requires height_bytes.
#[no_mangle]
pub unsafe extern "C" fn relief_pigment_pixels(membership: *const f32, distance: *const f32,
    owners: *mut u8, mask: *mut u8, heights: *mut f32, height_bytes: *mut u8,
    count: u32, from: u32, to: u32, bevel: f64, height_mm: f64, owner: u32) -> u32 {
    if count > 1_048_576 || from > to || to > count || to - from > 1024 || owner > 10
        || !bevel.is_finite() || bevel <= 0.0 || !height_mm.is_finite() || height_mm < 0.0 { return 0; }
    let n = count as usize;
    let membership = slice::from_raw_parts(membership, n);
    let distance = slice::from_raw_parts(distance, n);
    let mask = slice::from_raw_parts_mut(mask, n);
    let mut owners = if owner != 0 { Some(slice::from_raw_parts_mut(owners, n)) } else { None };
    let mut heights = if owner != 0 { Some(slice::from_raw_parts_mut(heights, n)) } else { None };
    let mut height_bytes = if owner == 0 { Some(slice::from_raw_parts_mut(height_bytes, n)) } else { None };
    for i in from as usize..to as usize {
        let member = membership[i] as f64;
        let amount = rounded_byte(clamp(member, 0.0, 1.0) * 255.0);
        let t = clamp((distance[i] as f64 - 0.5) / bevel, 0.0, 1.0);
        let soft = t * t * (3.0 - 2.0 * t);
        if owner == 0 {
            mask[i] = amount;
            let raised = member * if member > 0.0 { soft } else { 0.0 };
            height_bytes.as_mut().unwrap()[i] = rounded_byte(clamp(raised * 0.3 / 0.6, 0.0, 1.0) * 255.0);
        } else if amount > mask[i] {
            owners.as_mut().unwrap()[i] = owner as u8;
            mask[i] = amount;
            heights.as_mut().unwrap()[i] = (member * soft * height_mm / 0.6 * 255.0) as f32;
        }
    }
    1
}

/// One bounded bake keeps classified/coating planes in WASM through composition,
/// normals and RGBA expansion. The output slot is reused between final planes;
/// consumers copy a ready plane before stepping again. There is no global cache.
pub struct ReliefRender {
    width: u32, height: u32, flags: u32, unit: f64, layers: u32,
    storage: Vec<u64>, offsets: [usize; 10], cursor: u32, stage: u32,
}
impl ReliefRender {
    fn at(&mut self, index: usize) -> *mut u8 {
        unsafe { self.storage.as_mut_ptr().cast::<u8>().add(self.offsets[index]) }
    }
    unsafe fn step(&mut self) -> i32 {
        let count = self.width * self.height;
        match self.stage {
            0 => {
                let from = self.cursor; let to = (from + 1024).min(count);
                if relief_compose_pixels(self.at(1), self.at(5), self.at(6).cast(), self.at(7).cast(),
                    self.at(8), count, from, to, self.layers) != 1 { return -1; }
                self.cursor = to;
                if to == count { self.cursor = 0; self.stage = 1; }
                if to - from == 1024 { 1 } else { 2 }
            }
            1 => {
                let from = self.cursor; let to = (from + 16).min(self.height);
                if normal_rows(self.at(0), self.at(1), self.at(2), self.at(9), self.width, self.height,
                    from, to, self.flags & 1, (self.flags >> 1) & 1, self.unit,
                    self.flags & 4 != 0, (self.flags >> 3) & 1, self.at(3), self.at(4)) != 1 { return -1; }
                self.cursor = to;
                if to == self.height { self.stage = 2; }
                if to - from == 16 { 1 } else { 2 }
            }
            2 => { self.stage = if self.flags & 32 != 0 { 3 } else { 6 }; 3 }
            3..=5 => {
                let input = match self.stage { 3 => 0, 4 => 3, _ => 4 };
                let source = slice::from_raw_parts(self.at(input), count as usize);
                let target = slice::from_raw_parts_mut(self.at(9), count as usize * 4);
                for (index, &gray) in source.iter().enumerate() {
                    target[index * 4..index * 4 + 4].copy_from_slice(&[gray, gray, gray, 255]);
                }
                let ready = self.stage as i32 + 1; self.stage += 1; ready
            }
            _ => 0,
        }
    }
}

/// flags: owners=1, preserveInk=2, selectionAlpha=4, mask=8, compose=16, RGBA=32.
/// Host uploads buffers before the first step; no input is retained by reference.
#[no_mangle]
pub extern "C" fn relief_render_new(width: u32, height: u32, flags: u32, unit: f64, layers: u32) -> *mut ReliefRender {
    let Some(count) = extent(width, height, 0, 0, height) else { return std::ptr::null_mut(); };
    let compose = flags & 16 != 0;
    if flags > 63 || !unit.is_finite() || layers > 10 || (!compose && layers != 0)
        || (compose && flags & 9 != 9) || (flags & 2 != 0 && flags & 8 == 0) { return std::ptr::null_mut(); }
    let extra = flags & 32 != 0 || flags & 12 == 4;
    let sizes = [if compose { 0 } else { count }, if flags & 1 != 0 { count } else { 0 },
        if flags & 8 != 0 && !compose { count } else { 0 }, if extra { count } else { 0 },
        if extra && !compose { count } else { 0 }, if compose { count } else { 0 },
        if compose { count * 4 } else { 0 }, layers as usize * 8, if compose { count * 3 } else { 0 },
        if compose { 0 } else { count * 4 }];
    let mut offsets = [0; 10]; let mut words = 0;
    for (index, size) in sizes.into_iter().enumerate() { offsets[index] = words * 8; words += size.div_ceil(8); }
    if compose {
        offsets[0] = offsets[8] + count * 2;
        offsets[2] = offsets[8]; offsets[4] = offsets[8] + count;
        // Classification heights are dead after composition; normals/RGBA reuse
        // those four bytes per pixel instead of allocating another output plane.
        offsets[9] = offsets[6];
    }
    Box::into_raw(Box::new(ReliefRender { width, height, flags, unit, layers, offsets,
        storage:vec![0; words], cursor:0, stage:if compose { 0 } else { 1 } }))
}

/// Buffer indices: height, owners, mask, foil, gloss, baseMask, baseHeight(f32),
/// strengths(f64), composed(mask/gloss/height), and shared RGBA output.
/// # Safety
/// The job must be live, writable and used by only one host task at a time.
#[no_mangle]
pub unsafe extern "C" fn relief_render_buffer(job: *mut ReliefRender, index: u32) -> *mut u8 {
    let Some(job) = job.as_mut() else { return std::ptr::null_mut(); };
    if index > 9 { return std::ptr::null_mut(); }
    job.at(index as usize)
}

/// 1 yields, 2 continues, 3..6 expose normal/height/foil/gloss RGBA; 0 is done.
/// # Safety
/// `job` must be a live job and the host must not mutate inputs after stepping.
#[no_mangle]
pub unsafe extern "C" fn relief_render_step(job: *mut ReliefRender) -> i32 {
    job.as_mut().map_or(-1, |job| job.step())
}

/// # Safety
/// Free exactly once, after completion, failure or cancellation; no buffer view
/// may be read afterwards. All input, output and scratch memory is released.
#[no_mangle]
pub unsafe extern "C" fn relief_render_free(job: *mut ReliefRender) {
    if !job.is_null() { drop(Box::from_raw(job)); }
}
