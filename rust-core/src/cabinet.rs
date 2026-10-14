//! The physical cabinets: IKEA's published BAGGEBO measures (mm) and the
//! wooden cabinet built to the same outer size and compartments. Shared by the
//! shelf tables (app core) and the plant sizes (decor core).
#[cfg(feature="decor")]
use crate::jsnum;

pub struct Spec {
    pub width: f64, pub depth: f64, pub height: f64, pub post_size: f64, pub shelf_rim_height: f64,
    pub shelf_bottoms: [f64; 3],
}
pub const BAGGEBO: Spec = Spec { width: 600.0, depth: 250.0, height: 1160.0, post_size: 18.0,
    shelf_rim_height: 16.5, shelf_bottoms: [360.0, 682.5, 1005.0] };
// The wooden cabinet is built to the same outer size and compartments.
pub const WALNUT: Spec = Spec { width: BAGGEBO.width, depth: BAGGEBO.depth, height: BAGGEBO.height,
    post_size: BAGGEBO.post_size, shelf_rim_height: BAGGEBO.shelf_rim_height, shelf_bottoms: BAGGEBO.shelf_bottoms };
/// Millimetres from the floor to the top of each interior shelf, from the top.
#[cfg(feature="app")]
pub const SHELF_HEIGHTS_FROM_FLOOR: [f64; 3] = [800.0, 477.5, 155.0];
#[cfg(feature="app")]
pub const USABLE_DEPTH: f64 = 220.0;

/// Free height (mm) between a shelf board and the underside of the one above:
/// the smallest compartment of a cabinet.
#[cfg(feature="decor")]
pub fn clearance(spec: &Spec) -> f64 {
    let mut least = f64::INFINITY;
    for (slot, bottom) in spec.shelf_bottoms.iter().enumerate() {
        let below = if slot > 0 { spec.shelf_bottoms[slot - 1] + spec.shelf_rim_height } else { spec.post_size };
        least = jsnum::min(least, bottom - below);
    }
    least
}
