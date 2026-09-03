import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // ASSERT_API points the dev server at a backend other than the deployed
      // one, e.g. a branch running on a scratch port.
      '/api': process.env.ASSERT_API || 'http://127.0.0.1:18400',
    },
  },
})
