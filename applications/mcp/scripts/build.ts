import { build } from "bun";

await build({
  entrypoints: ["src/index.ts"],
  outdir: "./dist",
  root: "src",
  splitting: false,
  target: "bun",
});
