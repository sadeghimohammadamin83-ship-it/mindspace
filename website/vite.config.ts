import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set SITE_BASE=/ for a custom domain; defaults to the GitHub Pages project path.
export default defineConfig({
  base: process.env.SITE_BASE ?? '/mindspace/',
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false }
})
