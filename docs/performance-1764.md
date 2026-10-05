# Rendimiento de Inhouse Read 1.7.64

## Cierre del lector y voces

Al cerrar un libro se cancela el calentamiento pendiente de las voces antes
de esperar a la captura de la página. Se detiene la reproducción, se invalida
el cliente de inferencia y se vacían su caché PCM y temporizador de inactividad.
La liberación de un cliente existente no carga otro motor. Android ejecuta
su limpieza en el executor nativo; JavaScript no espera a que termine.

Las continuaciones de carga comprueban el libro y su generación. Una carga
antigua no puede iniciar un modelo después del cierre ni sustituir el cliente
de una reapertura. Pausar, detener y escuchar con la pantalla apagada mantienen
su comportamiento. Los paquetes descargados y las preferencias permanecen
guardados.

## Pruebas aisladas

El control es Git63 `f81d3a141e92bf5ae2129e643ba4cc0447d5065b`.
El candidato pasa 155 casos en diez archivos: 142 originales y 13 nuevos.
El control pasa las mismas 142 identidades originales en siete archivos.
Ambos procesos terminan con exit0, sin errores no capturados ni cambios de
fuente, métodos o entradas. Los nuevos casos sólo se ejecutan en el candidato.

Resumen CPU SHA-256:
`4ceb2156b858626b32a041ceeebe00845628e557ccf36241a9b9cc5add5f77ec`.

La comprobación valida el ciclo de vida mediante fuente y dobles de prueba.
No mide memoria o FPS de un teléfono. La caché PCM tiene un límite de
6.000.000 muestras Float32, equivalentes a 24.000.000 bytes. La liberación
nativa puede esperar a trabajo ya en curso. Los pesos y su transferencia
no cambian en esta versión.

## Integración y comprobación de la publicación

La adopción aplica únicamente los cambios cualificados y conserva los bytes
fuera de sus bloques, incluidos los saltos de línea existentes. Las pruebas
originales permanecen intactas.

El primer método de adopción rechazó los saltos de línea mixtos antes de
escribir. La primera llamada a la batería completa rechazó la versión 1.7.63
antes de ejecutar comandos o pruebas. Ambos errores quedan conservados.
La adopción revisada termina correctamente; la batería completa usa un
directorio nuevo, `full-local-attempt2`.

La batería completa real de la fuente final pasa 3.147 unitarias en 242
archivos, compilación y 75 comprobaciones Python. Los cinco comandos
terminan con exit0 y los 526 hechos de fuente permanecen estables. El censo
conserva 524 identidades únicas E2E, cero omisiones y cero intentos ejecutados;
el listado no se presenta como una ejecución. El recibo de `full-local-attempt2`
tiene SHA-256
`5f4f9d99bbd858c5e814e825a2d48f89948f401fc69753d8b957e7ba5fd83d0e`.

Los siete recorridos locales originales pasan al primer intento, con siete
intentos, cero retries, flaky y omisiones. Fuente y build permanecen estables
con los 526 hechos de fuente. Los cierres alineado y legado miden 5.349,8 y
6.144,4 ms con los mismos presupuestos originales de ocho segundos. El
recibo local tiene SHA-256
`9fc0ef8698ef14042f7d287e247a694c1dedb52aacf1aa392e2ddfcd5e3776d0`.

La fuente `72a785c` y Pages `2423322` pasan los recibos públicos descritos
abajo. La auditoría CI64 continúa pendiente.
Los fallos anteriores de adopción y de la primera batería permanecen
conservados; ninguno ejecutó QA. Estos datos no acreditan fluidez o memoria
de un teléfono físico ni reparan por sí solos los fallos originales de CI61.

## Publicación comprobada

Fuente `72a785c2db0c4d65792c9008299f1445ab022d04`, Pages
`2423322b92dab889c64ee3bd036dd384605097ac`: los 24 módulos y 45 archivos
offline servidos coinciden con los bytes publicados. El artefacto HTTP tiene
SHA-256 `6e286ff4d9343e50d2465e7f052e7a49a1fd0da03f69e9106e6ff55167cfcbfd`.
La APK recién descargada conserva exactamente los 78.515.243 bytes de la
firmada previamente 1.1.4/code17 y el loader de 2.089 bytes coincide con
la fuente. No se ha realizado otra captura de dispositivo ni una nueva
invocación de comprobación criptográfica de firma.

Los tres recorridos públicos originales de editor y regreso nativo pasan
al primer intento, sin retries, flaky ni omisiones, con 53 cuerpos de
aplicación autenticados. Su certificado SHA-256 es
`39693f80aa5ab52fc8d12bba9eba6b7c1c46105f57c61a0f8d7ab6074d93f3f0`.
Los 18 recorridos PDF públicos también pasan al primer intento, sin retries,
flaky ni omisiones, con 326 cuerpos autenticados. Conservan fotos en todos
los temas, texto completo, orden y navegación. Su certificado SHA-256 es
`a13208ddd77b70e18b5e819d503069093619d146de3299f02ef957ff4bf26d14`.
Las assertions y los plazos originales permanecen intactos. Estos 21 pases
no reclasifican fallos originales de otras versiones ni califican la CI64,
que sigue pendiente de su evidencia propia.

## Evidencia

- `performance-1763/voice-reader-close-cpu-method-attempt1/cpu-attempt1/execution/summary.json`:
  candidato155/control142 y las 142 identidades originales iguales.
- `performance-1763/voice-reader-close-adoption-method-attempt1/`: método
  rechazado antes de escribir por los saltos de línea mixtos.
- `performance-1763/voice-reader-close-adoption-method-attempt2/execution-attempt1/`:
  adopción revisada, diez archivos y pruebas originales intactas.
- `performance-1764/full-local-attempt1/summary.json`: primer gate de versión
  FAILED, sin comandos, pruebas, build ni hechos de fuente.
- `performance-1764/full-local-attempt2/summary.json`: batería completa real PASS.
- `performance-1764/local-browser-attempt1/summary.json`: siete originales locales PASS.
- `performance-1764/public-72a785c-attempt1/http-attempt1/`: HTTP real y procedencia.
- `performance-1764/public-72a785c-attempt1/apk-attempt1/`: APK recién descargada y loader.
- `performance-1764/public-72a785c-attempt1/performance-browser-attempt1/performance-qualification.json`:
  tres recorridos públicos originales PASS.
- `performance-1764/public-72a785c-attempt1/browser-attempt1/certification.json`:
  los 18 PDF públicos originales PASS.

Las rutas anteriores están bajo `.animation.local/`.
