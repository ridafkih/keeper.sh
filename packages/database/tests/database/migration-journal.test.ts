import { describe, expect, it } from "vitest";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

const readJournal = async (): Promise<JournalEntry[]> => {
  const journal = await Bun.file(`${import.meta.dirname}/../../drizzle/meta/_journal.json`).json() as { entries: JournalEntry[] };
  return journal.entries.toSorted((first, second) => first.idx - second.idx);
};

// Drizzle applies only entries newer than the last applied `when`, so a stamp out of order is silently skipped on upgraded databases.
describe("migration journal", () => {
  it("stamps every migration later than the one before it", async () => {
    const entries = await readJournal();
    const outOfOrder: string[] = [];
    for (const [index, entry] of entries.entries()) {
      const previous = entries[index - 1];
      if (previous && entry.when <= previous.when) {
        outOfOrder.push(`${previous.tag} → ${entry.tag}`);
      }
    }
    expect(outOfOrder).toEqual([]);
  });
});
