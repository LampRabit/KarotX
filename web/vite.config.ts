import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // During `pnpm dev`, run `karotx --no-open` alongside; API calls are proxied to it.
  server: { proxy: { '/api': 'http://localhost:8732' } },
  build: { outDir: 'dist', emptyOutDir: true },
})
