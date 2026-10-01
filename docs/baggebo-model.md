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

Four material batches keep each unit to four draw calls. Expanded metal uses a
small repeating cutout texture shared between colour and shadow passes. Its
raycast override also checks apertures, so the back panel has real holes for
picking rather than behaving as a solid printed rectangle. Each model owns and
disposes its GPU geometries, materials, shadow materials and textures; immutable
mask pixels are cached to avoid recomputing them when the catalogue opens again.
