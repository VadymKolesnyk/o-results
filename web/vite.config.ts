import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Сайт віддається з кореня власного домену o-results.online (Settings → Pages →
// Custom domain; public/CNAME — його копія в репо), тож base = '/'. Форк без
// власного домену живе на <логін>.github.io/o-results/ — там потрібно
// base = '/o-results/' і без public/CNAME.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
})
