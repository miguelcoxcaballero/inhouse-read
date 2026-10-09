# Continuación del 9 de octubre: reutilización de la portada detallada

## Cambio candidato 1.7.111

El modelo temporal preparado en reposo y el libro seleccionado reutilizan
la impresión detallada de la misma portada. Cada material conserva su propia
textura; el Source y sus píxeles se comparten sin marcar otra subida al GPU.
Solo se retiene una impresión por imagen decodificada, hasta 2.097.152 píxeles
(8 MiB RGBA). La última copia visible libera la base. Cambios de dimensiones,
título o color sustituyen la impresión; las copias que siguen vivas conservan
sus píxeles. Las portadas normales de estantería mantienen su ruta anterior.

No se cambian resolución, geometría, iluminación, materiales, relojes,
plazos, aserciones ni fixtures de los recorridos originales. No se incorporan
voces ni se cambia Drive en esta versión.

## Evidencia conservada

Directorio ignorado: `.animation.local/performance-1812/`.

- El primer diagnóstico de atlas se atascó durante la importación del servidor
  de desarrollo; se conservó y terminó su helper propio. El segundo, compilado,
  obtuvo el atlas original: 6.291.456 B, gzip 740.641 B, preparación 1.140,2 ms.
  No se incorpora ese atlas ni se declara que resuelva la lentitud.
- Los perfiles separados de los recorridos nativos originales con instrumentación
  conservaron los límites y pasaron ambos; no sustituyen las ejecuciones sin
  instrumentos. Su primera preparación tenía un import incorrecto, conservado.
- Focales: 109/109 PASS, incluidos diez casos nuevos de reutilización, liberación,
  límites y modelos reales. Los archivos de pruebas anteriores siguen intactos.
- Comparación de píxeles: textura RGBA y tres fotogramas GPU reales (0°, 35°, 90°)
  exactamente iguales entre control y candidato. Segunda ejecución independiente:
  píxeles pintados 118.391/109.962/32.816, errores GL cero. La primera lectura GPU
  obtuvo cuadros transparentes y no acredita imagen real; se conserva aparte.
- Una pareja aislada de construcción dio 7,2 ms frente a 4,6 ms; no prueba una
  mejora sostenida ni velocidad global, FPS o comportamiento en teléfono físico.

La batería completa, publicación y verificación del artefacto candidato están
pendientes. La versión 1.7.110 sigue publicada hasta completar esos pasos.
Los dos timeouts originales de CI110 y la captura parcial de walnut permanecen
registrados; no se consideran corregidos por estas pruebas focales.
