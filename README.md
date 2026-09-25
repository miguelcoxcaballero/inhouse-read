# inhouse read

Lector de PDF, EPUB y MOBI. Hermano de [inhouse notes](https://github.com/miguelcoxcaballero/inhousenotes): misma paleta, misma tipografía (Comfortaa + DM Sans), mismo patrón de despliegue a GitHub Pages.

El home no es un grid de tarjetas: es una estantería ilustrada con plantas donde los libros se ven de canto. Al tocar uno, sale de la balda y gira en 3D hasta enseñar la portada antes de abrirse.

## Formatos soportados — con honestidad

| Formato | Motor | Estado |
|---|---|---|
| PDF | [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | Sólido. Render por página a canvas, texto seleccionable, zoom. |
| EPUB | [foliate-js](https://github.com/johnfactotum/foliate-js) | Sólido. Paginación vía columnas CSS nativas. |
| MOBI / AZW3 | foliate-js (parser interno) | **Funcional para archivos sin DRM, no "production-grade" al nivel de PDF/EPUB.** foliate-js es la única librería JS mantenida con soporte MOBI client-side puro en 2026; su propio autor advierte que la API es inestable y que el rendimiento en KF8 comprimido (HUFF/CDIC) puede ser pobre. Pruébalo con tus propios archivos antes de confiar en él para una biblioteca grande. |
| MOBI/AZW con DRM de Amazon | — | **No soportado, y no lo estará.** Es una limitación criptográfica de Amazon (claves ligadas al dispositivo/cuenta), no algo que un lector cliente pueda resolver sin infringir el DRM. Usa un archivo DRM-free (exportado por ti mismo o convertido con Calibre). |
| FB2, CBZ | foliate-js | Funcional, soporte de bonus vía el mismo motor que EPUB/MOBI. |

## Arquitectura

HTML/CSS/JS vanilla (ES modules) + [Vite](https://vitejs.dev) solo como bundler/dev-server — sin framework de UI, siguiendo el mismo criterio que inhouse notes. Sin backend propio: todo corre en el navegador.

```
src/
  css/            tokens.css (paleta/tipografía heredadas de Inhouse), base.css, app.css, bookshelf.css
  js/
    app.js                    orquestación: pantallas, biblioteca, Drive
    format-detect.js          detección de formato por firma de bytes + extensión
    library-store.js          recientes/progreso en IndexedDB
    drive-client.js           Google Drive (OAuth vía Google Identity Services + Drive API v3)
    gestures.js               swipe/tap/doble-tap compartido por los lectores
    bookshelf.js              home screen: estantería animada (ver HANDOFF-BOOKSHELF.md)
    bookshelf-layout.js        empaquetado determinista de lomos/plantas en baldas
    plants.js                 ilustraciones SVG de las plantas
    readers/
      pdf-reader.js            wrapper de PDF.js
      foliate-reader.js        wrapper de foliate-js (EPUB/MOBI/AZW3/FB2/CBZ)
      reader-controller.js     enruta al motor correcto según el formato
demo/bookshelf.html           banco de pruebas aislado del home screen (npm run dev)
tests/unit/                   Vitest — parsing de formatos, estado de biblioteca, layout
tests/e2e/                    Playwright — flujo real: abrir un PDF, navegar, volver
android/                      wrapper WebView (ver sección Android)
.github/workflows/            CI (tests) + deploy a GitHub Pages
```

## Desarrollo local

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # genera dist/
npm run preview      # sirve dist/ para probar el build de producción
```

## Tests

```bash
npm run test:unit    # Vitest — rápidos, sin navegador real
npm run test:e2e     # Playwright — build de producción + Chromium real
npm test             # ambos
```

## Carpeta local persistente

En Chrome/Edge de escritorio, al importar un libro por primera vez la app pide elegir una carpeta real del disco (File System Access API) y guarda ahí una copia. La próxima vez que abras ese libro desde la estantería, se lee directamente de esa carpeta — no hace falta volver a seleccionarlo a mano.

**Limitación real, no un descuido**: `showDirectoryPicker` es una API exclusiva de navegadores Chromium de escritorio. No existe en Chrome para Android, en ningún navegador móvil, en Safari, ni en el WebView nativo de la app Android empaquetada (`android/`). En esos entornos la app sigue funcionando exactamente igual que antes: el libro se abre y sus metadatos/progreso/portada se guardan en IndexedDB, pero al reabrirlo hay que volver a elegir el archivo (el sistema operativo no permite a una app web guardar en una carpeta arbitraria sin esa API). La alternativa nativa real para Android sería un plugin de Capacitor a medida sobre Storage Access Framework — no implementado, ver `android/README.md`.

## Google Drive

La integración con Drive es 100% client-side (Google Identity Services + Drive API v3 por fetch, sin backend), pero **requiere que rellenes tu propio Client ID de Google Cloud** — eso no se puede generar por CLI ni automatizarse, hay que crearlo a mano:

1. Ve a [console.cloud.google.com](https://console.cloud.google.com), crea (o reusa) un proyecto.
2. "APIs y servicios" → "Pantalla de consentimiento OAuth" → configúrala (tipo "Externo" si es tu proyecto personal).
3. "Credenciales" → "Crear credenciales" → "ID de cliente de OAuth" → tipo **Aplicación web**.
4. En "Orígenes de JavaScript autorizados" añade el origen exacto donde sirvas la app (p. ej. `https://miguelcoxcaballero.github.io` para la versión de GitHub Pages, y `http://localhost:5173` para desarrollo).
5. Habilita la **Google Drive API** en "APIs y servicios" → "Biblioteca".
6. Copia `config.example.js` a `config.js` (no se sube al repo) y pega tu Client ID:
   ```js
   window.INHOUSE_READ_CONFIG = { googleClientId: 'TU_ID.apps.googleusercontent.com' }
   ```

Sin `config.js`, el botón de Drive queda deshabilitado (no roto): el resto de la app funciona con normalidad usando el selector de archivos local y los recientes.

## Despliegue (GitHub Pages)

Igual que inhouse notes: build de Vite, publicado a la rama `gh-pages` vía `peaceiris/actions-gh-pages`, sirviendo la rama directamente desde Settings → Pages (no el deployment nativo de Actions, que en el repo hermano dio timeouts). Se dispara en cada push a `main` — ver `.github/workflows/deploy-pages.yml`.

## Android

App-shell WebView (Capacitor) que apunta a la URL en vivo de GitHub Pages, con el mismo pipeline de firma automatizado que inhouse notes (`.github/workflows/build-android.yml`, disparo manual desde la pestaña Actions). **Descarga**: https://miguelcoxcaballero.github.io/inhouse-read/download-android.html — página real del sitio que consulta en vivo el último release (no un link fijo que se desactualiza). Google Drive no funciona todavía dentro del APK nativo (limitación de Google con OAuth en WebView, no un bug) — sí funciona en la PWA/navegador. Detalles en `android/README.md`.
