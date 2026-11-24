/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 5173 con strictPort: es el origen permitido por CORS en la API.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: 'localhost' },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
})
