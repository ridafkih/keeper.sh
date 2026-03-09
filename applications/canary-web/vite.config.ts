import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    tailwindcss(),
    tanstackRouter({
      autoCodeSplitting: true,
      generatedRouteTree: "src/generated/tanstack/route-tree.generated.ts",
      target: "react",
    }),
    react(),
    svgr(),
    !isSsrBuild
      ? visualizer({
          brotliSize: true,
          filename: "./dist/client/report.md",
          gzipSize: true,
          open: false,
          template: "markdown",
        })
      : undefined,
  ].filter(Boolean),
  build: {
    sourcemap: process.env.NODE_ENV !== "production",
    rollupOptions: !isSsrBuild
      ? {
          output: {
            manualChunks(id) {
              if (id.includes("/react-dom/") || id.includes("/react/")) {
                return "react-vendor";
              }
            },
          },
        }
      : undefined,
  },
  server: {
    allowedHosts: ["macbook"],
    host: "0.0.0.0",
    proxy: {
      "/api": {
        changeOrigin: true,
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
}));
