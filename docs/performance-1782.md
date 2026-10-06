# Entrega del lote de shaders — 1.7.82

## Cambio y límites

`compilePrograms` entrega explícitamente el lote completo al driver con
`flush`, después de compilar las variantes de pantalla/transmisión y restaurar
el render target. Se hace una vez si hay programas, antes de consultar su
preparación. Sigue el mecanismo que ya usa `prelinkPrograms`; no espera por
el enlace, no dibuja ni cambia materiales, iluminación, DPR, samplers o
relojes. El límite original de enlace y las aserciones E2E se conservan.
No se atribuye al ajuste la causa de los fallos anteriores de primer frame:
la entrega no garantiza que los enlaces terminen en un tiempo concreto.

Seis regresiones nuevas distinguen envío de finalización y cubren transmisión,
polls, renderer antiguo, lote vacío y objetos ocultos preparados. Código
1.7.81: cuatro FAIL/dos PASS; ajuste: 24 PASS en dos archivos, incluidas las
originales de programas. Los informes anteriores quedan conservados en
`.animation.local/performance-1782/`. Batería completa en marcha; publicación
pendiente. No se afirma mejora de FPS ni ejecución en un teléfono.
