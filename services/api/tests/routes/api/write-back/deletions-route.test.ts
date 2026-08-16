import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routesDirectory = join(import.meta.dirname, "../../../../src/routes");

/*
 * The consent that turns on deletion propagation is given against a promise that the user
 * can see what Keeper.sh deleted. A record with no route to it is not a record they have,
 * so the mapping from the URL the dashboard asks for to a module that serves it is part of
 * the promise and is asserted here rather than left to the file layout.
 */
describe("the route the record of deleted events is read from", () => {
  it("serves /api/write-back/deletions", () => {
    const router = new Bun.FileSystemRouter({ dir: routesDirectory, style: "nextjs" });
    const match = router.match("/api/write-back/deletions");

    expect(match).not.toBeNull();
  });

  it("answers GET with the signed-in user's deletions", () => {
    const router = new Bun.FileSystemRouter({ dir: routesDirectory, style: "nextjs" });
    const match = router.match("/api/write-back/deletions");
    const source = readFileSync(match?.filePath ?? "", "utf8");

    expect(source).toMatch(/export\s*\{[^}]*\bGET\b/);
    expect(source).toContain("withAuth");
    expect(source).toContain("listWriteBackDeletions");
  });
});
