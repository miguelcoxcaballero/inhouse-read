# Android 1.1.7: finalizar también después de una espera larga

Android 1.1.6 limpia el retraso de salida al acabar la presentación y al
vaciar/reiniciar la pista. La comprobación adicional encuentra otro caso:
si el hilo vuelve a ejecutarse más de un segundo después de vaciar el
búfer, la extrapolación de un timestamp válido queda muy por delante del
cabezal detenido. El límite inferior anterior lo descartaba y conservaba
el retraso, impidiendo completar el fragmento.

Ahora se comprueba la posición de frames del timestamp. Una posición
imposible y un retraso superior al rango permitido siguen rechazándose;
una posición válida ya presentada puede terminar, aunque haya pasado
tiempo sin ejecutar el hilo. No se cambia la velocidad, el PCM ni se
genera una finalización por un temporizador de la web.

La prueba compila y ejecuta el método Java literal con un reloj y proveedor
de timestamps deterministas. Antes: un fallo de ocho; después: ocho PASS.
También pasan las nueve pruebas de integración del servicio. Originales
separados en `.animation.local/native-clock-resilience-117/{before,after}.log`.

El APK 1.1.6 ya publicado conserva su evidencia: firma v2 válida y mismo
certificado, versión/código reales 1.1.6/19, loader exacto de 2.107 bytes,
SHA-256 `758fb24dd15888c63931cc673aba1c83ebfce3cb46c8dfd3b6338f82ed4a2993`.
Su original Android15 es 37537523146. La nueva compilación 1.1.7/código20
debe pasar y publicarse antes de considerar entregado este caso adicional.

## Estado de la web

La fuente d3bdd6a de web1.7.96 conserva 3.501 unitarias/285 archivos,
build y91 Python aprobados. HTTP32/shell96 coincide con Pages79b6c6b.
Publicación: tres recorridos de apertura/editor y cinco de catálogo PASS;
PDF17/18: un fallo de observación de recurso, conservado sin repetirlo.
No se acredita una mejora de FPS de teléfono físico ni que toda la
lentitud esté resuelta. La CI completa sigue en revisión.
