# Rust lamp state and shadow policy

The shelf module now owns fixture counting and lexical quota order, candidate-rank invalidation, light-change stamps, shadow-cache invalidation/transport decisions, previous local/room transforms and filament change detection. Three.js creation, scene access, material application, shadow-map actions and browser locale collation remain host operations.

`LampLightState` combines the existing exact numeric light computation with its persistent cache decisions in one call per fixture. It caches the linear colour and display-hex conversion until its exact source inputs change, preserving signed zeros and NaNs. A raw non-number emitter flag retains the previous stamp semantics for undefined/string values. Switching and fading still do not regenerate unchanged depth maps; a uniform whole-room movement still transports the cached shadow.

`LampPoolState` retains quotas and reuses the plan's sort/order/priority/assignment vectors. Only structural pool changes return a payload to JavaScript. The host keeps bounded identity ids; Rust requests locale ranks only when candidate membership/order changes. All persistent fixture/pool state is freed on removal/disposal.

Validation against the frozen original:

- 22 unit tests, including 17,360 scripted room frames and 4,622,421 exact light/scene facts, with no unexpected differences.
- Real Chromium: 3,271 frames and 695,718 exact facts, including 514 filament frames, with zero retained JavaScript/WASM handles.
- Additional checks cover unchanged-colour host-math avoidance, exact NaN/non-number invalidation, retained quota ordering and rank-cache invalidation.

A warmed local Node benchmark compared this change with the manager from `423ce4ba` (1.7.306), alternating seven rounds of 5,000 updates with eight lamps. Median CPU time was 97.67 -> 75.83 ms for settled rooms and 106.34 -> 84.50 ms for moving rooms, approximately 22% and 21% less time respectively. These measurements cover the lighting manager only; they do not establish whole-app frame rate, phone temperature or battery improvement. The separate Chromium fixture compares against the older pre-migration JavaScript implementation and is not used to attribute this patch's speedup.
