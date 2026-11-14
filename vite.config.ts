import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Bluefy on iPhone is WebKit: keep the output to what older Safari understands.
  build: { target: ['es2020', 'safari14'] },
  test: { include: ['src/**/*.test.ts'] },
})
