interface MigrationJournalEntry {
  tag: string;
  when: number;
}

interface MigrationJournal {
  entries: MigrationJournalEntry[];
}

interface MigrationRunReport {
  level: number;
  "migrations.applied": string[];
  "migrations.applied_count": number;
  "migrations.known_count": number;
  msg: string;
  time: string;
}

const INFO_LEVEL = 30;

const selectPendingMigrations = (
  journal: MigrationJournal,
  lastAppliedAt: number | null,
): string[] =>
  journal.entries
    .toSorted((first, second) => first.when - second.when)
    .filter(({ when }) => lastAppliedAt === null || when > lastAppliedAt)
    .map(({ tag }) => tag);

const describeMigrationRun = (
  journal: MigrationJournal,
  applied: string[],
  at: Date,
): MigrationRunReport => {
  const report = {
    level: INFO_LEVEL,
    "migrations.applied": applied,
    "migrations.applied_count": applied.length,
    "migrations.known_count": journal.entries.length,
    time: at.toISOString(),
  };
  if (applied.length === 0) {
    return { ...report, msg: "database migrations already applied" };
  }
  return { ...report, msg: "database migrations applied" };
};

export { describeMigrationRun, selectPendingMigrations };
export type { MigrationJournal, MigrationJournalEntry, MigrationRunReport };
