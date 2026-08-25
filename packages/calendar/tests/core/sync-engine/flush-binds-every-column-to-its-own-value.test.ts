import { describe, expect, it } from "vitest";

/*
 * The batched mapping update names its columns in one place and supplies their values in another.
 * Postgres binds those two lists by POSITION, so a pair of same-typed columns in the wrong order
 * is accepted silently and writes each one's value into the other. No test that fakes the flush
 * can see it, and remoteStartTime and remoteEndTime are both timestamptz.
 */
const FLUSH_SOURCE = await Bun.file(
  new URL("../../../src/core/sync-engine/flush.ts", import.meta.url),
).text();

const readUpdateRowFields = (source: string): string[] => {
  const body = source.split("const buildUpdateRow")[1]?.split(")`;")[0] ?? "";
  return [...body.matchAll(/\$\{[^}]*?update\.(\w+)/g)].map(([, field]) => field ?? "");
};

const readSourceAliasColumns = (source: string): string[] => {
  const body = source.split("as source (")[1]?.split(")")[0] ?? "";
  return [...body.matchAll(/"(\w+)"/g)].map(([, column]) => column ?? "");
};

describe("the batched mapping update binds every column to its own value", () => {
  it("supplies the values in exactly the order the source alias names them", () => {
    expect(readUpdateRowFields(FLUSH_SOURCE)).toEqual(readSourceAliasColumns(FLUSH_SOURCE));
  });

  it("keeps the two timestamptz columns apart, which is the pair Postgres cannot catch", () => {
    const columns = readSourceAliasColumns(FLUSH_SOURCE);
    const fields = readUpdateRowFields(FLUSH_SOURCE);

    expect(columns.indexOf("remoteStartTime")).toBe(fields.indexOf("remoteStartTime"));
    expect(columns.indexOf("remoteEndTime")).toBe(fields.indexOf("remoteEndTime"));
  });

  it("reads both lists rather than silently comparing nothing", () => {
    expect(readUpdateRowFields(FLUSH_SOURCE).length).toBeGreaterThan(6);
    expect(readSourceAliasColumns(FLUSH_SOURCE)).toContain("remoteStartTime");
  });
});
