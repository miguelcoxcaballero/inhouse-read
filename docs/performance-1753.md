# Rendimiento de 1.7.53 — apertura preparada

## Página ya pintada

`installOpeningPage` consulta si el bookView
conserva un fotograma nativo vigente de la misma página. Sólo puede reutilizarlo
cuando coinciden snapshot, pose exacta, retirada de cinta, revisión visual,
contexto, owner y presentación. Un modelo pendiente, calentamiento interrumpido,
entrega externa, cambio de aspecto o ruta 2D mantiene el dibujo original.
Se conserva la colocación del canvas y se marca el export mutable pendiente.

No cambian geometría, materiales, texturas, DPR, AA, luces ni los relojes,
duraciones, easing, límites de avance o cancelación de las animaciones.

## Pruebas funcionales aisladas

El candidato final pasa 189 casos únicos: 168 existentes y 21 nuevos.
El control Git 1.7.52 pasa los 168 existentes y conserva cinco fallos causales
de los nuevos; sus otros 16 nuevos pasan. Es una comprobación funcional,
sin build/GPU ni medida de latencia. Certificado
`prepared-page-commit-proposal-attempt1/cpu-summary-final.json`, SHA
`97e105bc8ca92b0ef5ab9e7731e194d562879994cd6405f72df73ac5c06020c7`.

Se conserva FAILED el primer resumen de selección: dos nombres de archivo
inexistentes omitieron 21 casos existentes. Sus 168 casos ejecutados pasaron
(147 existentes y 21 nuevos). Sólo los 21 omitidos se ejecutaron una vez
en un suplemento de candidato/control; ninguna de las primeras ejecuciones
se repitió ni cambió. La unión se deriva de identidades únicas y de los raw
reportes, conservando el error de selección original y el control negativo.

Modelo candidato SHA
`772e6a93cf3d3260f9f92e07efc9819963ca95cd2e4f7c0c6218ca17b309b9c9`,
caller de estantería SHA
`c95cb862b4c0309e8eaa25f39df04adb3ea5bd47f7a11e30a7ede7f8930084f4`.

## Método gráfico

El primer método gráfico conserva FAILED en DPR 2 después de seis pares
RGBA/PNG exactos y contadores correctos. Su precondición exigía presentación
nativa después de entregar el renderer a otro bookView, esperando sólo su
`ready`. Esa promesa resuelve la portada antes de concluir el relieve asíncrono:
una invalidación posterior puede devolver la propiedad a ese segundo view y
presentar legítimamente el primero desde su canvas 2D. El PNG fallido muestra
la página correcta, pero no se guardó metadata en el punto de la assertion;
no se afirma que ese callback fuera el evento ocurrido en la ejecución.

El nuevo método asienta el relieve del view auxiliar antes de su draw de
propiedad, para comprobar recuperación nativa de forma determinista. Conserva
runtime, asserts de píxeles, alpha, AA, contadores y presentación nativa; guarda
metadata antes de las assertions. No se ejecutó DPR 1,5 en el primer método.
Ese fallo original no se sustituye por la ejecución corregida.

También se conserva FAILED el método 3 tras ocho pares exactos: la exportación
asíncrona coincidió con una finalización legítima de modelo/texturas y el contador
pasó de cuatro a cinco. No se atribuye ese draw a la exportación. El método final
registra primero la decisión y el contador con carga pendiente y después espera
la portada y el relieve antes de comparar capturas/exports estables. La metadata
conserva un grupo real observado y el flag bruto de portada pendiente
(`undefined` o `false`, serializado sin inventar un false inicial). Se conserva
además el error de preparación 2 por búsqueda LF/CRLF; no llegó a ejecutar GPU.

## Comparación final y adopción

Pasan los 15 casos declarados en DPR 2 y 1,5 al primer intento del método final:
30 pares RGBA exactos (123.435.000 componentes), 30 PNG nativos, 30 exports PNG
y 60 invariantes. Los installs registran 30 → 20 dibujos con diez retenciones
nativas explícitas. Los estados dirty, interrumpido, pendiente y de respaldo
conservan el dibujo original. Se mantienen los 767 hechos de fuente/método,
AA, alpha, metal, relieve, fuentes y dimensiones. Ambos navegadores y sus
servidores quedan cerrados. Certificado `prepared-page-quality-attempt4/summary.json`,
SHA `979c541df124c68a2fa9f7d8a53050a95c04337c29fd70ffa1456b662523f65a`.
Las notificaciones de restauración de contexto se ejecutan sobre GL vivo:
no constituyen una prueba de recuperación de pérdida de hardware.

Se incorporan el modelo y caller exactos, las 21 nuevas pruebas y los metadatos
de versión. La comparación es de trabajo/píxeles, sin atribución de velocidad
a un teléfono. No se cambia ninguna assertion ni plazo de la QA original.

## Fuente final

La fuente incorporada pasa 2.910 unitarias en 214 archivos, build y las 75
comprobaciones Python originales. Los 491 hechos de fuente permanecen
estables. El listado conserva 524 identidades E2E, sin ejecuciones ni
omisiones; no se atribuye un pase de navegador al censo. Evidencia
`full-local-attempt1/summary.json`.

Los siete recorridos locales originales pasan al primer intento, cero retries,
flaky u omisiones. Los cierres nativos registran 4.638,7 y 6.147,8 ms con los
límites originales de ocho segundos y treinta segundos globales intactos.
El gesto isométrico conserva veinte composiciones sin nuevos renders de escena,
dos escrituras de buffer y recursos estables: 74 geometrías, 52 texturas y
34 programas; seis lomos de 1.024 px. Son medidas de Chromium de escritorio,
sin atribuir rendimiento a un teléfono. Evidencia
`local-browser-attempt1/summary.json`.

## Publicación

Fuente `22cf96b4306b460299f198cefb24dad07ad6c775`, Pages
`1c024d68d132bc8bffaeb3e8b25a20d4baf2ab99`, deploy `37234373475` SUCCESS.
El primer pin público conserva FAILED: el HTML todavía apunta a 1.7.52.
El segundo namespace coincide con los bytes de 1.7.53; no reescribe las
peticiones anteriores. `main-CtFCesdB.js` tiene 1.448.490 bytes, SHA
`2e1a3d50774633699fefc24323a8effa3a7dc0cb09ed5ebafe9eee8f3bc49e29`.
Pasan los 23 módulos y 44 recursos offline; certificado HTTP SHA
`9a811e4fdf628550e5123fc90380c2847e3b36d0e58589f9bef48e9d555e583f`.

La APK descargada de nuevo coincide con la firmada 1.1.4, código 17,
78.515.243 bytes, SHA `feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
Su loader de 2.089 bytes coincide con la fuente, SHA
`8e03c3a6c8f840d9e9cf66637babe2d63742d2948d852534b865db0086aa9f34`;
assets/public sólo contiene el loader y dos stubs vacíos. No es un nuevo
build nativo ni una prueba en teléfono.

Pasan los tres recorridos publicados de editor/regreso y los 18 PDF originales
al primer intento, cero retries, flaky u omisiones. Se verifican 50 + 310
cuerpos HTTP de aplicación contra Pages y quince capturas PDF. Certificados
SHA `e0cfa7fbcabfb9d834f45a2ecc7ac4fed153890d5c7b13088c9730662403b6cb`
y `108f8225b4ffcf95a983711a6573a4ee0addd215a5bc8cbca86ea5797997f06d`.
La narración PDF usa el motor controlado para comprobar posiciones;
las voces naturales mantienen sus pruebas originales de CI separadas.

## CI original completa

La CI original `37234373476`, fuente
`22cf96b4306b460299f198cefb24dad07ad6c775`, attempt 1, termina FAILED.
La recogida completa conserva los doce logs y once ZIP autenticados, con
digest, tamaño y cada miembro extraído verificados. Las 2.910 unitarias en
214 archivos pasan sin failed, pending o todo. Los 524 casos E2E únicos
contienen 521 expected, dos unexpected y un flaky, cero skipped. Los 527
intentos conservan cinco fallidos y tres retries originales. Sólo UI1 y UI3
incumplen el gate estricto; los demás grupos pasan, incluidos los 220 casos
Supertonic. El agregado conserva FAILED.

El censo se deriva de los diez manifiestos y reportes originales subidos.
Esta recogida no ejecuta un nuevo listado local ni pruebas. Certificado
`ci-22cf96b-failed-original-collector-attempt1/snapshot-001/certification.json`,
SHA `52dd7bc1fde2cbfaaae9e0cf34a9eb164d39ad2ccb4e0732ebba54a6bc29d140`.

### UI3: cierre

UI3 conserva FAILED. Sus 40 casos
contienen 38 expected y dos unexpected; 42 intentos con cuatro fallidos y dos
retries, cero flaky o skip. En los cuatro nativos pasan selección y apertura;
el PDF visible se espera 4.897,605 / 4.795,854 / 4.679,182 / 4.794,884 ms.
Los cuatro fallan el cierre de ocho segundos completo: backend de expect
8.003,594 / 8.002,643 / 8.015,706 / 8.002,379 ms, sin truncado global de treinta
segundos. El snapshot posterior al fallo, 300–553 ms después del expectend,
ya muestra la sala restaurada; no acredita classEnd antes del fallo. No se
evaluaron los relojes internos ni se capturaron fases intermedias del regreso.
Ambos contratos Git 1.7.52 → 1.7.53 tienen diff vacío. Evidencia
`failure-ui3-22cf96b-first-early/`.

### UI1: observación del cierre tras importar

El caso `Android Abrir con: importa los bytes exactos con la app cerrada`
de `android-file-import.spec.mjs` falla en su primer intento, 18.693 ms,
y pasa el retry original, 29.814 ms. UI1 conserva 44 expected y un flaky:
46 intentos, un fallo y un retry. El gate estricto conserva FAILED.
Los bytes importados y las comprobaciones previas del lector pasan; falla
`body.toHaveClass(/is-closing-reader/)`, línea 43, con plazo nominal de
8.000 ms. Sus nueve polls registran BODY vacío.

La traza acredita un estado transitorio: el snapshot before del expect,
timestamp 13.137,910 ms, sí contiene `is-closing-reader`; el after,
21.148,883 ms, contiene BODY vacío. El click backend dura 4.363,075 ms
(4.914,364 → 9.277,439), mientras el call de test dura 6.100,384 ms.
El expect backend dura 10.118,410 ms (11.019,782 → 21.138,192);
su snapshot before llega 2.118,128 ms después de su inicio. Son tiempos
de calls y capturas registradas; no determinan el instante de la primera
consulta, el click DOM ni classEnd. El fallo no demuestra ausencia del
cierre y no se convierte en PASS por la captura intermedia o el retry.
El archivo de prueba Git 1.7.52 → 1.7.53 tiene diff vacío. Evidencia
`failure-ui1-22cf96b-first-early/ui1-trace-facts.json` y su ZIP/log originales.

### Alcance de los pins tempranos

El binder early de UI3 guardó el entry en el campo `method`, separado de
la lista `methods` que el collector comprobaba antes y al terminar. Los
helpers sí se comprobaron; el entry coincide en la comprobación posterior
con el pin original anterior a la ejecución. Se conserva esa limitación
en `failure-ui3-22cf96b-first-early/early-entry-after-check.json`, junto al
binder, método y originales intactos. No se atribuye un check continuo al
entry de esa ejecución temprana. El collector completo incluye su método
en sus comprobaciones; el nuevo early de UI1 también comprueba entry y
helpers. La corrección posterior del binder de CI54 se guarda aparte y
no sustituye la evidencia de CI53.

Los resultados locales y públicos conservan su alcance propio. Los fallos
originales anteriores y los reintentos de este run permanecen registrados.
