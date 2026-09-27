# Android

Mismo patrón que **inhouse notes**: la app Android es un **WebView-shell** (Capacitor `BridgeActivity`) que redirige de inmediato a la versión en vivo de GitHub Pages (`.github/android/app-loader.html`). Un único sitio publicado sirve tanto al navegador como a la app instalada.

## Pipeline de build y firma (ya automatizado)

- `.github/workflows/build-android.yml` — se dispara manualmente (`workflow_dispatch`, pestaña Actions → "Build and publish signed Android APK" → Run workflow). Compila, firma con el keystore de release guardado en los secrets del repo, y publica el APK como GitHub Release con tag `android-vX.Y.Z` (sube `ANDROID_VERSION_NAME`/`ANDROID_VERSION_CODE` en `.github/scripts/build_android_apk.py` en cada cambio nativo real — el workflow no se dispara solo con cada push, así que un cambio en `android/html_to_apk_builder.py` no llega al APK hasta que se vuelve a ejecutar a mano).
- `.github/scripts/build_android_apk.py` — orquesta el build en modo headless (sin abrir ninguna ventana), copiado y adaptado de `build_android_apk.py` de inhouse notes.
- `android/html_to_apk_builder.py` — el builder (Capacitor + manifest/gradle/iconos), con autorización nativa de Drive por Google Play Services y el instalador de auto-actualización.
- El keystore de firma (`inhouse-read-release.jks`, válido hasta 2054) se generó una vez con `keytool` y vive únicamente como secrets del repo (`INHOUSE_READ_ANDROID_KEYSTORE_BASE64`, `_PASSWORD`, `_KEY_ALIAS`) y en una copia local fuera de este repositorio — nunca en el código ni en este README.

## Auto-actualización dentro de la app

Mismo mecanismo que inhouse notes/photos (revisado en `app-v5.js::checkForRequiredAndroidUpdate` antes de portarlo, no reinventado): al arrancar dentro del WebView, `src/js/android-update.js` consulta `public/android-update.json` (servido junto al resto del sitio) y, si hay una versión más nueva, muestra un aviso a pantalla completa con el botón "Instalar actualización". Al pulsarlo, delega en el puente nativo `InhouseNative.installAppUpdate(url, sha256)` (`patch_webview_bridge` en `html_to_apk_builder.py`), que descarga el APK, **verifica su SHA-256** contra el del manifiesto (aborta si no coincide — no está en Notes, es un plus de integridad que añadimos aquí) y lanza el instalador del sistema.

`public/android-update.json` se actualiza solo: el último paso de `build-android.yml` calcula el tamaño y el sha256 reales del APK recién firmado (`update_manifest.py`) y comitea/empuja el cambio a `main` — nunca hay que editarlo a mano ni acordarse de hacerlo en el próximo release. Si algún día se compila el APK por otra vía (fuera de este workflow), hay que correr ese script a mano antes de publicar, o el checker in-app seguirá ofreciendo la versión anterior.

## Google Drive en Android

A partir de v1.0.12, el APK usa `AuthorizationClient` de Google Play Services para solicitar `drive.file` y entregar el token a la web de producción mediante el puente nativo. Para publicar esa versión es necesario registrar un cliente OAuth Android en el proyecto Google `inhouse-notes` con el paquete `com.inhousesoftware.read` y el SHA-1 del certificado de firma de release. El WebView no muestra la pantalla de consentimiento. Si se cambia el keystore hay que registrar también el nuevo SHA-1 antes de publicar otro APK. Los APK anteriores a v1.0.12 no tienen este puente.

## Cómo instalar

**Vía APK firmado**: https://miguelcoxcaballero.github.io/inhouse-read/download-android.html — página real del sitio (no un link suelto a un asset) que consulta en vivo cuál es el último release publicado, así que nunca queda desactualizada. Android pedirá permitir "orígenes desconocidos" la primera vez, es normal para un APK fuera de Play Store.

**Vía PWA (sin instalar nada, recomendado si no necesitas la app nativa)**: abre la URL de GitHub Pages en Chrome/Edge en Android y usa "Añadir a pantalla de inicio" / "Instalar app".

## Cómo volver a compilar tú mismo (manual, sin CI)

```bash
npm install -D @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Inhouse Read" com.inhousesoftware.read --web-dir android/www
mkdir -p android/www && cp .github/android/app-loader.html android/www/index.html
npx cap add android
npx cap sync android
npx cap open android   # Android Studio; Build > Generate Signed Bundle/APK
```
