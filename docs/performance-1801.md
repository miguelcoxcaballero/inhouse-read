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
No es la bateria E2E completa ni un benchmark. Web publicada: pendiente.
La CI1.7.100 conserva dos regresos30s/8s fallidos tambien en sus retries;
el cierre de8915,6ms observado no se presenta como aprobado.
El APK1.1.7/codigo20 sigue siendo el binario vigente verificado.
