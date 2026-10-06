# Reserva por fases al cerrar — 1.7.91

Al terminar el zoom de la página se libera su reserva de framebuffer.
Marcapáginas, bisagra y vuelo mantienen sus reservas por movimiento y la
misma proyección, DPR, materiales y relojes. Liberar no dibuja ni redimensiona;
el siguiente frame realiza su ajuste habitual. `finally` libera también en
cancelaciones o errores anteriores al zoom, sin repetir la liberación.
La apertura y las devoluciones sin snapshot conservan su ciclo original.

## Regresiones y calidad

Pasan 25 pruebas relacionadas, incluidas seis regresiones nuevas. El control
conserva los bytes exactos de 1.7.90: falla en dos de los casos nuevos porque
retiene la reserva durante las fases siguientes; pasa los otros cuatro.
No es una medición de GPU ni FPS.

Pasan 3.474 pruebas unitarias en 280 archivos, la compilación y 75 pruebas
Python, con 660 hechos fuente estables. Los 524 casos listados son un censo;
esa operación no ejecuta pruebas de navegador.

Los 18 pares de imágenes WebGL2, con cinta visible, mate, oro, plata y
varias poses, conservan RGBA exactos después de liberar la reserva.
Pasan los 16 recorridos locales originales sin reintentos: siete generales,
dos SwiftShader, dos de reutilización y luces, y cinco del catálogo.
Se mantienen los plazos originales de 30 segundos y ocho segundos.
Los cierres de la tanda general duran 5.113,8 y 5.332,8 ms. No demuestran
una ganancia causal de FPS ni velocidad en un teléfono.

## Publicación

Fuente: `0f4e58a006d8613496accf5e1b5890ebf7466484`.
Deploy a la rama: `37443146319` aprobado.
Pages: `8289ebee65fbae1ffb5ebe5d5233771bad19144d`, atribuido a esa fuente.
La primera descarga del HTML recibió todavía la versión anterior; se
conserva como fallo de identidad y no se cuenta como prueba aprobada.
GitHub Pages está procesando el despliegue; sus comprobaciones públicas
siguen pendientes. CI completa nueva: `37443146284`, en marcha.

Evidencia local: `.animation.local/performance-1791/`, incluidos
`before-control/`, `full-local-resource2-attempt1/`,
`phase-release-pixels-attempt1/`, `local-browser-attempt1/`,
`swiftshader-original-attempt1/`, `return-regressions-attempt1/`,
`catalog-browser-attempt1/` y `public-0f4e58a-attempt1/pin-failure.json`.

## Comprobaciones independientes durante la espera

Pasan las 18 pruebas locales originales de PDF (fotos en cinco temas,
orden y párrafos completos, navegación y progreso), sin reintentos.
Son adicionales a los 16 recorridos gráficos: 34 locales en total.
No se cuentan como ejecuciones sobre la web publicada.

La descarga fresca del APK 1.1.4, código 17, pasa: 78.515.243 bytes y
SHA256 `feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
El manifiesto HTTP coincide con el de esta fuente; el loader de 2.089 bytes
coincide y conserva sólo el puente y la redirección a producción. Esto
verifica el APK nativo sin atribuirle la nueva web aún pendiente. El error
preparatorio al buscar el manifiesto en la raíz se conserva; el archivo
fuente correcto es `public/android-update.json`.

Evidencia: `pdf-local-attempt1/`, `apk-independent-attempt1/` y
`apk-independent-preparation-error.json`.

## Resultado de la publicación real

El primer despliegue automático de Pages quedó en `waiting` durante
quince minutos. Se conservó su estado, se canceló sólo ese procesamiento
pendiente y se reenviaron los mismos bytes mediante un avance normal de
`gh-pages`, sin force push ni cambio de políticas. El árbol Git es idéntico:
`2280a2ab5977080b5900d4f414a40ac54c573f29`.
Pages `e7accdfa5128bf688f92324bc52d38229e618735` y su procesamiento
`37445100866` pasan. La primera comprobación de identidad fallida se
conserva: no se presenta como aprobada ni como una ejecución de producto.

HTML y main HTTP coinciden exactamente con ese árbol. Main
`assets/main-CAYqOssu.js`: 593.822 bytes,
SHA256 `aa7346a33ee6a881acc0d1cfc44b02ca1729bc4071e885f355960deb641cf707`.
Pasan los 32 módulos y los 96 recursos del shell. Los 26 recorridos públicos
originales y sus auditorías pasan sin reintentos: tres generales, 18 PDF y
cinco del catálogo. Los cinco temas físicos y sus snapshots estabilizados
pasan offline, con el worker y SW reales; cero lecturas de píxeles en main.
La portada JPEG offline conserva 800 × 1.600 y 150.310 bytes, sin fallback.

La app completa importa offline, conserva los 3.143 bytes originales del PDF
(SHA256 `9093ab4bd41c9efc8c77088a86b1f48a9782cee1b98b2282fab78e8a52f0907b`),
sus imágenes RGB y la posición `textOffset:115` al cerrar, recargar y reabrir.
`driveFileId:null`: no exige subirlo para conservarlo localmente.

## CI completa: siguen pendientes dos casos nativos

`37443146284` termina FAILED. Snapshot-003 conserva 11 artefactos y
12 trabajos: 524 casos únicos, 526 intentos, dos retries y cuatro intentos
fallidos. Sólo UI3 falla; las otras cinco UI y las cuatro tandas con los
pesos reales de Piper/Supertonic pasan. En ambos casos nativos el canvas
PDF permanece oculto para la espera original de ocho segundos; también
fallan sus retries. No se cambian los plazos generales de 30 segundos.
La captura posterior ya muestra el PDF, sin convertir en aprobada la espera
fallida ni deducir que toda la lentitud esté resuelta. No es una prueba de
FPS, temperatura, batería de teléfono ni login de una cuenta real de Google.

Evidencia: `public-0f4e58a-attempt2/`,
`pages-same-tree-resubmission-attempt1/` y
`ci-original-37443146284-attempt1/snapshot-003/`.

## Comparación local adicional, separada de las calificaciones

Se declararon de antemano seis ejecuciones independientes, alternando
90/91/91/90/90/91. Se sirven localmente los archivos de ambas publicaciones
con sus SHA exactos, sin alterar la prueba nativa original ni sus plazos
30s/8s, con un trabajador y cero retries. Pasan las seis.
Cierres 1.7.90: 5.287,4 / 5.121,2 / 5.285,8 ms.
Cierres 1.7.91: 4.896,3 / 5.072,9 / 4.945,2 ms.
Medianas: 5.285,8 frente a 4.945,2 ms (6,4% menor en esta muestra local).
Son tres muestras por versión en un navegador de Windows: no constituyen
una ganancia causal general de FPS ni una prueba de velocidad de teléfono.
No reemplazan la CI fallida ni se suman a los 34 recorridos calificados.

Se conservan y excluyen los dos errores preparatorios: la reconstrucción
isolada cambió el hash del bundle, y `git archive` convirtió LF a CRLF.
La segunda extracción usa `core.autocrlf:false` y mantiene los hashes
publicados exactos. Ninguno de esos errores ejecutó una prueba de producto.
Evidencia: `ab-return-control/preparation-errors.json`,
`ab-return-control/raw-comparison-preparation.json`,
`ab-return-control/raw-comparison-summary.json` y `runs-raw/`.

Este cierre del informe sólo modifica documentación. El código calificado
sigue siendo la fuente `0f4e58a006d8613496accf5e1b5890ebf7466484`; la
CI original permanece FAILED. No se repite el despliegue de los mismos
archivos ni se presenta el commit documental como una nueva calificación.
