//! mapbox/earcut 3.0.1 (the copy inside three@0.180, `ShapeUtils.triangulateShape`), statement by
//! statement, so that every polygon is cut into the same triangles in the same order.
const NIL: usize = usize::MAX;

#[derive(Clone)]
struct Node { i: usize, x: f64, y: f64, prev: usize, next: usize, z: i32, prev_z: usize, next_z: usize, steiner: bool }

struct Earcut<'a> { nodes: Vec<Node>, data: &'a [f64] }

/// Triangulate a polygon given as flat `x, y` pairs: the outer ring first, then every hole starting
/// at the vertex index listed in `hole_indices`. Returns triples of vertex indices.
pub fn triangulate(data: &[f64], hole_indices: &[usize]) -> Vec<usize> {
    let mut e = Earcut { nodes: Vec::new(), data };
    let has_holes = !hole_indices.is_empty();
    let outer_len = if has_holes { hole_indices[0] * 2 } else { data.len() };
    let mut outer = e.linked_list(0, outer_len, true);
    let mut triangles = Vec::new();
    if outer == NIL || e.nodes[outer].next == e.nodes[outer].prev { return triangles; }
    let (mut min_x, mut min_y, mut inv_size) = (0.0, 0.0, 0.0);
    if has_holes { outer = e.eliminate_holes(hole_indices, outer); }
    // if the shape is not too simple, a z-order curve hash is used: calculate the polygon bbox
    if data.len() > 80 * 2 {
        min_x = f64::INFINITY; min_y = f64::INFINITY;
        let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
        let mut i = 2;
        while i < outer_len {
            let (x, y) = (data[i], data[i + 1]);
            if x < min_x { min_x = x; }
            if y < min_y { min_y = y; }
            if x > max_x { max_x = x; }
            if y > max_y { max_y = y; }
            i += 2;
        }
        // Math.max(maxX - minX, maxY - minY)
        let (a, b) = (max_x - min_x, max_y - min_y);
        inv_size = if a.is_nan() || b.is_nan() { f64::NAN } else if a > b { a } else { b };
        inv_size = if inv_size != 0.0 { 32767.0 / inv_size } else { 0.0 };
    }
    e.earcut_linked(outer, &mut triangles, min_x, min_y, inv_size, 0);
    triangles
}

fn js_min(a: f64, b: f64) -> f64 { if a < b { a } else if b < a { b } else if a == b { a } else { f64::NAN } }
fn js_max(a: f64, b: f64) -> f64 { if a > b { a } else if b > a { b } else if a == b { a } else { f64::NAN } }

impl Earcut<'_> {
    fn node(&self, n: usize) -> &Node { &self.nodes[n] }
    fn create(&mut self, i: usize, x: f64, y: f64) -> usize {
        self.nodes.push(Node { i, x, y, prev: NIL, next: NIL, z: 0, prev_z: NIL, next_z: NIL, steiner: false });
        self.nodes.len() - 1
    }
    fn insert(&mut self, i: usize, x: f64, y: f64, last: usize) -> usize {
        let p = self.create(i, x, y);
        if last == NIL {
            self.nodes[p].prev = p; self.nodes[p].next = p;
        } else {
            let after = self.nodes[last].next;
            self.nodes[p].next = after; self.nodes[p].prev = last;
            self.nodes[after].prev = p; self.nodes[last].next = p;
        }
        p
    }
    fn remove(&mut self, p: usize) {
        let (prev, next, prev_z, next_z) = (self.nodes[p].prev, self.nodes[p].next, self.nodes[p].prev_z, self.nodes[p].next_z);
        self.nodes[next].prev = prev; self.nodes[prev].next = next;
        if prev_z != NIL { self.nodes[prev_z].next_z = next_z; }
        if next_z != NIL { self.nodes[next_z].prev_z = prev_z; }
    }
    fn signed_area(&self, start: usize, end: usize) -> f64 {
        let mut sum = 0.0;
        let mut j = end - 2;
        let mut i = start;
        while i < end {
            sum += (self.data[j] - self.data[i]) * (self.data[i + 1] + self.data[j + 1]);
            j = i;
            i += 2;
        }
        sum
    }
    /// A circular doubly linked list from the polygon points in the specified winding order.
    fn linked_list(&mut self, start: usize, end: usize, clockwise: bool) -> usize {
        let mut last = NIL;
        if clockwise == (self.signed_area(start, end) > 0.0) {
            let mut i = start;
            while i < end { last = self.insert(i / 2, self.data[i], self.data[i + 1], last); i += 2; }
        } else {
            let mut i = end as isize - 2;
            while i >= start as isize { let u = i as usize; last = self.insert(u / 2, self.data[u], self.data[u + 1], last); i -= 2; }
        }
        if last != NIL && self.equals(last, self.nodes[last].next) {
            self.remove(last);
            last = self.nodes[last].next;
        }
        last
    }
    fn equals(&self, a: usize, b: usize) -> bool { self.nodes[a].x == self.nodes[b].x && self.nodes[a].y == self.nodes[b].y }
    fn area(&self, p: usize, q: usize, r: usize) -> f64 {
        let (p, q, r) = (self.node(p), self.node(q), self.node(r));
        (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
    }
    /// Eliminate colinear or duplicate points.
    fn filter_points(&mut self, start: usize, end: usize) -> usize {
        if start == NIL { return start; }
        let mut end = if end == NIL { start } else { end };
        let mut p = start;
        loop {
            let mut again = false;
            let (next, prev) = (self.nodes[p].next, self.nodes[p].prev);
            if !self.nodes[p].steiner && (self.equals(p, next) || self.area(prev, p, next) == 0.0) {
                self.remove(p);
                p = prev; end = prev;
                if p == self.nodes[p].next { break; }
                again = true;
            } else {
                p = next;
            }
            if !(again || p != end) { break; }
        }
        end
    }
    /// The main ear slicing loop which triangulates a polygon (given as a linked list).
    fn earcut_linked(&mut self, mut ear: usize, triangles: &mut Vec<usize>, min_x: f64, min_y: f64, inv_size: f64, pass: u32) {
        if ear == NIL { return; }
        // interlink polygon nodes in z-order
        if pass == 0 && inv_size != 0.0 { self.index_curve(ear, min_x, min_y, inv_size); }
        let mut stop = ear;
        // iterate through ears, slicing them one by one
        while self.nodes[ear].prev != self.nodes[ear].next {
            let (prev, next) = (self.nodes[ear].prev, self.nodes[ear].next);
            let is_ear = if inv_size != 0.0 { self.is_ear_hashed(ear, min_x, min_y, inv_size) } else { self.is_ear(ear) };
            if is_ear {
                triangles.extend([self.nodes[prev].i, self.nodes[ear].i, self.nodes[next].i]); // cut off the triangle
                self.remove(ear);
                // skipping the next vertex leads to less sliver triangles
                ear = self.nodes[next].next;
                stop = self.nodes[next].next;
                continue;
            }
            ear = next;
            // if we looped through the whole remaining polygon and can't find any more ears
            if ear == stop {
                if pass == 0 {
                    // try filtering points and slicing again
                    let filtered = self.filter_points(ear, NIL);
                    self.earcut_linked(filtered, triangles, min_x, min_y, inv_size, 1);
                } else if pass == 1 {
                    // if this didn't work, try curing all small self-intersections locally
                    let filtered = self.filter_points(ear, NIL);
                    ear = self.cure_local_intersections(filtered, triangles);
                    self.earcut_linked(ear, triangles, min_x, min_y, inv_size, 2);
                } else if pass == 2 {
                    // as a last resort, try splitting the remaining polygon into two
                    self.split_earcut(ear, triangles, min_x, min_y, inv_size);
                }
                break;
            }
        }
    }
    /// Whether a polygon node forms a valid ear with adjacent nodes.
    fn is_ear(&self, ear: usize) -> bool {
        let (a, b, c) = (self.nodes[ear].prev, ear, self.nodes[ear].next);
        if self.area(a, b, c) >= 0.0 { return false; } // reflex, can't be an ear
        let (ax, bx, cx, ay, by, cy) = (self.nodes[a].x, self.nodes[b].x, self.nodes[c].x, self.nodes[a].y, self.nodes[b].y, self.nodes[c].y);
        let x0 = js_min(js_min(ax, bx), cx); let y0 = js_min(js_min(ay, by), cy);
        let x1 = js_max(js_max(ax, bx), cx); let y1 = js_max(js_max(ay, by), cy);
        let mut p = self.nodes[c].next;
        while p != a {
            let n = self.node(p);
            if n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1
                && point_in_triangle_except_first(ax, ay, bx, by, cx, cy, n.x, n.y)
                && self.area(n.prev, p, n.next) >= 0.0 { return false; }
            p = n.next;
        }
        true
    }
    fn is_ear_hashed(&self, ear: usize, min_x: f64, min_y: f64, inv_size: f64) -> bool {
        let (a, b, c) = (self.nodes[ear].prev, ear, self.nodes[ear].next);
        if self.area(a, b, c) >= 0.0 { return false; } // reflex, can't be an ear
        let (ax, bx, cx, ay, by, cy) = (self.nodes[a].x, self.nodes[b].x, self.nodes[c].x, self.nodes[a].y, self.nodes[b].y, self.nodes[c].y);
        let x0 = js_min(js_min(ax, bx), cx); let y0 = js_min(js_min(ay, by), cy);
        let x1 = js_max(js_max(ax, bx), cx); let y1 = js_max(js_max(ay, by), cy);
        // z-order range for the current triangle bbox
        let min_z = z_order(x0, y0, min_x, min_y, inv_size);
        let max_z = z_order(x1, y1, min_x, min_y, inv_size);
        let mut p = self.nodes[ear].prev_z;
        let mut n = self.nodes[ear].next_z;
        let inside = |s: &Self, q: usize| {
            let t = s.node(q);
            t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1 && q != a && q != c
                && point_in_triangle_except_first(ax, ay, bx, by, cx, cy, t.x, t.y) && s.area(t.prev, q, t.next) >= 0.0
        };
        // look for points inside the triangle in both directions
        while p != NIL && self.nodes[p].z >= min_z && n != NIL && self.nodes[n].z <= max_z {
            if inside(self, p) { return false; }
            p = self.nodes[p].prev_z;
            if inside(self, n) { return false; }
            n = self.nodes[n].next_z;
        }
        // look for remaining points in decreasing z-order
        while p != NIL && self.nodes[p].z >= min_z {
            if inside(self, p) { return false; }
            p = self.nodes[p].prev_z;
        }
        // look for remaining points in increasing z-order
        while n != NIL && self.nodes[n].z <= max_z {
            if inside(self, n) { return false; }
            n = self.nodes[n].next_z;
        }
        true
    }
    /// Go through all polygon nodes and cure small local self-intersections.
    fn cure_local_intersections(&mut self, mut start: usize, triangles: &mut Vec<usize>) -> usize {
        let mut p = start;
        loop {
            let a = self.nodes[p].prev;
            let pn = self.nodes[p].next;
            let b = self.nodes[pn].next;
            if !self.equals(a, b) && self.intersects(a, p, pn, b) && self.locally_inside(a, b) && self.locally_inside(b, a) {
                triangles.extend([self.nodes[a].i, self.nodes[p].i, self.nodes[b].i]);
                // remove two nodes involved
                self.remove(p);
                let next = self.nodes[p].next;
                self.remove(next);
                p = b; start = b;
            }
            p = self.nodes[p].next;
            if p == start { break; }
        }
        self.filter_points(p, NIL)
    }
    /// Try splitting the polygon into two and triangulate them independently.
    fn split_earcut(&mut self, start: usize, triangles: &mut Vec<usize>, min_x: f64, min_y: f64, inv_size: f64) {
        // look for a valid diagonal that divides the polygon into two
        let mut a = start;
        loop {
            let mut b = self.nodes[self.nodes[a].next].next;
            while b != self.nodes[a].prev {
                if self.nodes[a].i != self.nodes[b].i && self.is_valid_diagonal(a, b) {
                    // split the polygon in two by the diagonal
                    let mut c = self.split_polygon(a, b);
                    // filter colinear points around the cuts
                    let an = self.nodes[a].next;
                    a = self.filter_points(a, an);
                    let cn = self.nodes[c].next;
                    c = self.filter_points(c, cn);
                    // run earcut on each half
                    self.earcut_linked(a, triangles, min_x, min_y, inv_size, 0);
                    self.earcut_linked(c, triangles, min_x, min_y, inv_size, 0);
                    return;
                }
                b = self.nodes[b].next;
            }
            a = self.nodes[a].next;
            if a == start { break; }
        }
    }
    /// Link every hole into the outer loop, producing a single-ring polygon without holes.
    fn eliminate_holes(&mut self, hole_indices: &[usize], mut outer: usize) -> usize {
        let mut queue: Vec<usize> = Vec::new();
        for (i, &hole) in hole_indices.iter().enumerate() {
            let start = hole * 2;
            let end = if i < hole_indices.len() - 1 { hole_indices[i + 1] * 2 } else { self.data.len() };
            let list = self.linked_list(start, end, false);
            if list == self.nodes[list].next { self.nodes[list].steiner = true; }
            queue.push(self.get_leftmost(list));
        }
        // Array#sort is stable: an insertion sort over the comparator keeps equal holes in order.
        let mut sorted: Vec<usize> = Vec::new();
        for item in queue {
            let mut at = sorted.len();
            while at > 0 && self.compare_xy_slope(sorted[at - 1], item) > 0.0 { at -= 1; }
            sorted.insert(at, item);
        }
        // process holes from left to right
        for hole in sorted { outer = self.eliminate_hole(hole, outer); }
        outer
    }
    fn compare_xy_slope(&self, a: usize, b: usize) -> f64 {
        let (na, nb) = (self.node(a), self.node(b));
        let mut result = na.x - nb.x;
        // when the left-most point of 2 holes meet at a vertex, sort the holes counterclockwise
        if result == 0.0 {
            result = na.y - nb.y;
            if result == 0.0 {
                let (ax, bx) = (self.node(na.next), self.node(nb.next));
                let a_slope = (ax.y - na.y) / (ax.x - na.x);
                let b_slope = (bx.y - nb.y) / (bx.x - nb.x);
                result = a_slope - b_slope;
            }
        }
        result
    }
    /// Find a bridge between vertices that connects a hole with an outer ring and link it.
    fn eliminate_hole(&mut self, hole: usize, outer: usize) -> usize {
        let bridge = self.find_hole_bridge(hole, outer);
        if bridge == NIL { return outer; }
        let bridge_reverse = self.split_polygon(bridge, hole);
        // filter collinear points around the cuts
        let next = self.nodes[bridge_reverse].next;
        self.filter_points(bridge_reverse, next);
        let next = self.nodes[bridge].next;
        self.filter_points(bridge, next)
    }
    /// David Eberly's algorithm for finding a bridge between a hole and the outer polygon.
    fn find_hole_bridge(&self, hole: usize, outer: usize) -> usize {
        let mut p = outer;
        let (hx, hy) = (self.nodes[hole].x, self.nodes[hole].y);
        let mut qx = f64::NEG_INFINITY;
        let mut m = NIL;
        // find a segment intersected by a ray from the hole's leftmost point to the left;
        // the segment's endpoint with lesser x will be the potential connection point
        if self.equals(hole, p) { return p; }
        loop {
            let pn = self.nodes[p].next;
            if self.equals(hole, pn) { return pn; }
            else if hy <= self.nodes[p].y && hy >= self.nodes[pn].y && self.nodes[pn].y != self.nodes[p].y {
                let x = self.nodes[p].x + (hy - self.nodes[p].y) * (self.nodes[pn].x - self.nodes[p].x) / (self.nodes[pn].y - self.nodes[p].y);
                if x <= hx && x > qx {
                    qx = x;
                    m = if self.nodes[p].x < self.nodes[pn].x { p } else { pn };
                    if x == hx { return m; } // hole touches the outer segment; pick the leftmost endpoint
                }
            }
            p = pn;
            if p == outer { break; }
        }
        if m == NIL { return NIL; }
        // look for points inside the triangle of hole point, segment intersection and endpoint;
        // if there are none, we have a valid connection; otherwise choose the point of the
        // minimum angle with the ray as connection point
        let stop = m;
        let (mx, my) = (self.nodes[m].x, self.nodes[m].y);
        let mut tan_min = f64::INFINITY;
        p = m;
        loop {
            let (px, py) = (self.nodes[p].x, self.nodes[p].y);
            if hx >= px && px >= mx && hx != px
                && point_in_triangle(if hy < my { hx } else { qx }, hy, mx, my, if hy < my { qx } else { hx }, hy, px, py) {
                let tan = (hy - py).abs() / (hx - px); // tangential
                if self.locally_inside(p, hole)
                    && (tan < tan_min || (tan == tan_min && (px > self.nodes[m].x || (px == self.nodes[m].x && self.sector_contains_sector(m, p))))) {
                    m = p;
                    tan_min = tan;
                }
            }
            p = self.nodes[p].next;
            if p == stop { break; }
        }
        m
    }
    /// Whether the sector in vertex m contains the sector in vertex p in the same coordinates.
    fn sector_contains_sector(&self, m: usize, p: usize) -> bool {
        self.area(self.nodes[m].prev, m, self.nodes[p].prev) < 0.0 && self.area(self.nodes[p].next, m, self.nodes[m].next) < 0.0
    }
    /// Interlink polygon nodes in z-order.
    fn index_curve(&mut self, start: usize, min_x: f64, min_y: f64, inv_size: f64) {
        let mut p = start;
        loop {
            if self.nodes[p].z == 0 { self.nodes[p].z = z_order(self.nodes[p].x, self.nodes[p].y, min_x, min_y, inv_size); }
            self.nodes[p].prev_z = self.nodes[p].prev;
            self.nodes[p].next_z = self.nodes[p].next;
            p = self.nodes[p].next;
            if p == start { break; }
        }
        let before = self.nodes[p].prev_z;
        self.nodes[before].next_z = NIL;
        self.nodes[p].prev_z = NIL;
        self.sort_linked(p);
    }
    /// Simon Tatham's linked list merge sort algorithm.
    fn sort_linked(&mut self, mut list: usize) -> usize {
        let mut in_size = 1;
        loop {
            let mut p = list;
            list = NIL;
            let mut tail = NIL;
            let mut num_merges = 0;
            while p != NIL {
                num_merges += 1;
                let mut q = p;
                let mut p_size = 0;
                for _ in 0..in_size {
                    p_size += 1;
                    q = self.nodes[q].next_z;
                    if q == NIL { break; }
                }
                let mut q_size = in_size;
                while p_size > 0 || (q_size > 0 && q != NIL) {
                    let e;
                    if p_size != 0 && (q_size == 0 || q == NIL || self.nodes[p].z <= self.nodes[q].z) {
                        e = p; p = self.nodes[p].next_z; p_size -= 1;
                    } else {
                        e = q; q = self.nodes[q].next_z; q_size -= 1;
                    }
                    if tail != NIL { self.nodes[tail].next_z = e; } else { list = e; }
                    self.nodes[e].prev_z = tail;
                    tail = e;
                }
                p = q;
            }
            self.nodes[tail].next_z = NIL;
            in_size *= 2;
            if num_merges <= 1 { break; }
        }
        list
    }
    /// Find the leftmost node of a polygon ring.
    fn get_leftmost(&self, start: usize) -> usize {
        let mut p = start;
        let mut leftmost = start;
        loop {
            let (n, l) = (self.node(p), self.node(leftmost));
            if n.x < l.x || (n.x == l.x && n.y < l.y) { leftmost = p; }
            p = n.next;
            if p == start { break; }
        }
        leftmost
    }
    /// Whether a diagonal between two polygon nodes is valid (lies in the polygon interior).
    fn is_valid_diagonal(&self, a: usize, b: usize) -> bool {
        let (na, nb) = (self.node(a), self.node(b));
        self.nodes[na.next].i != nb.i && self.nodes[na.prev].i != nb.i && !self.intersects_polygon(a, b)
            && (self.locally_inside(a, b) && self.locally_inside(b, a) && self.middle_inside(a, b)
                && (self.area(na.prev, a, nb.prev) != 0.0 || self.area(a, nb.prev, b) != 0.0)
                || self.equals(a, b) && self.area(na.prev, a, na.next) > 0.0 && self.area(nb.prev, b, nb.next) > 0.0)
    }
    /// Whether two segments intersect.
    fn intersects(&self, p1: usize, q1: usize, p2: usize, q2: usize) -> bool {
        let sign = |n: f64| if n > 0.0 { 1 } else if n < 0.0 { -1 } else { 0 };
        let o1 = sign(self.area(p1, q1, p2));
        let o2 = sign(self.area(p1, q1, q2));
        let o3 = sign(self.area(p2, q2, p1));
        let o4 = sign(self.area(p2, q2, q1));
        if o1 != o2 && o3 != o4 { return true; } // general case
        if o1 == 0 && self.on_segment(p1, p2, q1) { return true; } // p1, q1 and p2 are collinear and p2 lies on p1q1
        if o2 == 0 && self.on_segment(p1, q2, q1) { return true; }
        if o3 == 0 && self.on_segment(p2, p1, q2) { return true; }
        if o4 == 0 && self.on_segment(p2, q1, q2) { return true; }
        false
    }
    /// For collinear points p, q, r: whether q lies on the segment pr.
    fn on_segment(&self, p: usize, q: usize, r: usize) -> bool {
        let (p, q, r) = (self.node(p), self.node(q), self.node(r));
        q.x <= js_max(p.x, r.x) && q.x >= js_min(p.x, r.x) && q.y <= js_max(p.y, r.y) && q.y >= js_min(p.y, r.y)
    }
    /// Whether a polygon diagonal intersects any polygon segments.
    fn intersects_polygon(&self, a: usize, b: usize) -> bool {
        let mut p = a;
        let (ai, bi) = (self.nodes[a].i, self.nodes[b].i);
        loop {
            let pn = self.nodes[p].next;
            if self.nodes[p].i != ai && self.nodes[pn].i != ai && self.nodes[p].i != bi && self.nodes[pn].i != bi && self.intersects(p, pn, a, b) { return true; }
            p = pn;
            if p == a { break; }
        }
        false
    }
    /// Whether a polygon diagonal is locally inside the polygon.
    fn locally_inside(&self, a: usize, b: usize) -> bool {
        let (prev, next) = (self.nodes[a].prev, self.nodes[a].next);
        if self.area(prev, a, next) < 0.0 { self.area(a, b, next) >= 0.0 && self.area(a, prev, b) >= 0.0 }
        else { self.area(a, b, prev) < 0.0 || self.area(a, next, b) < 0.0 }
    }
    /// Whether the middle point of a polygon diagonal is inside the polygon.
    fn middle_inside(&self, a: usize, b: usize) -> bool {
        let mut p = a;
        let mut inside = false;
        let px = (self.nodes[a].x + self.nodes[b].x) / 2.0;
        let py = (self.nodes[a].y + self.nodes[b].y) / 2.0;
        loop {
            let (n, nn) = (self.node(p), self.node(self.nodes[p].next));
            if ((n.y > py) != (nn.y > py)) && nn.y != n.y && (px < (nn.x - n.x) * (py - n.y) / (nn.y - n.y) + n.x) { inside = !inside; }
            p = n.next;
            if p == a { break; }
        }
        inside
    }
    /// Link two polygon vertices with a bridge; on one ring it splits the polygon in two, between
    /// the outer ring and a hole it merges them into a single ring.
    fn split_polygon(&mut self, a: usize, b: usize) -> usize {
        let (ai, ax, ay) = (self.nodes[a].i, self.nodes[a].x, self.nodes[a].y);
        let (bi, bx, by) = (self.nodes[b].i, self.nodes[b].x, self.nodes[b].y);
        let a2 = self.create(ai, ax, ay);
        let b2 = self.create(bi, bx, by);
        let an = self.nodes[a].next;
        let bp = self.nodes[b].prev;
        self.nodes[a].next = b;
        self.nodes[b].prev = a;
        self.nodes[a2].next = an;
        self.nodes[an].prev = a2;
        self.nodes[b2].next = a2;
        self.nodes[a2].prev = b2;
        self.nodes[bp].next = b2;
        self.nodes[b2].prev = bp;
        b2
    }
}

fn z_order(x: f64, y: f64, min_x: f64, min_y: f64, inv_size: f64) -> i32 {
    // coords are transformed into a non-negative 15-bit integer range
    let mut x = to_int32((x - min_x) * inv_size);
    let mut y = to_int32((y - min_y) * inv_size);
    x = (x | (x << 8)) & 0x00FF00FF;
    x = (x | (x << 4)) & 0x0F0F0F0F;
    x = (x | (x << 2)) & 0x33333333;
    x = (x | (x << 1)) & 0x55555555;
    y = (y | (y << 8)) & 0x00FF00FF;
    y = (y | (y << 4)) & 0x0F0F0F0F;
    y = (y | (y << 2)) & 0x33333333;
    y = (y | (y << 1)) & 0x55555555;
    x | (y << 1)
}
/// JavaScript's `ToInt32` of a number (`| 0`).
fn to_int32(value: f64) -> i32 {
    if !value.is_finite() { return 0; }
    let t = value.trunc();
    let m = t.rem_euclid(4294967296.0);
    (m as u64 as u32) as i32
}
/// Whether a point lies within a convex triangle.
#[allow(clippy::too_many_arguments)]
fn point_in_triangle(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64, px: f64, py: f64) -> bool {
    (cx - px) * (ay - py) >= (ax - px) * (cy - py)
        && (ax - px) * (by - py) >= (bx - px) * (ay - py)
        && (bx - px) * (cy - py) >= (cx - px) * (by - py)
}
/// Like `point_in_triangle` but false if the point equals the first point of the triangle.
#[allow(clippy::too_many_arguments)]
fn point_in_triangle_except_first(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64, px: f64, py: f64) -> bool {
    !(ax == px && ay == py) && point_in_triangle(ax, ay, bx, by, cx, cy, px, py)
}
