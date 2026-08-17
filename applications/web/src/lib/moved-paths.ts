import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MOVED_PATHS_PATH = path.resolve(process.cwd(), "dist/client/moved-paths.json");

function readMovedPaths(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(MOVED_PATHS_PATH, "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

const MOVED_PATHS = readMovedPaths();

export function resolveMovedPath(pathname: string): string | null {
  return MOVED_PATHS[pathname] ?? null;
}
