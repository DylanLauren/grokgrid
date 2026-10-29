import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // three.js changes far less often than the room, so it caches on its own
      output: {
        codeSplitting: {
          groups: [
            // react goes first so the three chunk can't swallow it and load with the entry
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'three', test: /node_modules[\\/](three|@react-three)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
