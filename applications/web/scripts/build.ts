import { build } from "bun";

await build({
  entrypoints: ["src/server/index.ts"],
  outdir: "./dist/server-entry",
  target: "bun",
  splitting: false,
  external: [
    "entrykit",
    "linkedom",
    "fast-xml-parser",
    "vite",
    "yaml",
    "widelogger",
    "pino-opentelemetry-transport",
  ],
});
