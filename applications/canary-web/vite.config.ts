import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import svgr from "vite-plugin-svgr"
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      generatedRouteTree: 'src/generated/tanstack/route-tree.generated.ts'
    }),
    react(),
    svgr(),
    visualizer({
      filename: "./dist/report.md",
      template: "markdown",
      gzipSize: true,
      brotliSize: true,
      open: true,
    })
  ],
  build: {
    sourcemap: process.env.NODE_ENV !== "production",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/react-dom/") || id.includes("/react/")) {
            return "react-vendor";
          }
        },
      },
    },
  },
  server: {
    allowedHosts: ["macbook"],
    host: "0.0.0.0",
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
