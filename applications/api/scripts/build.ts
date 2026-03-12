import { Glob, build } from "bun";

const entrypoints = [
  ...new Glob("src/routes/**/!(*test).ts").scanSync(),
  ...new Glob("src/index.ts").scanSync(),
];

await build({
  entrypoints,
  outdir: "./dist",
  root: "src",
  splitting: true,
  target: "bun",
});
