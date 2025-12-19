import { log } from "@keeper.sh/log";
import { Glob } from "bun";
import { join } from "node:path";

/**
 * @throws
 */
export const getAllJobs = async (rootDirectory: string) => {
  log.info({ rootDirectory }, "scanning for jobs");

  const globPattern = join(rootDirectory, "**/*.{ts,js}");
  const globScanner = new Glob(globPattern);
  const entrypoints = await Array.fromAsync(globScanner.scan());

  const imports = entrypoints.map(async (entrypoint) => {
    return import(entrypoint).then((module) => module.default);
  });

  log.info({ "imports.length": imports.length }, `imported all jobs`);

  return Promise.all(imports);
};
