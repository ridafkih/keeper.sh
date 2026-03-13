import { Glob, build } from "bun";

await Bun.$`rm -rf dist`;

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
});
