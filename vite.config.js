import { defineConfig } from 'vite'

// GitHub Pages sirve el proyecto bajo /inhouse-read/, no en la raíz del dominio.
export default defineConfig({
  base: '/inhouse-read/',
  build: {
    target: 'es2022',
    sourcemap: true
  },
  server: {
    port: 5173
  }
})
