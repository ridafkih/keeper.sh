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

/*
 * 0077's snapshot was never committed and is absent from origin/main too. The
 * gap is benign because drizzle-kit diffs schema.ts against only the *newest*
 * snapshot it can find: 0078 was generated while 0077's snapshot still existed
 * on its author's machine, so 0078_snapshot.json already carries every column
 * 0077 added and nothing downstream ever reads the missing file. A missing
 * snapshot is only dangerous when it is the newest one, because then the next
 * generate diffs against a schema that predates the un-snapshotted migration
 * and re-emits its DDL. This exemption is by tag, not by rule: any other
 * missing snapshot must still fail.
 */
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

  /*
   * The regression that motivated this suite: 0094 added
   * calendars.verificationCursor without committing its snapshot, so the newest
   * snapshot drizzle-kit could find (0093) did not know the column existed and
   * the next generate re-emitted `ALTER TABLE "calendars" ADD COLUMN
   * "verificationCursor" text;` with no IF NOT EXISTS, which fails 42701 on any
   * database that already ran 0094 and blocks every migration after it.
   */
  it("records calendars.verificationCursor in the 0094 snapshot", async () => {
    const snapshot = Bun.file(`${META_DIRECTORY}/0094_snapshot.json`);

    expect(await snapshot.exists()).toBe(true);
    expect(await snapshot.text()).toContain("verificationCursor");
  });

  /*
   * The newest snapshot is the one drizzle-kit diffs against, so it must always
   * be present even if an older intermediate gap is tolerated.
   */
  it("ships a snapshot for the newest journal entry", async () => {
    const journal = await readJournal();

    const report = await reportNewestSnapshot(journal.entries);

    expect(report.snapshotExists).toBe(true);
  });
});
