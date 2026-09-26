import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dirección del backend. Se puede cambiar sin editar el archivo:
//   FP_API_TARGET=http://127.0.0.2:8000 npm run dev
const API_TARGET = process.env.FP_API_TARGET || 'http://localhost:8000'
// Servicio MJPEG del proveedor YOLO. Se mantiene separado del backend para que
// el procesamiento de video no bloquee la API ni los módulos RFID/CSI.
const VISION_TARGET = process.env.FP_VISION_TARGET || 'http://localhost:8001'

export default defineConfig({
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
      '/vision': {
        target: VISION_TARGET,
        changeOrigin: true,
      },
    },
  },
})
