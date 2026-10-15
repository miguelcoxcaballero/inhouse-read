//! Cabinet contact shadows. Positions and linear RGBA retain the original
//! triangle order; trigonometric samples are supplied by the browser.
struct Mesh<'a> { out: &'a mut [f32], vertices: usize, at: usize, ink: [f64; 3] }
type Point = [f64; 3];
impl Mesh<'_> {
    fn vertex(&mut self, p: Point, alpha: f64) {
        let n = self.at;
        self.at += 1;
        for axis in 0..3 {
            self.out[n * 3 + axis] = p[axis] as f32;
            self.out[self.vertices * 3 + n * 4 + axis] = self.ink[axis] as f32;
        }
        self.out[self.vertices * 3 + n * 4 + 3] = alpha as f32;
    }
    fn ramp(&mut self, a: Point, b: Point, c: Point, e: Point, dark: f64, clear: f64) {
        for (p, alpha) in [(a,dark),(b,dark),(c,clear),(a,dark),(c,clear),(e,clear)] {
            self.vertex(p, alpha);
        }
    }
}

/// # Safety
/// Params has 10 + rows + footprints*3 + 80 f64 values: width, height, depth and floorY as given
/// (the cabinet frame, the ground and the shelf order are derived here), the floor light's RGBA,
/// the shelf bottoms as given (the finite, non-negative and new ones are kept, ascending), the
/// valid footprints (x, z, radius) and the host's trigonometry. Output has
/// (bottoms*78 + 66 + lit*360 + footprints*300)*7 f32 values, `bottoms` being the kept ones; the
/// return value is the vertex count. All buffers are disjoint and owned by the host.
#[no_mangle]
pub unsafe extern "C" fn shelf_occlusion(params: *const f64, rows: usize,
    footprints: usize, lit: u32, output: *mut f32) -> usize {
    if rows > 100_000 || footprints > 100_000 || lit > 1 { return 0; }
    let p = std::slice::from_raw_parts(params, 90 + rows + footprints * 3);
    let frame = crate::cabinet_model::frame(p[0], p[1], p[2]);
    let (w, h, d, side, inner) = (frame.w, frame.h, frame.d, frame.side, frame.inner);
    let mut kept = crate::cabinet_model::shelf_bottoms(&p[10..10 + rows]);
    kept.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let bottoms = &kept[..];
    let feet = &p[10 + rows..10 + rows + footprints * 3];
    let trig = &p[10 + rows + footprints * 3..];
    let vertices = bottoms.len() * 78 + 66 + lit as usize * 360 + footprints * 300;
    let mut m = Mesh { out: std::slice::from_raw_parts_mut(output, vertices * 7), vertices, at: 0, ink: [0.0;3] };
    let ground = (if p[3].is_finite() { p[3] } else { -h }) + 0.25;
    let back = -d + 2.0 + 0.3;
    let (left,right,wall_l,wall_r) = (-inner/2.0, inner/2.0, -w/2.0+side+0.3, w/2.0-side-0.3);
    let mut ceiling = -12.0;
    for &bottom in bottoms {
        let (floor,top) = (-bottom, ceiling);
        let (rail,lift) = (floor+5.0, floor+0.3);
        let tall = (top-floor).max(1.0);
        let (under,above) = ((tall*0.34).min(52.0), (tall*0.22).min(34.0));
        m.ramp([left,top,back],[right,top,back],[right,top-under,back],[left,top-under,back],0.5,0.0);
        m.ramp([left,rail,back],[right,rail,back],[right,rail+above,back],[left,rail+above,back],0.42,0.0);
        m.ramp([left,floor,back],[left,top,back],[left+30.0,top,back],[left+30.0,floor,back],0.34,0.0);
        m.ramp([right,floor,back],[right,top,back],[right-30.0,top,back],[right-30.0,floor,back],0.34,0.0);
        m.ramp([left,lift,-d+8.3],[right,lift,-d+8.3],[right,lift,-d+52.0],[left,lift,-d+52.0],0.42,0.0);
        m.ramp([wall_l,lift,-d],[wall_l,lift,8.0],[wall_l+20.0,lift,8.0],[wall_l+20.0,lift,-d],0.3,0.0);
        m.ramp([wall_r,lift,-d],[wall_r,lift,8.0],[wall_r-20.0,lift,8.0],[wall_r-20.0,lift,-d],0.3,0.0);
        for x in [wall_l,wall_r] {
            m.ramp([x,floor,-d+2.0],[x,top,-d+2.0],[x,top,-d+46.0],[x,floor,-d+46.0],0.42,0.0);
            m.ramp([x,top,-d],[x,top,7.0],[x,top-under*0.8,7.0],[x,top-under*0.8,-d],0.38,0.0);
            m.ramp([x,floor,-d],[x,floor,7.0],[x,floor+22.0,7.0],[x,floor+22.0,-d],0.3,0.0);
        }
        ceiling = floor-15.0;
    }
    if lit == 1 {
        m.ink = [p[6],p[7],p[8]];
        let corners = [[1.0,1.0,0.85,0.8],[-1.0,1.0,0.06,0.3],[-1.0,-1.0,0.06,0.3],[1.0,-1.0,0.85,0.3]];
        let ring = |scale:f64| -> [Point;20] { std::array::from_fn(|i| {
            let [sx,sz,rx,rz] = corners[i/5];
            [sx*(w/2.0+rx*d*scale*trig[i*2].abs()),ground,
             (if sz<0.0 {-d-3.0} else {8.0})+sz*rz*d*scale*trig[i*2+1].abs()]
        }) };
        let steps = [[0.0,1.0],[0.28,0.72],[0.6,0.3],[1.0,0.0]];
        for step in 0..3 {
            let inside=ring(steps[step][0]); let outside=ring(steps[step+1][0]);
            for i in 0..20 { let next=(i+1)%20;
                m.ramp(inside[i],inside[next],outside[next],outside[i],p[9]*steps[step][1],p[9]*steps[step+1][1]);
            }
        }
        m.ink = [0.0;3];
    }
    let rect = |x0,x1,z0,z1| [[x0,ground,z1],[x1,ground,z1],[x1,ground,z0],[x0,ground,z0]];
    let rings = [
        (rect(-w/2.0+2.0,w/2.0-2.0,-d-1.0,6.0),0.62),
        (rect(-w/2.0-4.0,w/2.0+14.0,-d-14.0,15.0),0.26),
        (rect(-w/2.0-12.0,w/2.0+46.0,-d-42.0,30.0),0.0)
    ];
    let (core,alpha) = rings[0];
    m.ramp(core[0],core[1],core[2],core[3],alpha,alpha);
    for band in 0..2 { let (inside,dark)=rings[band]; let (outside,clear)=rings[band+1];
        for i in 0..4 { let next=(i+1)%4; m.ramp(inside[i],inside[next],outside[next],outside[i],dark,clear); }
    }
    let rise=(h*0.12).min(44.0);
    for x in [-w/2.0-0.3,w/2.0+0.3] {
        m.ramp([x,ground,-d-3.0],[x,ground,3.0],[x,ground+rise,3.0],[x,ground+rise,-d-3.0],0.3,0.0);
    }
    for foot in feet.chunks_exact(3) {
        let (x,z,radius)=(foot[0],foot[1],foot[2]);
        let circle=|scale:f64,dx:f64,dz:f64| -> [Point;20] { std::array::from_fn(|i|
            [x+dx+trig[40+i*2]*radius*scale,ground,z+dz+trig[41+i*2]*radius*scale]) };
        let inside=circle(0.78,0.0,0.0); let middle=circle(1.04,2.0,-2.0); let outside=circle(1.42,6.0,-6.0);
        for i in 0..20 { let next=(i+1)%20;
            for point in [[x,ground,z],inside[i],inside[next]] { m.vertex(point,0.56); }
            m.ramp(inside[next],inside[i],middle[i],middle[next],0.56,0.22);
            m.ramp(middle[next],middle[i],outside[i],outside[next],0.22,0.0);
        }
    }
    m.at
}
