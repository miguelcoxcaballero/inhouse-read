# Android

Mismo patrón que **inhouse notes**: la app Android es un **WebView-shell** (Capacitor `BridgeActivity`) que redirige de inmediato a la versión en vivo de GitHub Pages (`.github/android/app-loader.html`). Un único sitio publicado sirve tanto al navegador como a la app instalada.

## Pipeline de build y firma (ya automatizado)

- `.github/workflows/build-android.yml` — se dispara manualmente (`workflow_dispatch`, pestaña Actions → "Build and publish signed Android APK" → Run workflow). Compila, firma con el keystore de release guardado en los secrets del repo, y publica el APK como GitHub Release con tag `android-v1.0.0`.
- `.github/scripts/build_android_apk.py` — orquesta el build en modo headless (sin abrir ninguna ventana), copiado y adaptado de `build_android_apk.py` de inhouse notes.
- `android/html_to_apk_builder.py` — el builder en sí (Capacitor + parcheo de manifest/gradle/iconos), copiado de `android app/html_to_apk_builder.py` de inhouse notes y adaptado: se le quitó toda la lógica específica de Notes que no aplica aquí (exportar PDF a un bridge nativo, el instalador de auto-actualización, el deep-link de OAuth por esquema de URI propio) para no cargar la nueva app con código muerto o engañoso bajo su nombre.
- El keystore de firma (`inhouse-read-release.jks`, válido hasta 2054) se generó una vez con `keytool` y vive únicamente como secrets del repo (`INHOUSE_READ_ANDROID_KEYSTORE_BASE64`, `_PASSWORD`, `_KEY_ALIAS`) y en una copia local fuera de este repositorio — nunca en el código ni en este README.

## Limitación honesta: Google Drive no funciona (todavía) dentro del APK

La app web usa Google Identity Services (`accounts.google.com`) para el login de Drive, pensado para un navegador normal. Google **bloquea ese flujo de OAuth dentro de un WebView embebido** (política de "disallowed_useragent" desde 2017) — es una restricción de Google, no un bug de esta app. Dentro del navegador normal, o instalada como PWA ("Añadir a pantalla de inicio"), Drive funciona sin problema.

Arreglarlo dentro del APK nativo requiere: (1) registrar un segundo cliente OAuth de tipo "Android" en Google Cloud con el SHA-1 de este keystore de firma, y (2) añadir en `MainActivity` el manejo de un deep-link de retorno (`openAuthUrl` ya está en el builder, listo para esto — ver `patch_webview_bridge` en `html_to_apk_builder.py`) más el código JS correspondiente en `drive-client.js` para usar ese puente en vez del popup normal cuando la app detecta que corre dentro del WebView. No implementado todavía porque nadie lo ha pedido explícitamente — es trabajo real de otra sesión, no una casilla que falte marcar.

## Cómo instalar

**Vía APK firmado**: pestaña [Releases](https://github.com/miguelcoxcaballero/inhouse-read/releases) del repo, tag `android-v1.0.0` → descargar `inhouse-read-release-v1.0.0.apk` → instalar (Android pedirá permitir "orígenes desconocidos" la primera vez, es normal para un APK fuera de Play Store).

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
