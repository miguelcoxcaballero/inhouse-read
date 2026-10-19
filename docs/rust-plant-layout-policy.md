# Plant layout and touch policy in Rust

`plant_layout_policy.rs` owns dimension-table lookup/copy rules, catalogue size labels, scene-size multiplication, tap-width thresholds, rectangular/square padding, nearest-centre picking and legacy rooftop coordination. Physical size tables and the shelf packing solver were already Rust and remain unchanged.

The JavaScript modules retain exported table references and the Decor core's scalar-buffer ABI. Reading these tables, computing shelf scale and reading book spine options still work before the Shelf module is ready; the migration adds no top-level await or serial startup dependency. The layout callback delegates to the same existing `layoutShelvedObjects` core adapter.

Native policies preserve the identity of layout entries, their DOM nodes, retained output rectangles and shared metadata. Roof packing snapshots its selected entries before updating DOM annotations, while annotations follow live iteration. Metadata spread preserves symbols and own `__proto__` fields; output writes fail for read-only targets as before. Throwing accessors/conversions release native handles, and a failed target iteration closes the source iterator. Callbacks can safely invoke layout helpers again without a mutable Rust borrow surviving the call.

Validation compares the frozen immediately preceding implementation over catalogue combinations, padded rectangles, nonfinite/coerced inputs, nearest-centre ties, cabinet types, widths and crowded rooftop overflow. Existing tests also cover tall plants fitted within their original bays, physical scale, all 49 catalogue models, and projected book picking. Geometry, foliage, camera code and numerical packing are not modified.
