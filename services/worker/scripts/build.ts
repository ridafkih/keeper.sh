import { Glob, build } from "bun";

const ENTRY_POINT_GLOB = new Glob("src/index.ts");

const entrypoints = [...ENTRY_POINT_GLOB.scanSync()];

await build({
  entrypoints,
  outdir: "./dist",
  root: "src",
  target: "bun",
  external: ["msgpackr-extract", "pino-opentelemetry-transport"],
});
