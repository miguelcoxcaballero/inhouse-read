# Continuidad del audio Android — 1.7.96 / APK 1.1.6

## Cambio

Se conservan los cambios publicados en 1.7.94: paginación EPUB estable,
frases divididas en el corte físico de página y compensación de latencia
de salida. La revisión detecta un estado que podía detener la continuidad
del audiolibro: después de vaciar el búfer, la extrapolación del timestamp
avanza más que el cabezal detenido. El código anterior descartaba ese dato
y conservaba una demora positiva; el último fragmento no recibía `done`.
También se conservaba la demora al reiniciar o vaciar una pista.

Se limpia la demora al alcanzar la presentación real y al reiniciar/vaciar
la pista. Mientras hay audio en camino, se mantiene la medición y su
suavizado. Se siguen rechazando timestamps fuera del rango de un segundo.
No se modifica el audio PCM, la voz, su velocidad ni los plazos de pruebas.

La API permite timestamps temporariamente indisponibles y recomienda
obtener la correspondencia de posición y tiempo a partir de los datos de
la pista: [AudioTrack.getTimestamp](https://developer.android.com/reference/android/media/AudioTrack#getTimestamp(android.media.AudioTimestamp)).
La prueba usa el método Java literal de producción, compilado con un
proveedor de timestamps y reloj deterministas. Seis casos ejecutan esa
función; otro comprueba los resets. Antes de corregir: tres fallos de siete.
Después: siete aprobados. Originales separados en
`.animation.local/performance-1795/native-clock-{before,after}.log`.

## Verificación en curso

La batería local completa, CI, web real y APK firmado se registran por
separado. Android 1.1.6/código 19 incluye el nuevo reloj; el build anterior
1.1.5/código 18 se conserva como una fuente distinta. El manifiesto sólo
cambia cuando el workflow publica el APK real y calcula su hash/tamaño.

Los resultados de 1.7.94 en `performance-1794.md` pertenecen a e060849.
Los cambios posteriores 9d0b1b5/d2e9295 requieren su propia comprobación;
no se les atribuye la batería anterior. El ensayo adicional SwiftShader
de 1.7.94 falló en un cierre; conserva ese fallo sin repetirlo para darlo
por aprobado. No se certifican FPS, temperatura o batería de un teléfono
físico ni una sesión autenticada real de Google.

Se integra también 5f43d04 (seguir la navegación manual y pulsar una frase).
El primer censo local omitió las rutas de pesos y produjo casos `skip`;
se conserva como fallido. Sus 3.496 unitarias y 91 Python sí se ejecutaron,
pero no certifican la fuente nueva ni la ejecución E2E. La siguiente tanda
restaura el entorno completo de listado con los pesos reales disponibles.

## Batería local de la fuente integrada

`performance-1796/full-attempt1`: 3.499/3.499 unitarias en 285 archivos,
build y 91 comprobaciones Python aprobados. Censo completo: 526 E2E
listados sin skips; el listado no ejecuta los navegadores. Se mantienen los
bytes del runtime/config/tests durante los comandos, incluido Android.
Entorno local Windows/Node24, distinto de Ubuntu/Node22 de CI.

APK 1.1.5 descargado: firma v2 y certificado anterior verificados,
78.531.655 bytes, hash `3d1a63f87c0325e60bd50837c5cfa5a8f3bf042f3ff299d730dd4a45f25e5348`.
Loader exacto de 2.107 bytes, sólo tres archivos en assets/public.
El primer y segundo HTTP del manifiesto recibieron 1.1.4 y se conservan
fallidos. Tras completar Pages, el control de descarga recibe 1.1.5 correcto.
El Android15 original 37534926916 conserva 367.765ms bloqueado,
371,63s de PCM y 23 capítulos; PDF continúa por dos páginas.
Estas pruebas son de 1.1.5/e060849, no de 1.1.6 ni teléfono físico.

CI e060849: dos aperturas PDF nativas fallan en los ocho segundos
originales también al reintentar. La caché no resuelve por sí sola ese
plazo. Originales 37534909667 conservados; no se reinterpreta como PASS.
