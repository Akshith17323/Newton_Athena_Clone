import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/exam': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
