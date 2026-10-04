# Rendimiento de 1.7.51

## Captura del gesto de cámara

Cuando las vistas fine y overview comparten exactamente el mismo frame, la
primera captura nueva del batch síncrono puede alimentar la segunda mediante
copia 2D. Se comprueban identidad del frame, contexto, revisiones y dimensiones.
Se conserva la revisión independiente de cada vista y no se persiste el recibo.
Los exports externos nunca reutilizan un canvas que pudo modificar su consumidor;
las vistas distintas, antiguas o de dimensiones diferentes conservan su captura.

No cambian geometría, texturas, materiales, sombras, DPR, resolución,
antialiasing, duración o límites de avance de la animación.

## Controles causales y visuales

Propuesta aislada: 21/21 unitarias, ocho nuevas y trece originales intactas.
El control exacto de 1.7.50 pasa 19 y conserva dos fallos nuevos por hacer dos
capturas GPU en lugar de una. Los casos de exportación modificada, revisiones
independientes, dimensiones, frames y respaldo pasan en ambas fuentes.
Certificado bajo `.animation.local/performance-1751/inspection-capture-proposal-attempt2/`,
`cpu-attempt1/summary.json`, SHA
`01169f94ac5e6ec31ac4a6e082b03c7cc1c523422bcc80533d68f2f3ff6e93a6`.

El primer método conserva FAILED: descubrió los trece originales pero ninguno
de los ocho nuevos debido a los separadores Windows del include. Su guard lo
detectó antes de lanzar el control. El segundo método utiliza rutas relativas
con slash; candidato y assertions tienen los mismos bytes.

El oráculo real compara ocho pares fine/overview a DPR 1,5 y 2:
64.341.600 componentes RGBA, cero diferencias; ocho PNG nativos exactos.
Utiliza los cuerpos literales de captura, binds y callsites de las dos fuentes,
con el mismo renderer, contexto, modelos, materiales, antialiasing y sombras
de 1.024. Incluye transparencia parcial, bordes, plantas y metales con relieve.
Cada batch pasa de dos capturas GPU a una captura y una copia 2D.
Los 32 PNG, 16 RGBA y 651 inputs mantienen sus hashes. Se inspeccionó la captura
de madera, libros y helecho. Certificado `inspection-capture-quality-attempt1/summary.json`,
SHA `bb42d6db0312151d62f9f86cc5a4610abf4712ea93422c2e39cc946ca61bbe96`.
No se infiere una mejora temporal ni un resultado en teléfono desde estos datos.

## Fuente final

Se adoptó únicamente la escena candidata, los ocho tests nuevos con adaptación
de imports por su ubicación en `tests/unit`, y la versión del paquete/footer.
La batería completa local pasa 2.865/2.865 unitarias en 211 archivos, build y
51 + 24 pruebas Python. Los 488 inputs permanecen intactos. Lista 524 identidades
E2E sin omisiones: esa enumeración no ejecuta los navegadores.
Evidencia `full-local-attempt1/summary.json` bajo `.animation.local/performance-1751/`.

Los siete recorridos originales locales pasan al primer intento, cero retries,
flaky u omitidos. Conservan las assertions y plazos originales, incluidos los
ocho segundos del cierre y treinta globales de los contratos nativos. Sus
cierres son 5.351,5 y 6.288,1 ms. El gesto original registra veinte composiciones,
cero nuevos renders de escena y dos escrituras de buffer; conserva geometrías,
texturas, programas y los seis libros a resolución 1.024. No se presenta una
diferencia entre ejecuciones como mejora temporal general.
Evidencia `local-browser-attempt1/summary.json` y sus métricas originales.

Pendientes: CI original completa y comprobación de web/APK publicados.
Se conservan los fallos de 1.7.50:
sus cuatro intentos nativos de CI quedan en la fase de apertura `zooming`,
con el PDF ya preparado pero oculto. El cierre no llegó a ejecutarse.
Los controles locales y públicos no sustituyen esa CI. No se ha medido
temperatura, batería o fluidez de un teléfono físico.
