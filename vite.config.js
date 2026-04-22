import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { BASE_PATH } from './src/trip.config.js'

export default defineConfig({
  base: BASE_PATH,
  plugins: [react()],
})
