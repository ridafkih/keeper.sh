import { Glob, build } from "bun";

const entrypoints = [
  ...new Glob("src/routes/**/*.ts")
    .scanSync()
    .filter((filePath) => !/\.(test|spec)\.ts$/.test(filePath)),
  ...new Glob("src/index.ts").scanSync(),
];

await build({
  entrypoints,
  outdir: "./dist",
  root: "src",
  splitting: true,
  target: "bun",
  external: ["msgpackr-extract", "pino-opentelemetry-transport", "js-sha256"],
});
