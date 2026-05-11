/** @type {import("next").NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@effect-desktop/bridge",
    "@effect-desktop/core",
    "@effect-desktop/example-notes-common",
    "@effect-desktop/next",
    "@effect-desktop/react"
  ],
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"]
    }
    return config
  }
}

export default nextConfig
