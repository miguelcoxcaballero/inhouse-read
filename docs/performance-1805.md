# Web 1.7.105: preparar los materiales del marcapaginas antes del cierre

La pagina real preparada al abrir aporta un locator valido. El modelo
prepara su cinta con ese locator sin guardar progreso prematuramente ni
redibujar el libro oculto. Se usa la misma geometria, material y buffer
que despues reaparecen al cerrar. Invalidaciones se restauran incluso
si la preparacion falla; actualizaciones visibles conservan su ruta.

Una pulsacion inmediata puede interrumpir el calentamiento de shaders.
Al retener el modelo detras del lector se completa la reflexion de sus
materiales en slices idle sin frames extra. Se detiene al destruir,
seleccionar otro libro o iniciar la devolucion; la vista tambien controla
su propia disposicion. No se cambian duraciones, DPR, luces ni acabados.

Focales: primer intento36/42 (seis nuevas comprobaciones de no-mutacion
incluian la normalizacion previa del autor); segundo42/42; despues de
anadir cancelacion/continuidad idle44/44 PASS. Assertions originales sin
cambios. Bateria completa final en curso.

Diagnostico393 SwiftShader con deadlines originales30s/8s:
antes1047252,9ms; preparacion de cinta sola6512,7ms; cinta+idle5106,6ms.
Son muestras independientes, no una prueba de aceleracion sostenida.
Los75 getUniformLocation persisten (35 bookmark,40 insercion); por tanto
no se afirma que esta intervencion elimine todo el trabajo tardio ni que
resuelva los fallos de CI104. No hay medicion en telefono fisico.

Publicacion, calificacion original local y publicos105 pendientes.

Bateria local final3587/291 unitarias, build y92 Python PASS.
Censo526 listado; no se acredita como ejecucion E2E. Hashes de fuentes
antes/despues exactos. APK descargado1.1.7/code20: bytes78531659, SHA,
firma y loader2107B PASS. No cambio nativo ni nueva firma necesaria.

Siete originales locales PASS sin retries y fuente exacta. Dos originales
SwiftShader PASS sin retries/deadlines30s/8s intactos;393 cierra6406,7ms.
La bateria CI completa y el artefacto publico105 siguen pendientes.

Publicado5bcda05a4e219e1dbbce993c7b53d53293adaf1c; Pages
c22d9a4553fef7117297c144c5e3624dc1b12bc0. Main610767B,
SHAfdece46e8add774bfacb76833fe69f07209c39de7d02cfc991386b1c0961783c.
Pin/HTTP32/shell96 exactos PASS.32/32 originales publicados PASS
(18 PDF,5 edicion/gestos/retorno,5 catalogo,4 Android Abrir con),
sin retries y auditorias estrictas PASS. Offline4 PASS: bytes/progreso,
fotos originales/cinco temas, encoderJPEG real y primera portada al
cerrar de inmediato. El batch conserva FAIL de harness por intentar
repetir local-seven en un directorio ya existente: no se ejecuto ni se
reintento ninguna prueba local adicional. La tanda local original7/7
sigue intacta y sus hashes coinciden con las fuentes publicadas.
CI105 original37563781668 completa aun pendiente.

CI105 parcial conserva FAIL en EPUB paginated resume: primer intento
resumed.highlight vacio, retry PASS. La traza original muestra lectura
de la llamada40 antes de start (atStart=null), y una segunda lectura
13ms despues con atStart=Paragraph10 correcto. El test compone resumed
a partir de dos evaluaciones: conserva el objeto de la primera captura.
Es un fallo de observacion demostrado; no se cambia el original ni se
acredita como PASS. UI3 tambien finaliza FAIL; analisis y censo total
pendientes. Las tres familias Piper completadas PASS con pesos reales.

CI105 UI3: ambos nativos primer intento y retry timedOut30s. La traza
390 pulsa Back27,52s despues del inicio; el cierre comienza cuando el
presupuesto global restante es2,5s. La espera8s queda cortada por el
teardown de30s.393 inicia Back a25,37s; no se borra ningun fallo.
Diagnostico completo de105:393 PASS25,1s,170 uniforms previos/40 en
insercion, cero perdidos, tamanos live768x512/768x640/786x640.
El recorte ya estaba activo; no se propone activarlo de nuevo.

CI105 completa37563781668 FAIL:526 casos/529 intentos, tres retries y
cinco intentos fallidos,11 ZIP/12 jobs. Solo UI1 (captura EPUB resume)
yUI3 (dos nativos30s) fallan. Todos los otros bloques, incluidas las
cuatro familias de voces con sus pesos reales, PASS. Snapshot004 conserva
originales y digests autenticados. No se acredita la bateria entera como PASS.
