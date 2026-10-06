# Web 1.7.99: nombres editados al mostrar el lector

La precarga puede terminar despues de editar titulo y autor en la ficha.
Antes de revelar el lector ya preparado se reconcilian esos dos campos
con el libro seleccionado. No se abre otra vez el archivo, ni se cambian
sus bytes, posicion, formato o metadatos del documento.

La reproduccion valida anterior conserva3PASS/1FAIL: el handoff real
mostraba Tiny/Old. Tras la correccion pasan los cuatro casos. Dos intentos
previos de preparar la reproduccion fallaron por el propio harness y
se conservan; no son fallos del producto ni pruebas validas del antes.

Bateria completa:3.512/3.512 unitarias en288 archivos, build y92 Python
PASS. Censo526 sin skips es listado, no ejecucion de navegadores.
Fuente/config/pruebas protegidas antes/despues. E2E original de nombres,
web publica, offline y CI completa pendientes de comprobar.

Android1.1.7/codigo20 ya verificado: APK78.531.659B, loader2107B,
firma original. EmuladorAndroid15:367.682ms bloqueado,368,913s de audio,
23 capitulos, pausa/reanudar/parar y salto PDF PASS. No mide rendimiento,
temperatura o bateria del movil fisico. No se ha realizado login Google
real en esta tanda ni agregado nuevos hablantes.
