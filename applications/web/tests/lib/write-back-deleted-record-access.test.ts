import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webSource = join(import.meta.dirname, "../../src");
const apiRoutes = join(import.meta.dirname, "../../../../services/api/src/routes");

const collectSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return collectSourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
  });

const filesReferencing = (directory: string, needle: string): string[] =>
  collectSourceFiles(directory).filter((path) => readFileSync(path, "utf8").includes(needle));

const DELETIONS_ENDPOINT = "/api/write-back/deletions";
const DELETED_EVENTS_PAGE = "/dashboard/deleted-events";

/*
 * Turning on deletion propagation is authorized against one reassurance: "Keeper.sh keeps a
 * record of deleted events for 30 days". The snapshots really are written and really are
 * retained, but a record only the database can answer for is not one the user has. Someone
 * who deleted a copy by mistake — the exact case that sentence is there to soften — has to
 * be able to reach it from the product.
 */
describe("the record of deleted events the consent promises", () => {
  it("is served by the API", () => {
    expect(filesReferencing(apiRoutes, "listWriteBackDeletions")).not.toEqual([]);
  });

  it("is asked for by the dashboard", () => {
    expect(filesReferencing(webSource, DELETIONS_ENDPOINT)).not.toEqual([]);
  });

  it("has a page of its own in the dashboard", () => {
    const page = join(webSource, "routes/(dashboard)/dashboard/deleted-events.tsx");

    expect(readFileSync(page, "utf8")).toContain(DELETIONS_ENDPOINT);
  });

  it("is linked from the modal that makes the promise", () => {
    const twoWaySections = join(
      webSource,
      "features/dashboard/components/two-way-sync-sections.tsx",
    );
    const source = readFileSync(twoWaySections, "utf8");
    const consentModal = source.slice(source.indexOf("function DeletionConsentModal"));

    expect(consentModal).toContain(DELETED_EVENTS_PAGE);
  });

  it("is named by the documentation that makes the same promise", () => {
    const doc = readFileSync(join(webSource, "content/docs/two-way-sync.mdx"), "utf8");

    expect(doc).toContain("Deleted Events");
  });
});
