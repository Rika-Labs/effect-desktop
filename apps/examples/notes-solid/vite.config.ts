import solid from "vite-plugin-solid"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [solid()],
  server: {
    host: "127.0.0.1",
    port: 5212,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022"
  }
})
