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
