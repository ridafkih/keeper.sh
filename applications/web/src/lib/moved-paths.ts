import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type } from "arktype";
import { MOVED_PATHS_FILE } from "./content-paths";
import { clientDistDirectory } from "../server/paths";

const movedPathsSchema = type({ "[string]": "string" });

const MOVED_PATHS_PATH = path.join(clientDistDirectory, MOVED_PATHS_FILE);

function readMovedPaths(): Record<string, string> {
  if (!existsSync(clientDistDirectory)) return {};

  if (!existsSync(MOVED_PATHS_PATH)) {
    throw new Error(`The client build produced no ${MOVED_PATHS_FILE}.`);
  }

  const moved = movedPathsSchema(JSON.parse(readFileSync(MOVED_PATHS_PATH, "utf-8")));

  if (moved instanceof type.errors) {
    throw new Error(`Invalid redirect map in ${MOVED_PATHS_PATH}: ${moved.summary}`);
  }

  return moved;
}

const MOVED_PATHS = readMovedPaths();

export function resolveMovedPath(pathname: string): string | null {
  return MOVED_PATHS[pathname] ?? null;
}
