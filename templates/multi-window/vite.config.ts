import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const APP_ASSET_BASE_URL = "app://localhost/"

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === "build" ? APP_ASSET_BASE_URL : "/",
  server: {
    host: "127.0.0.1",
    port: 5176,
    strictPort: true,
    hmr: {
      host: "127.0.0.1",
      port: 5176
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
    target: "es2022",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
}))
