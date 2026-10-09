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

## Publicación y comprobación 1.7.111

Fuente `70bea2896b93363e68fcfd9709cb87e2822e3153`; Pages
`1cdcfba73095e400ab50f1c9b91422418ab57617`. Main `main-DiqxdBWE.js`,
614.461 B, SHA256 `dd9153a37921103e2b6a52143dbe974b9ec609b6609c8d7a42016f113d41d103`.
El primer pin recibió HTML anterior; se conserva FAIL. Una lectura posterior
acreditó la propagación y el segundo pin coincidió. Grafo HTTP 32 y shell 96
exactos respecto a los objetos Git inmutables de Pages.

Batería local: 3.639 unitarias/295 archivos, build y 105 Python PASS. Los siete
recorridos locales originales PASS sin retries. Comparación SwiftShader:
control 25.777/22.690 ms, candidato 24.452/25.249 ms; ambos PASS. Las diferencias
de esta pareja no prueban aceleración global. 698 archivos de fuente permanecen
exactos entre la batería local y el final de las comprobaciones públicas.

Web real: 32/32 casos completaron las aserciones de producto, 29/32 auditorías
estrictas PASS. Dos PDF y el caso de nombres fallaron en la captura de cuerpos
de walnut (parcial o vacía). Esos tres originales siguen FAIL. Los dos regresos
nativos, catálogo 5 y puente Android 4 PASS. Offline 4 PASS para bytes/progreso,
RGB original en cinco temas, portada JPEG y cierre inmediato.

APK 1.1.8/code21 descargado: 78.531.695 B, SHA, firma, manifest y loader de
2.107 B PASS. Ensayo nuevo del APK público `37993145787`: ZIP original
8.920.241 B autenticado y cinco estados nativos analizados PASS. El preflight
Google acepta la solicitud; no acredita cuenta humana autenticada.

CI completa `37992986160` sigue pendiente en este punto. Piper engine, reading
y languages concluyeron PASS; falta la auditoría completa de los originales.
Supertonic sigue en curso. Los dos timeouts originales de CI110 y las capturas
de walnut permanecen registrados. El rendimiento global aún no está resuelto.
