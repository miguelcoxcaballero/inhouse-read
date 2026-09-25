import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

const resolvePath = p => fileURLToPath(new URL(p, import.meta.url))

// GitHub Pages sirve el proyecto bajo /inhouse-read/, no en la raíz del dominio.
export default defineConfig({
  base: '/inhouse-read/',
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // Multi-página: la app en sí (index.html) y la landing de descarga de
      // Android (download-android.html), servida como página real del
      // sitio en vez de solo enlazar directo al asset de un Release.
      input: {
        main: resolvePath('./index.html'),
        androidDownload: resolvePath('./download-android.html')
      }
    }
  },
  server: {
    port: 5173
  }
})
