import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
import { blogPlugin } from "./plugins/blog";
import { sitemapPlugin } from "./plugins/sitemap";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    blogPlugin(),
    tailwindcss(),
    tanstackRouter({
      autoCodeSplitting: true,
      generatedRouteTree: "src/generated/tanstack/route-tree.generated.ts",
      target: "react",
    }),
    react(),
    svgr(),
    !isSsrBuild && sitemapPlugin(),
  ].filter(Boolean),
  build: {
    manifest: !isSsrBuild,
    sourcemap: process.env.ENV !== "production",
    rollupOptions: !isSsrBuild
      ? {
          external: ["mermaid"],
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
