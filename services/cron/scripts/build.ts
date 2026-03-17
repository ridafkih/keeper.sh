import { Glob, build } from "bun";

const ROUTES_GLOB = new Glob("src/jobs/**/*.ts");
const ENTRY_POINT_GLOB = new Glob("src/index.ts");

const entrypoints = [
  ...ROUTES_GLOB.scanSync().filter((filePath) => !/\.(test|spec)\.ts$/.test(filePath)),
  ...ENTRY_POINT_GLOB.scanSync(),
];

await build({
  entrypoints,
  outdir: "./dist",
  root: "src",
  target: "bun",
  external: ["msgpackr-extract"],
});
