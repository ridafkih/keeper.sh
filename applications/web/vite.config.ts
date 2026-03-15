import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
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
    babel({
      presets: [
        ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
        reactCompilerPreset(),
      ],
    }),
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
      "/mcp": {
        changeOrigin: true,
        target: "http://localhost:3001",
      },
    },
  },
}));
