import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = `${import.meta.dirname}/../..`;
const DRIZZLE_DIRECTORY = `${PACKAGE_ROOT}/drizzle`;
const META_DIRECTORY = `${DRIZZLE_DIRECTORY}/meta`;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface Journal {
  readonly entries: readonly JournalEntry[];
}

const BENIGN_MISSING_SNAPSHOT_TAGS = new Set(["0077_married_dracula"]);

const readJournal = async (): Promise<Journal> =>
  await Bun.file(`${META_DIRECTORY}/_journal.json`).json() as Journal;

const snapshotPathFor = (entry: JournalEntry): string =>
  `${META_DIRECTORY}/${String(entry.idx).padStart(4, "0")}_snapshot.json`;

const describeEntry = (entry: JournalEntry): string => `${entry.idx} (${entry.tag})`;

const findEntriesMissingMigrationSql = async (
  entries: readonly JournalEntry[],
): Promise<string[]> => {
  const missing: string[] = [];
  for (const entry of entries) {
    const exists = await Bun.file(`${DRIZZLE_DIRECTORY}/${entry.tag}.sql`).exists();
    if (!exists) {
      missing.push(describeEntry(entry));
    }
  }
  return missing;
};

const findEntriesMissingSnapshot = async (
  entries: readonly JournalEntry[],
): Promise<string[]> => {
  const missing: string[] = [];
  for (const entry of entries) {
    if (BENIGN_MISSING_SNAPSHOT_TAGS.has(entry.tag)) {
      continue;
    }
    const exists = await Bun.file(snapshotPathFor(entry)).exists();
    if (!exists) {
      missing.push(describeEntry(entry));
    }
  }
  return missing;
};

const findEntriesWithUnparseableSnapshot = async (
  entries: readonly JournalEntry[],
): Promise<string[]> => {
  const unparseable: string[] = [];
  for (const entry of entries) {
    const file = Bun.file(snapshotPathFor(entry));
    const exists = await file.exists();
    if (!exists) {
      continue;
    }
    try {
      await file.json();
    } catch {
      unparseable.push(describeEntry(entry));
    }
  }
  return unparseable;
};

interface NewestSnapshotReport {
  readonly entry: string;
  readonly snapshotExists: boolean;
}

const reportNewestSnapshot = async (
  entries: readonly JournalEntry[],
): Promise<NewestSnapshotReport> => {
  const [newest] = entries.toSorted((first, second) => second.idx - first.idx);
  if (!newest) {
    return { entry: "no journal entries at all", snapshotExists: false };
  }
  return {
    entry: describeEntry(newest),
    snapshotExists: await Bun.file(snapshotPathFor(newest)).exists(),
  };
};

describe("drizzle journal and snapshot consistency", () => {
  it("ships a migration .sql for every journal entry", async () => {
    const journal = await readJournal();
    expect(journal.entries.length).toBeGreaterThan(0);

    const missing = await findEntriesMissingMigrationSql(journal.entries);

    expect(missing).toEqual([]);
  });

  it("ships a meta snapshot for every journal entry", async () => {
    const journal = await readJournal();
    expect(journal.entries.length).toBeGreaterThan(0);

    const missing = await findEntriesMissingSnapshot(journal.entries);

    expect(missing).toEqual([]);
  });

  it("ships snapshots that parse as JSON", async () => {
    const journal = await readJournal();

    const unparseable = await findEntriesWithUnparseableSnapshot(journal.entries);

    expect(unparseable).toEqual([]);
  });

  it("records every column the schema declares in the newest snapshot", async () => {
    const journal = await readJournal();
    const [newest] = journal.entries.toSorted((first, second) => second.idx - first.idx);
    const snapshot = await Bun.file(snapshotPathFor(newest as JournalEntry)).text();

    for (const column of ["verificationCursor", "consecutiveUpdateFailures", "consecutiveUnsettledReads"]) {
      expect(snapshot).toContain(column);
    }
  });

  it("ships a snapshot for the newest journal entry", async () => {
    const journal = await readJournal();

    const report = await reportNewestSnapshot(journal.entries);

    expect(report.snapshotExists).toBe(true);
  });
});
