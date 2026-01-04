import type { CronOptions } from "cronbake";
import { Glob } from "bun";
import { join } from "node:path";

type JobExport = CronOptions | CronOptions[];

export const getAllJobs = async (rootDirectory: string): Promise<CronOptions[]> => {
  const globPattern = join(rootDirectory, "**/*.{ts,js}");
  const globScanner = new Glob(globPattern);
  const entrypoints = await Array.fromAsync(globScanner.scan());

  const imports = entrypoints.map(async (entrypoint): Promise<JobExport> => {
    const module = await import(entrypoint);
    return module.default;
  });

  const jobExports = await Promise.all(imports);
  return jobExports.flat();
};
