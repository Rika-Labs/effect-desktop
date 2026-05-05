import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const APP_NONCE_PLACEHOLDER = "__APP_NONCE__"
const APP_ASSET_BASE_URL = "app://localhost/"

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), noncePlaceholder()],
  base: command === "build" ? APP_ASSET_BASE_URL : "/",
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    hmr: {
      host: "127.0.0.1",
      port: 5174
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

function noncePlaceholder(): Plugin {
  return {
    name: "effect-desktop-template-nonce-placeholder",
    enforce: "post",
    transformIndexHtml(html) {
      return html
        .replaceAll("<script ", `<script nonce="${APP_NONCE_PLACEHOLDER}" `)
        .replaceAll(
          '<link rel="stylesheet" ',
          `<link rel="stylesheet" nonce="${APP_NONCE_PLACEHOLDER}" `
        )
    }
  }
}
