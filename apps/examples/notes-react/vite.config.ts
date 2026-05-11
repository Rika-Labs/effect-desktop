import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5210,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022"
  }
})
