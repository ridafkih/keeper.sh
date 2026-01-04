import { Glob } from "bun";
import { join } from "node:path";

export const getAllJobs = async (rootDirectory: string) => {
  const globPattern = join(rootDirectory, "**/*.{ts,js}");
  const globScanner = new Glob(globPattern);
  const entrypoints = await Array.fromAsync(globScanner.scan());

  const imports = entrypoints.map(async (entrypoint) => {
    return import(entrypoint).then((module) => module.default);
  });

  return Promise.all(imports);
};
