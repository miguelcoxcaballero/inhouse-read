# Rendimiento de 1.7.52

## Fotogramas idénticos del libro activo

La retirada lógica del marcapáginas conserva
el fotograma cuando el libro realmente no tiene cinta y el canvas nativo propio
sigue activo. Se comprueba la pose pintada, la revisión visual, el owner, los
modelos pendientes, la presentación externa y la pérdida del contexto. El canvas
mantiene la colocación CSS original en cada tick. El export 2D se marca pendiente
y se captura sólo cuando lo solicita su consumidor.

Un cambio de página, cinta, acabado o portada exige el dibujo nuevo. Los intentos
de dibujo durante una entrega bloqueada conservan una revisión pendiente, para
que al cancelar aparezca el aspecto actual. La ruta 2D de respaldo sigue dibujando
y restituyendo su imagen si un consumidor modificó su canvas. No cambia la
geometría, las texturas, los materiales, el DPR, la resolución, el antialiasing,
la iluminación, la duración, el easing, el límite de avance ni la cancelación.

## Controles causales

La propuesta final aislada pasa 167/167 casos: 143 originales y 24 nuevos en
doce archivos. El control anterior al último guard conserva un fallo causal del
export mutable; sus otros 23 casos nuevos están excluidos por selección explícita
del control. Certificado `bookmark-render-proposal-attempt7/cpu-summary.json`
bajo `.animation.local/performance-1751/`, SHA
`c9c061e46a4a266bb8022ca375bc6c62b336251b82117e80f3e648b5dd26b0fb`.

Los controles anteriores mantienen sus ámbitos y resultados: el Git 1.7.51
ejecuta los 23 nuevos anteriores, 14 PASS y nueve fallos causales, sin omisiones;
sus 143 originales pasan en el control histórico de la propuesta 4. La versión
antes del guard central conserva dos fallos nuevos de cambios de acabado bajo
una entrega bloqueada. La versión antes de limitar la optimización al canvas
nativo conserva dos fallos nuevos del canvas 2D mutable. Estos controles negativos
no se presentan como una batería de producto aprobada ni como 24 casos Git51
ejecutados.

Se conserva el primer fallo de fixture: el contador nuevo omitía el dibujo
síncrono original al aparecer una cinta. La corrección añade la assertion de ese
dibujo y reinicia sólo su contador antes del tick. También se conserva el primer
check de resumen que predijo siete fallos del control cuando el raw contenía
nueve; se corrigió el censo sin repetir la ejecución ni modificar el raw.
Las versiones con guards incompletos no se incorporaron al producto.

## Comparación GPU y adopción

La comparación final usa el bookView real y mantiene 86 pares idénticos en
RGBA (353.847.000 componentes, alpha incluido), PNG nativo y export PNG.
Pasan 172 invariantes de export en DPR 2 y 1,5. Se conservan poses, colocación
CSS, antialiasing y píxeles parcialmente transparentes. Los contadores de
dibujo se derivaron de la matemática original antes de esta ejecución:
44 → 30 por perfil. Los casos con cinta real conservan todos sus dibujos;
el muestreo original con valores fraccionarios exige dibujar algunas poses
casi iguales. No se introduce tolerancia ni se cambia ese muestreo.

Se conserva **FAILED** el primer método GPU: exigía incorrectamente cero
dibujos de poses fraccionarias y sus 86 comparaciones de imagen sí coincidían.
El segundo método sólo corrige ese contador nuevo con la derivación independiente;
conserva fixture, asserts de calidad, reloj y fuente. No reemplaza el raw fallido.
Certificado final `bookmark-motion-quality-attempt2/summary.json`, SHA
`235d30e6e39f760bd164f8cd1ae7597dce40eb017b66fb3a022fa2a859feaec7`;
878 hechos de fuente/build/método permanecen estables. Ambos navegadores y
sus servidores están cerrados. El reloj manual de esta comparación se limita
al fixture de calidad: no aporta una medida de velocidad.

Se incorporan los bytes exactos del modelo
`b5c7491b268fc0d8d04376c09e61804e2e563f533fb8262de2778903a6b24b7c`
y los 24 casos nuevos comprobados. La primera invocación del helper de
adopción rechazó un hash mal transcrito antes de escribir; su corrección
conservó todos los guards y no repitió las pruebas de producto.

## Fuente final

La fuente incorporada pasa 2.889 unitarias en 212 archivos, build y las
75 comprobaciones Python originales. Los 489 hechos de fuente/config/pruebas
permanecen estables. Se mantienen los 524 casos E2E originales; su listado
es sólo un censo, sin atribuir ejecución a ese comando. Evidencia
`full-local-attempt1/summary.json`.

Los siete recorridos locales originales pasan al primer intento, sin retries,
flaky ni omisiones. Los cierres nativos registran 5.309,4 y 5.362 ms con los
límites originales de ocho segundos y treinta segundos globales intactos.
El gesto isométrico conserva veinte composiciones sin nuevos renders de escena,
dos escrituras de buffer y recursos estables: 74 geometrías, 52 texturas,
34 programas. Los seis lomos mantienen sus 1.024 px. Son medidas de Chromium
de escritorio; no se atribuyen a un teléfono. Evidencia
`local-browser-attempt1/summary.json`.

Pendientes: CI original completa y comprobación de web/APK publicados. Los controles
anteriores de 1.7.50 y 1.7.51 conservan sus fallos originales y no quedan
sustituidos por estas unitarias. No hay medición de un teléfono físico.
