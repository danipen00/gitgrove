import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [] })],
    build: {
      rollupOptions: {
        // electron is a devDependency, so externalizeDepsPlugin won't catch it;
        // it must stay external (it's provided by the runtime).
        external: ['electron'],
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: [] })],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react()],
    // @pierre/diffs ships a worker that shiki tokenizes in; bundle deps for the browser.
    optimizeDeps: {
      include: ['@pierre/diffs', '@pierre/diffs/react', '@pierre/trees', '@pierre/trees/react']
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
