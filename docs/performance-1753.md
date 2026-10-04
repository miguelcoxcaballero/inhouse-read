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

Pendientes: CI original y comprobación de la web y APK publicados.
Los fallos anteriores conservan su estado propio.
