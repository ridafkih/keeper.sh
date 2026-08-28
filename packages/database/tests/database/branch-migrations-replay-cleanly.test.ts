import { describe, expect, it } from "vitest";

import { findNonIdempotentStatements } from "../support/non-idempotent-ddl";

const DRIZZLE_DIRECTORY = `${import.meta.dirname}/../../drizzle`;

const FIRST_BRANCH_MIGRATION_TIMESTAMP = 1_787_760_393_990;

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface Journal {
  entries: JournalEntry[];
}

const readJournal = async (): Promise<Journal> =>
  await Bun.file(`${DRIZZLE_DIRECTORY}/meta/_journal.json`).json() as Journal;

describe("branch migrations replay cleanly on an already-migrated database", () => {
  it("emits only idempotent DDL in every migration this branch added", async () => {
    const journal = await readJournal();
    const branchEntries = journal.entries
      .filter((entry) => entry.when >= FIRST_BRANCH_MIGRATION_TIMESTAMP)
      .toSorted((first, second) => first.idx - second.idx);

    expect(branchEntries.map((entry) => entry.tag)).toContain("0095_smooth_the_spike");

    const offenders: string[] = [];
    for (const entry of branchEntries) {
      const sql = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).text();
      offenders.push(...findNonIdempotentStatements(sql).map((offender) => `${entry.tag}: ${offender}`));
    }

    expect(offenders).toEqual([]);
  });
});
