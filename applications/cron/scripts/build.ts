import { Glob, build } from "bun";

const ROUTES_GLOB = new Glob("src/jobs/**/*.ts");
const ENTRY_POINT_GLOB = new Glob("src/index.ts");

const entrypoints = [...ROUTES_GLOB.scanSync(), ...ENTRY_POINT_GLOB.scanSync()];

build({
  entrypoints,
  outdir: "./dist",
  root: "src",
  target: "bun",
});
