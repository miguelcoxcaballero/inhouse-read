# Audio y frases entre páginas

La fuente EPUB conserva el texto de la sección y sus rangos DOM. Antes de
preparar el audio, `speech-page-breaks.js` obtiene los cortes de página de los
glifos ya maquetados, usando el mismo eje, sentido y tamaño de página que el
renderizador. Cada nodo requiere una lectura de sus rectángulos; sólo los nodos
que cruzan páginas necesitan búsquedas de caracteres. La preparación cede el
hilo periódicamente y descarta el trabajo si se cierra el documento.

`planSpeech` transforma esos offsets a los índices del texto normalizado y corta
los fragmentos sin perder caracteres. La eliminación de notas, los espacios
colapsados y los caracteres invisibles conservan la correspondencia con el
documento. Los fragmentos de una misma frase conservan su rango de resaltado.

`ReadingVoice.present` sigue el rango del fragmento cuando el motor anuncia su
inicio audible, no al pedir su síntesis. Al empezar la continuación situada en
la página siguiente, Foliate avanza a ella. El flujo con scroll mantiene su
seguimiento habitual; PDF extrae y lee la página actual y avanza al terminarla.

Comprobaciones: doce casos de geometría y normalización, más una integración
que retiene los eventos del motor y comprueba que no se gira la página durante
la preparación ni después de pausar. `neural-page-follow.spec.mjs` añade una
frase corta que cruza columnas reales y registra PCM, los inicios audibles y
las reubicaciones del lector con el modelo real Davefx. La verificación de este
caso sobre la publicación pasó también en `main-Ds1rBulm.js`, con Davefx
descargado desde el origen HTTPS de Hugging Face: la reubicación ocurrió 2 ms
después del inicio audible de la continuación, sin girar antes, perder texto
ni llamar a voces del dispositivo. El PCM de ambos fragmentos fue finito y
audible. Evidencia: `.animation.local/final-live-evidence/page-https179/`.

Las nueve comprobaciones publicadas de papel y temas también pasaron, sin
fotogramas omitidos ni reintentos. El primer intento del caso de audio no tenía
la ruta de fixtures configurada; el siguiente usaba un espejo HTTP local que
el navegador bloqueó desde la página HTTPS. El caso final conserva las mismas
aserciones y usa la descarga normal de producción. Esos intentos se conservan
como fallos del entorno de prueba, separados del resultado final.
