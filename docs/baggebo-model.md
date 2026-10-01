# BAGGEBO 504.811.72

The procedural model uses millimetres, with its top at `y=0`, its feet at
`y=-1160`, its front at `z=0`, and its back at `z=-250`. A different `width`
scales all three axes uniformly; it does not change the furniture proportions.

Sources checked on 2026-10-01:

- [IKEA Spain product page](https://www.ikea.com/es/es/p/baggebo-estanteria-metal-blanco-50481172/): published 600 × 250 × 1160 mm, steel with epoxy/polyester powder coating, polypropylene feet, 12 kg maximum load per shelf.
- [Assembly manual AA-2235400-4](https://www.ikea.com/es/es/assembly_instructions/baggebo-estanteria-metal-blanco__AA-2235400-4-2.pdf), pages 6–9: four uprights, three internal shelves **and a mesh top**, central rear mesh brace, fixing tabs and adjustable feet. The apparently open top in the white product photo is another mesh surface.
- [Official close-up](https://www.ikea.com/es/es/images/products/baggebo-estanteria-metal-blanco__0981564_pe815397_s5.jpg): slender profiles, folded shelf rims, elongated hexagonal apertures and visible fastening tabs.
- [IKEA public product-viewer geometry](https://web-api.ikea.com/dimma/assets/1.2/50481172/PS01_S01_NV01/iqp3/glb/9b8fe0cb424d4ed3b7812cbffd83695f-50481172_PS01_S01_NV01_IQP3_2.0.glb?cn=pip), linked by the product page's `3DModel` JSON-LD. The geometry was inspected as a reference; the app creates its own compact meshes and textures and does not fetch or redistribute that asset.

| Component | Reference measurement |
| --- | --- |
| Internal mesh tops from floor | 154.99, 477.49, 799.99 mm; rounded to 155, 477.5, 800 mm |
| Top mesh from floor | 1159.99 mm; rounded to 1160 mm |
| Rear mesh brace | 216 × 320 mm, between 463.49 and 783.49 mm from floor |
| Expanded sheet depth | 220 mm, 15 mm inset from the overall front/back faces |
| Expanded sheet width | Approximately 567.58 mm; rounded to 567.5 mm |
| Post profile | Approximately 18 mm, allowing 564 mm clear internal width |
| Shelf rim | Approximately 16.5 mm below the surface |

Only the overall dimensions and material specification are published product
measurements. Internal positions above are measurements from IKEA's public
visualization geometry, not manufacturing drawings with certified tolerances.
Mesh pitch, fine bevel radii, coating texture and tiny screw details are visual
approximations from the source photos and assembly illustrations.

Four material batches keep each unit to four draw calls and approximately
70,300 triangles. The expanded metal is now geometry: connected hexagonal
strands with a 0.65 mm pressed profile, two reflecting facets on stretched
strands and flatter connecting bonds. Apertures remain physically empty from
above, below and through the back brace; the standard raycaster and shadow
passes use that same geometry. There is no cutout texture or invisible panel
across the holes, and close views show the strand profile instead of enlarged
alpha-mask pixels. The strand width and pressed profile are visual
approximations, not measured sheet-gauge specifications.

Folded shelf lips, smooth upright corners and bevelled fastener heads add
highlights without changing the overall dimensions or the book baselines.
The neutral white powder coating has a small clear-coat component and a
sub-millimetre bump texture whose UVs use physical millimetres, so grain has
the same scale on a long post and a short rail.

Each model owns and disposes its GPU geometries, materials and paint texture.
Immutable panel vertex arrays are cached on the CPU to avoid rebuilding the
hexagonal pattern when the catalogue reopens; every model receives independent
buffers so disposing a preview cannot invalidate the bookshelf scene.
