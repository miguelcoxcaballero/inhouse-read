# Preparación de programas de inserción — 1.7.85 en comprobación

El perfil anterior localizó reflexión de uniforms durante paintInsertionOverlay.
Los programas de profundidad y del indicador ya se enlazaban después del
primer frame de la estantería. Ahora también preparan los mismos uniforms,
uno por intervalo libre, usando el helper existente. La destrucción del
propietario cancela el trabajo pendiente y los errores conservan el dibujo
normal. No se dibuja una vista previa ni se cambian materiales, resolución,
variantes o relojes de animación.

Seis pruebas nuevas y 30 enfocadas PASS: espera por idle, deduplicación,
conservación de geometría/material, cancelación antes del enlace y antes de
la reflexión, propagación del error y contrato para renderers de prueba.
Evidencia: `.animation.local/insertion-warmup-focused-attempt1.json`.
La batería completa y los gráficos todavía están pendientes; no publicada.

Batería completa local PASS: 3.436 unitarias/274 archivos, build y
75 Python. Fuente653 y métodos exactos. El censo524 es sólo listado,
no ejecución E2E. Evidencia: `.animation.local/performance-1785/full-local-resource2-attempt1/`.

Catorce recorridos originales locales PASS, cero retries: siete de
apertura/cierre/editor/gestos, cinco de catálogo/plantas/luces y dos de
reutilización y cambios de luces. Métodos y fuente653 exactos; relojes
originales. Los cierres nativos medidos son 5.226,2 y 4.894,2 ms en estos
recorridos. No es una mejora causal porcentual ni un benchmark de teléfono.
Evidencia: `.animation.local/performance-1785/`.

Los dos casos originales adicionales de SwiftShader PASS en su primer
intento: 26,9 y 25,7 s completos, con límites originales de 30/8 s.
Sus FAIL de 1.7.84 permanecen registrados y no se sustituyen. Esta aprobación
es local Windows y no acredita rendimiento en un teléfono ni causa porcentual.
Evidencia: `swiftshader-original-attempt1/` de performance-1785.
