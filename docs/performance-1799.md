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
Fuente/config/pruebas protegidas antes/despues. E2E original de nombres PASS; los dos regresos SwiftShader originales PASS,
cero retries. HTTP32/shell96 de la web publicada PASS. La primera fijacion
fallo por el ref local de Pages aun sin fetch; se conserva. Segunda fijacion:
fuente97f529da382c2c1898cd91e9a080fbe6a9dc126b, Pages62abee4e1956d25be7c50b71003794265ae893c4.
Tanda publica27/28 estrictos PASS: falla la auditoria del editor con cuerpo
walnut0B recibido por Playwright, HTTP200; no se convierte en PASS. Titulo y
autor, gesto y ambos regresos PASS;18 PDF y cinco catalogo/plantas/luces PASS.
Offline:bytes3143, posicion115, colores originales, cinco temas y portada
800x1600/150310B con workers reales PASS. Dos invocaciones iniciales offline
no llegaron al navegador por omitir el argumento de artefacto; se conservan.
CI original37547047713 en comprobacion. Diagnostico independiente del cierre
con SwiftShader:resize del ancho del libro402,6ms; otras dos operaciones
resize657,3 y410ms. No es una medicion del movil ni garantia de velocidad.

Android1.1.7/codigo20 ya verificado: APK78.531.659B, loader2107B,
firma original. EmuladorAndroid15:367.682ms bloqueado,368,913s de audio,
23 capitulos, pausa/reanudar/parar y salto PDF PASS. No mide rendimiento,
temperatura o bateria del movil fisico. No se ha realizado login Google
real en esta tanda ni agregado nuevos hablantes.
