# Continuación: límite global de la caché de portadas ampliadas

## Candidato 1.7.112

La caché conserva un máximo global de 2.097.152 píxeles (8 MiB RGBA), además
del límite por imagen de 1.7.111. Cuando otra portada necesita espacio se libera
la base menos recientemente utilizada. Las texturas de los modelos visibles
conservan sus píxeles y sus propios ciclos de vida. Seleccionar una portada
retenida renueva su prioridad; cerrar su última copia devuelve el presupuesto.
No se cambia resolución, modelo, material, iluminación o reloj de animación.

Evidencia: `.animation.local/performance-1813/`. 112 focales PASS, incluidos
tres casos nuevos de presupuesto global, prioridad y devolución de espacio.
Comparación con el renderer real: se fuerzan cuatro portadas decodificadas y
la expulsión de la primera; el libro todavía visible conserva exactamente
la textura RGBA y los fotogramas de frente, 35° y 90°. Errores GL cero y
118.391/109.962/32.816 píxeles pintados. Esto acredita calidad en esa muestra,
no una aceleración sostenida ni FPS, consumo o temperatura de un móvil físico.

## Publicación y verificación de 1.7.112

Fuente `d051c42c2c05b77ab26e1ff7c07e47a31383ed32`, Pages
`9baba3ddf65b5ff16c49cf29e70ff32e916f472d`. Main `main-DOHSbtMr.js`,
614.577 B, SHA-256 `e1a7108f8920dee5951907bdf7ca85ba43603d774d976f8f643442d4b1e184ac`.
HTTP: grafo32, shell96 y módulos históricos coinciden con Git inmutable.
Batería local: **3.642 unitarias/295 archivos**,
build y 105 Python PASS; el listado533 es censo, no ejecución E2E local.

Web real: **32/32 auditorías estrictas PASS**, un intento por caso.
Offline4 PASS para bytes/progreso, fotografías RGB en cinco temas, portada
JPEG y cierre inmediato. Los 698 archivos guardados coinciden byte a byte.
El primer lote local conserva 6 PASS y un FAIL de escritura ENOSPC al guardar
la traza final. Tras recuperar espacio y dependencias, el único caso afectado
pasa por separado con sus aserciones y plazos originales. Dos preparaciones
de ese nuevo recorrido fallaron antes de ejecutar: dependencia ausente y
sintaxis del selector; también se conservan. No se presenta el primer lote
como siete PASS ni se borran fallos anteriores.

APK público 1.1.8/code21 descargado otra vez, 78.531.695 B, SHA, firma y
loader de 2.107 B PASS. El primer intento de esa descarga/verificación
conserva su error de escritura por disco lleno; el nuevo tiene namespace
independiente. Emulador `37995464703`, ZIP original de 8.861.336 B autenticado:
cinco estados nativos PASS. Preflight Google aceptado, sin prueba de cuenta
humana conectada. La CI112 completa `37994794342` sigue pendiente de recoger.

Se trasladó evidencia histórica al disco D y se conservaron rutas mediante
junctions. El segundo traslado se detuvo al afectar a dependencias compartidas;
`npm ci` restauró las dependencias del lock vigente. El código de producto y
los originales de pruebas permanecieron intactos durante las comprobaciones.
La recuperación de la carpeta de diagnóstico parcialmente trasladada usa copias
con hash y evita atravesar enlaces; no borra originales ni sobreescribe archivos.
El primer recorrido de recuperación se detuvo por una diferencia de hash en
una imagen RGBA histórica. La continuación restauró los archivos faltantes y
conservó ambas copias diferentes, sin elegir ni reemplazar el original. Ese
conflicto queda en archive-recovery-v2.json; no acredita una migración idéntica
de toda la evidencia histórica. La dependencia actual se reinstaló desde el lock.

La verificación 1.7.111 se conserva en [su informe](performance-1812.md);
su CI531/533 y tres fallos originales de captura permanecen FAIL. Los nuevos
PASS de112 no explican ni sustituyen esas capturas. El rendimiento global
no se considera resuelto y no hay mediciones de teléfono físico.

## Auditoría completa de CI112

Run original37994794342 FAIL. Los once ZIP, doce jobs y sus hashes
autenticados se conservan en ci-original-attempt1/snapshot-001. Censo:
3.642 unitarias/295 archivos y533 E2E únicos; 530 PASS al primer intento,
un caso flaky de Android Abrir con y dos regresos nativos FAIL también en
retry. Son536 intentos, tres retries y cinco intentos fallidos. Las cuatro
familias de voces con pesos reales PASS. No se reejecutó el run fallido.

La traza del primer Abrir con vuelve a Home apenas0,6 s después de goto,
aún durante la preparación. La expectativa no llega a observar la clase
is-closing-reader. El retry pasa, pero no convierte el primer intento en
PASS; la transición de salida anticipada requiere una comprobación aparte.
El rendimiento completo sigue pendiente.

La comprobación posterior archive-conflict-receipt-audit.json compara las
dos copias RGBA con la ficha original quality-report.json: la copia local
coincide exactamente en tamaño9.881.216 B y SHA256
`69b21f8e8a9371332b771352a4d1fdb417cfe7d94fa4c2b4df279b597a1baebe`;
la copia parcial trasladada a D no coincide. Ambas permanecen conservadas.
Esto resuelve cuál es el original de ese archivo; no acredita la igualdad
de toda la migración histórica.
