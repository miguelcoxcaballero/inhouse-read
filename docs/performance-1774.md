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
