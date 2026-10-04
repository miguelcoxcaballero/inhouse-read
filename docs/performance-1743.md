# Fluidez en 1.7.43

## Cambios

- El libro activo se presenta directamente en un único contexto GPU adicional. Las exportaciones y la inserción conservan un snapshot real, preparado sólo cuando se necesita. El modelo retenido vuelve a presentar directamente después de cambiar de host, y el desvanecimiento mantiene su última imagen.
- El papel opaco llena primero el depth buffer. El libro conserva geometría, materiales, reflejos, texturas, DPR y relojes de movimiento; las superficies ocultas pueden rechazar fragmentos antes de sombrearlos.
- La estantería evita recorrer sus descendientes varias veces y no se repinta por metadatos sin efecto visual. Los catálogos reutilizan dimensiones, límites y sombras que siguen siendo válidos.
- Los PDF adaptables preparan imágenes y texto fuera del DOM visible, en lotes con tareas MessageChannel. Cancelar o fallar conserva la página anterior y libera los recortes.

## Mediciones aisladas

Chromium, 390 × 844, DPR 2, SwiftShader. Son mediciones de renderizado por software, no del teléfono del usuario.

| Operación | Antes | Candidato |
| --- | ---: | ---: |
| Actualización de metadatos sin cambio visual | 587,6 ms; 1 render | 0,8 ms; 0 renders |
| Escrituras del backing canvas en tres reaperturas de catálogo | 6 | 0 |
| Cierre completo con seis libros, una planta y una lámpara | 12.334,5 ms | 10.643,1 ms |

El cierre de esa escena exigente mejora aproximadamente un 14 %, pero **sigue excediendo ocho segundos**. No se considera resuelto ese presupuesto en esta fixture. El primer candidato directo no mejoró el cierre; sus resultados se conservan.

Un PDF real con 1.000 imágenes, bajo CPU ×4, reduce la mayor tarea bloqueante de 421 a 68 ms y el mayor intervalo sin atender tareas de 399,9 a 66,1 ms. La carga completa pasa de 1.078,3 a 1.152,3 ms: mejora de respuesta, sin afirmar una carga total más rápida en ese documento extremo. Texto, 1.000 recortes y capturas permanecen idénticos.

Seis poses de estantería, quince capturas completas de catálogos y veintiocho comparaciones de poses de libro a DPR 2 y 1,5 tienen cero diferencias de píxeles entre las fuentes congeladas. Las verificaciones del build final y de la publicación tienen resultados separados.

## Coste y comprobación

El contexto adicional está limitado a uno para toda la app; no se crea uno por libro. Mantiene su entorno PMREM y framebuffer, por lo que aumenta la memoria GPU de forma acotada. No se afirma neutralidad de memoria. El lector inactivo continúa sin renderizar la escena 3D.

La batería completa, la web pública y el APK publicado se verifican antes del informe final. Las pruebas originales mantienen sus aserciones y presupuestos. No se atribuye una medición física de FPS, temperatura o consumo a las mediciones de SwiftShader.
