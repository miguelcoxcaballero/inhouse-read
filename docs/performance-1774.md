# Texturas de la página PDF — 1.7.74

Los snapshots de un render físico PDF completado reciben una identidad de
píxeles independiente de la medición del tono del papel. La identidad sólo
pertenece a sus copias originales y se invalida al cambiar documento, render,
página, dimensiones, filtro o tema. Las copias siguen siendo nuevas y conservan
los píxeles, el tamaño y los colores originales.

El modelo conserva sus dos texturas y su geometría si ambas identidades y sus
dimensiones coinciden con la página instalada. Actualiza el locator, los límites
y la mezcla entre papel blanco y tema del lector. Una página diferente, un
snapshot DOM o una copia sin identidad registrada sigue la ruta original.
No cambia el sampler, la iluminación, los modelos, la resolución ni los relojes.

La regresión nueva falla antes de cambiar el modelo: la textura se recreaba.
Tras la corrección pasan 122 pruebas enfocadas en cinco archivos. Se conserva
también un error del primer test de ciclo de vida: llamaba a goToLocator en el
PdfReader, cuya API es goToPage; corregida sólo esa llamada del test nuevo.
Evidencia local: `.animation.local/performance-1774/`.

La batería completa y las comprobaciones de la publicación tienen resultados
separados; este primer informe no afirma que hayan pasado ni acredita FPS,
temperatura o reproducción indefinida en un teléfono físico.

## Publicación comprobada — fuente 0884c9d

Batería local: 3.353 unitarias en 262 archivos, build y 75 pruebas Python
PASS. Los siete recorridos gráficos originales pasan sin reintentos;
los cierres completos duran 4.947,1 y 5.338,2 ms, dentro de 8 s.

La publicación real conserva 32 módulos del grafo y 96 recursos del shell.
Pasan los tres recorridos públicos de editor/retorno y los 18 de PDF, sin
omisiones ni reintentos. El lector PDF y worker publicados funcionan offline
en cinco temas; ambas copias del raster conservan los mismos píxeles y el
papel original conserva su hash entre temas. La portada JPEG 800×1600
se codifica con el worker real sin Internet, sin fallback.

El APK 1.1.4/código 17 descargado de nuevo coincide con el firmado conocido:
78.515.243 bytes y SHA-256 feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191.
Su index.html tiene 2.089 bytes y coincide con el loader de producción;
assets/public sólo contiene ese loader y los dos shims de Cordova.
No se presenta como nueva compilación nativa ni medición en teléfono físico.

CI 37381481159 conserva fallos originales de apertura/retorno en UI3 y del
contador de programas de Monstera en UI4. Los otros cuatro jobs de interfaz
(UI1/2/5/6), unitarias y los tres jobs Piper pasan; Supertonic también termina PASS; el agregado termina FAILED. No se declara aprobación global. Los ZIP y
logs originales se recogerán al acabar, manteniendo los fallos.

El diagnóstico separado SwiftShader/CDP pasa tres casos; incorpora backend
forzado y sobrecarga de traza y no sustituye el resultado original de CI.
La preparación decía inicialmente un caso; el grep efectivo del config
seleccionó tres, tal como muestran el censo y el informe original.

Evidencia: `.animation.local/performance-1774/`, especialmente
`public-0884c9d-attempt1/`. No se acredita autenticación real de Google,
FPS, temperatura o batería de un dispositivo físico.
