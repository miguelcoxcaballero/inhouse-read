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
`.animation.local/performance-1782/`. Batería local completa: 3.417 unitarias en 271 archivos, build y
75 Python PASS; siete recorridos gráficos, cinco de catálogo y dos
regresiones adicionales PASS, sin retries. No se afirma mejora de FPS ni ejecución en un teléfono.


## Publicación comprobada

Pages `af8c4a1`, fuente `a5d91be`; entrada `main-alvQMpSZ.js`, 591.519 bytes,
SHA256 `f749642095e5863cf825b6d1f6b9b8f1bda1be7c6d5d58888a0022b3b4c9f836`.
Primer pin conserva el índice anterior durante propagación; segundo PASS.
HTTP32/offline96, nueva descarga APK 1.1.4/code17 y loader exacto PASS.
Sólo loader de 2.089 bytes y dos scripts Cordova, sin copia antigua de app;
no se afirma ejecución nueva en teléfono. Tres recorridos públicos PASS,
sin retries, con auditoría HTTP aprobada. Los 18 PDF públicos PASS, sin
retries. Papel offline v4 y default/reuseSettledLayout v5 PASS en cinco temas,
con los mismos píxeles, copias nuevas e identidades conservadas; cero lecturas
de píxeles en el hilo principal. Portada offline PASS: JPEG 800×1600,
150.310 bytes, sin fallback. Los cinco casos públicos de catálogo/plantas/luces PASS, sin retries;
los 26 recorridos públicos pasan y mantienen fuente y main recibido.
No es una aprobación global ni un benchmark de teléfono;
CI original `37406627167` FAILED: las 524 identidades se ejecutaron
en 528 intentos, con cuatro retries y ocho intentos fallidos. UI3 falla
en dos aperturas nativas (PDF aún oculto, plazos originales 8/30 s) y en
el primer frame con una lámpara tras recarga (8 s). UI6 falla en el primer
frame de tres lámparas tras recarga (8 s). Todos fallan también al repetir.
Unitarias, cuatro trabajos de voces con pesos reales y UI1/2/4/5 PASS.
Los 11 ZIP, 12 logs y el censo completo se conservan en
`.animation.local/performance-1782/ci-original-37406627167-attempt1/`.
Los recorridos públicos aprobados no sustituyen esta batería fallida.
