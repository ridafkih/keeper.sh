import { type BunPlugin, Glob, build } from "bun";

const ENTRY_POINT_GLOB = new Glob("src/index.ts");

const entrypoints = [...ENTRY_POINT_GLOB.scanSync()];

const fixEvalRequire: BunPlugin = {
  name: "fix-eval-require",
  setup(build) {
    build.onLoad({ filter: /js-sha256/ }, async (args) => {
      const contents = await Bun.file(args.path).text();
      return {
        contents: contents
          .replace(`eval("require('crypto')")`, `require("crypto")`)
          .replace(`eval("require('buffer').Buffer")`, `require("buffer").Buffer`),
        loader: "js",
      };
    });
  },
};

await build({
  entrypoints,
  outdir: "./dist",
  root: "src",
  target: "bun",
  plugins: [fixEvalRequire],
  external: ["msgpackr-extract", "pino-opentelemetry-transport"],
});
