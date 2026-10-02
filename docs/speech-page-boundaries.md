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
caso sobre la publicación es necesaria antes de dar por concluida la entrega.
