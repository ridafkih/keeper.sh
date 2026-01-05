import { build, Glob } from "bun";

const ROUTES_GLOB = new Glob("src/routes/**/*.ts");
const ENTRY_POINT_GLOB = new Glob("src/index.ts");

const entrypoints = Array.from([...ROUTES_GLOB.scanSync(), ...ENTRY_POINT_GLOB.scanSync()]);

await build({
  entrypoints,
  outdir: "./dist",
  root: "src",
  target: "bun",
  splitting: true,
});
