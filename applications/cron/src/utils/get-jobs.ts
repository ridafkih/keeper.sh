import type { CronOptions } from "cronbake";
import { Glob } from "bun";
import { basename, join } from "node:path";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isCronOptionsExport = (value: unknown): value is CronOptions =>
  isRecord(value)
  && typeof value.callback === "function"
  && typeof value.name === "string";

const createMissingDefaultExportError = (entrypoint: string): Error =>
  new Error(`Job module ${entrypoint} is missing a default cron export`);

const createInvalidCronExportError = (entrypoint: string, suffix?: string): Error =>
  new Error(`Job module ${entrypoint} has an invalid cron export${suffix ?? ""}`);

const normalizeJobExport = (value: unknown, entrypoint: string): CronOptions[] => {
  if (value === globalThis.undefined) {
    throw createMissingDefaultExportError(entrypoint);
  }

  if (Array.isArray(value)) {
    const jobs: CronOptions[] = [];
    for (const [index, entry] of value.entries()) {
      if (!isCronOptionsExport(entry)) {
        throw createInvalidCronExportError(entrypoint, ` at index ${index}`);
      }

      jobs.push(entry);
    }

    return jobs;
  }

  if (isCronOptionsExport(value)) {
    return [value];
  }

  throw createInvalidCronExportError(entrypoint);
};

const isRuntimeJobEntrypoint = (entrypoint: string): boolean => {
  const fileName = basename(entrypoint);
  return !fileName.endsWith(".test.ts")
    && !fileName.endsWith(".test.js")
    && !fileName.endsWith(".spec.ts")
    && !fileName.endsWith(".spec.js")
    && !fileName.endsWith(".d.ts");
};

export const getAllJobs = async (rootDirectory: string): Promise<CronOptions[]> => {
  const globPattern = join(rootDirectory, "**/*.{ts,js}");
  const globScanner = new Glob(globPattern);
  const allEntrypoints = await Array.fromAsync(globScanner.scan());
  const entrypoints = allEntrypoints.filter((entrypoint) => isRuntimeJobEntrypoint(entrypoint));

  const imports = entrypoints.map(async (entrypoint): Promise<{ entrypoint: string; defaultExport: unknown }> => {
    const module = await import(entrypoint);
    return {
      defaultExport: module.default,
      entrypoint,
    };
  });

  const defaultExports = await Promise.all(imports);
  return defaultExports.flatMap(({ defaultExport, entrypoint }) =>
    normalizeJobExport(defaultExport, entrypoint),
  );
};
