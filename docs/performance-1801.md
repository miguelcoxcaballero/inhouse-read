# Web 1.7.101: priorizar el documento de Abrir con

El diagnostico de los cuatro casos Android originales observa que la sala
se construye antes de abrir el documento. Hay tareas largas de219-457ms
en la construccion y140-810ms durante sus primeras presentaciones. Son
observaciones locales con SwiftShader, no tiempos de un telefono fisico.
Los cuatro casos diagnosticos PASS, sin alterar sus assertions ni esperas.

La importacion ahora anuncia actividad antes de leer sus bytes. La
estanteria conserva sus actualizaciones pendientes mientras se transfiere
el archivo y se abre el lector. Se comprueba el bloqueo antes y despues
de los awaits de biblioteca y metadatos. Volver a home permite construir
la misma sala con los registros actuales; un fallo de importacion reanuda
la estanteria. Una bandeja vacia no cambia el arranque normal. Un error
de almacenamiento mantiene la copia nativa y no repite actualizaciones
del escenario en cada poll. No cambian modelos, texturas, luces ni DPR.

La primera reserva propuesta conservaba la lectura inicial vacia al
aplazar su primer render: el fragmento real de arranque reproduce FAIL
antes de la correccion. Se descarta esa lectura unica aun si el escenario
se aplaza; la vuelta consulta los bytes recien guardados. Se conserva la
regresion y se comprueba ademas con los Abrir con originales completos.

36 pruebas enfocadas PASS antes de esa correccion. Bateria final completa:
3.536/3.536 unitarias en290 archivos, build y92 comprobaciones Python PASS.
Hay ocho pruebas nuevas. Censo526 sin skips es un listado, no ejecucion E2E.
La primera bateria3.535 PASS conserva la propuesta anterior; el guard de
lectura inicial fallo despues en una reproduccion aparte. Solo la segunda
bateria con la regresion nueva acredita la correccion final. Fuentes,
configuracion y pruebas protegidas antes/despues de cada bateria.
Los cuatro originales Android con observador diagnostico y SwiftShader PASS,
cero retries: app cerrada, abierta, OAuth pendiente y worker WebView antiguo.
Mantienen todos los gestos, fixtures, assertions y esperas originales.
La vuelta muestra el libro guardado y se verifican sus bytes exactos.
No es la bateria E2E completa ni un benchmark. El titulo del primer documento
frio aparece a425/479/464ms en los tres diagnosticos correspondientes, sin
sala construida; los originales anteriores observaban1457/2659/2512ms
con sala. Son observaciones de este equipo, no un benchmark de telefono.

Web publicada:189a0133e31854bfd5c796b3a53dbdeb6e720b55;
Pages81f4cad69cbb73faa91fe4aa1471cd6a4a772f2e.
Main609.453B, SHA256469a4a8d915ba75b25877ed18a641015fdf5cd213f1c206a1efaa4c356e927a1.
La primera fijacion fallo porque el HTML publico aun correspondia a1.7.100.
Se conserva ese FAIL. Tras completarse la publicacion de la rama Pages,
la segunda fijacion y HTTP32/shell96 PASS. No se repitio un test fallido.

Tanda publica:31/32 estrictos PASS. Cinco nombres/editor/regresos, cinco
catalogo/plantas/luces y cuatro Abrir con PASS; cada caso Android acredita
el main real recibido. PDF17/18 estricto: el caso noche falla al auditar
walnut-pbr209.252B recibido como0B/HTTP200. Sus assertions de contenido
pasan; el resultado completo sigue siendo FAIL y conserva captura/traza.
No se corrige retroactivamente la auditoria ni se cuenta un retry como PASS.

Tres recorridos offline PASS: archivo3.143B y locator115 al reabrir,
foto[230,35,50], cinco temas con workers reales y portada800x1600,
JPEG150.310B, sin fallback. Siete originales locales integrados PASS,
cero skips/flaky/retries; esperas y assertions originales intactas.
CI original37551892930 en curso, con resultados independientes.
La CI1.7.100 conserva dos regresos30s/8s fallidos tambien en sus retries;
el cierre de8915,6ms observado no se presenta como aprobado.
El APK1.1.7/codigo20 sigue siendo el binario vigente verificado.

## CI original completa

37551892930 FAIL:526 casos/529 intentos, tres retries y cinco intentos
fallidos. UI3 conserva ambos regresos30s/8s fallidos tambien en retry;
UI6 conserva una pipeta sin portada en el primer intento (retry PASS).
La captura y consola muestran que no habia portada disponible, no un
fallo demostrado de pointerup. Los otros cuatro shards y cuatro familias
de voces reales PASS.11 ZIP/digests y todos los intentos conservados.
