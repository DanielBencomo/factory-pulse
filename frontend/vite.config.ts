import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dirección del backend. Se puede cambiar sin editar el archivo:
//   FP_API_TARGET=http://127.0.0.2:8000 npm run dev
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
export default defineConfig(({ mode }) => {
  const API_TARGET = loadEnv(mode, repoRoot, 'FP_').FP_API_TARGET || 'http://127.0.0.1:8000'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: true,
        },
        '/ws': {
          target: API_TARGET.replace(/^http/, 'ws'),
          ws: true,
        },
      },
    },
  }
})
