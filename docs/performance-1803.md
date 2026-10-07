# Web1.7.103: conservar la primera portada al cerrar

Una importacion rapida podia cerrar el PDF y cancelar su primera portada
antes de guardarla. La captura de CI101 muestra la pipeta sin imagen y el
mensaje de que no se pudo leer la portada. Ya no se trata una primera
extraccion como una mejora opcional de resolucion.

El motor captura el documento y conserva su loadingTask solo hasta acabar
esa primera extraccion. La UI del lector se limpia inmediatamente; el cierre
no espera la promesa de portada. El ultimo trabajo libera el PDF, tambien
si falla o se cancela. El raster, limite1600px y calidadJPEG0.9 se mantienen,
con el mismo encoder real en worker. Las mejoras de una portada ya existente
siguen cancelandose al cerrar.

La app permite guardar el resultado retenido durante un cierre explicito
mientras el libro se devuelve o el lector esta cerrado. Una sesion nueva
recupera los controles anteriores: un trabajo sustituido no guarda su
resultado ni impide iniciar otro. El patch conserva los campos actuales,
no reemplaza otra portada y valida la revision capturada cuando existe.
Un libro eliminado no se vuelve a crear por una captura tardia.

41 pruebas enfocadas PASS, incluidos todos los assertions anteriores.
Se añaden12 casos. El control sobre la fuente original102 calibrado conserva
15PASS/9FAIL (24 casos); dos casos nuevos ya funcionaban. Los ensayos de
harness anteriores se conservan y no acreditan resultados de producto.
El primer full conserva3564/3566 PASS: dos regresiones de sesion detectadas,
que se corrigen sin alterar los tests originales. Bateria final PASS:3.567/291, build y92 Python. Censo526 E2E listado,
no acredita su ejecucion. Hashes de fuentes antes/despues coinciden.
Original smoke de importacion/edicion/pipeta PASS en su primer intento,
22,3s total, sin retries y con fixtures/assertions originales intactos.
La reproduccion sobre la web real102 y su cache offline conserva FAIL:
al solicitar la portada y cerrar inmediatamente, devuelve null (Cover missing).
Despliegue, comparacion publicada103 y CI103 pendientes.

102 ya publicado:32/32 publicos estrictos, offline3, siete locales y APK
real1.1.7/firma/loader PASS.267 casos originales de CI102 disponibles sin
retries/fallos; ambos cierres6.468,2/6.324,7ms PASS. Falta auditoria completa.
No hay una medicion de FPS, bateria o temperatura en un telefono fisico.

## Publicacion y primera comprobacion real

Fuente f28233e8aa2304afbb8bac8332074107965f9229, Pages
164479e977e80233f2b1e892e572641f0fd11ae4. Main610.020B/SHA256
4556657f9c7107ac5bc742fe74edfef0b870c87de0cf40aa6f2b93e986b4b5a2.
HTTP32/shell96 PASS. Reproduccion inmediata del fallo102 sobre103 PASS:
PDF y encoder reales desde el cache del service worker, sin Internet,
portada800x1600, JPEG150.310B, cero fallbacks. Identidad de recursos
verificada; no mocks de engine ni sustitucion de respuestas de la app.
El APK se vuelve a descargar:1.1.7/codigo20,78.531.659B, firma y
loader2.107B PASS. No cambia el wrapper nativo. Publicos completos yCI103
aun en curso. CI102 completa:526/526, cero retries/fallos y voces realesPASS.

## Tanda publica completa103

32/32 publicos estrictos PASS, sin retries; auditorias incluidas.
18 PDF, cinco edicion/animacion, cinco catalogo/plantas/luces y cuatro
Android Abrir con. Tres recorridos offline originales PASS: bytes3.143,
locator115 persistido al reabrir, fotos originales, cinco temas exactos y
encoderJPEG real sin fallback. La primera portada tras cierre inmediato
agrega una cuarta comprobacion offline PASS, con su fallo102 conservado.
Quedan los siete locales en ejecucion y la CI103 original completa.

Los siete originales locales PASS sin retries. CI103 conserva un primer
fallo en cierre393 (8s); retry PASS6882,2ms no borra el fallo.390
PASS6743,2ms. El resto de la auditoria completa sigue pendiente.
