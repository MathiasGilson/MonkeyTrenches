import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { nodePolyfills } from "vite-plugin-node-polyfills"

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), nodePolyfills()],
    base: process.env.NODE_ENV === "production" ? "/MonkeyPlanet/" : "/",
    build: {
        outDir: "dist",
        assetsDir: "assets",
        sourcemap: true
    }
})
