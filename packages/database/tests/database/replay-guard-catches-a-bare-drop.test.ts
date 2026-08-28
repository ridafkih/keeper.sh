import { describe, expect, it } from "vitest";

import { findNonIdempotentStatements } from "../support/non-idempotent-ddl";

const BARE_DROPS = [
  `ALTER TABLE "deletion_residue" DROP COLUMN "accountEmail";`,
  `DROP INDEX "deletion_residue_due_idx";`,
  `DROP TABLE "deletion_residue";`,
  `ALTER TABLE "deletion_residue" DROP CONSTRAINT "deletion_residue_user_fk";`,
].join("\n--> statement-breakpoint\n");

const GUARDED_DROPS = [
  `ALTER TABLE "deletion_residue" DROP COLUMN IF EXISTS "accountEmail";`,
  `DROP INDEX IF EXISTS "deletion_residue_due_idx";`,
  `DROP TABLE IF EXISTS "deletion_residue";`,
  `ALTER TABLE "deletion_residue" DROP CONSTRAINT IF EXISTS "deletion_residue_user_fk";`,
].join("\n--> statement-breakpoint\n");

const GUARDED_DROP_CONSTRAINT_DO_BLOCK = `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deletion_residue_user_fk'
      AND conrelid = 'deletion_residue'::regclass
  ) THEN
    ALTER TABLE "deletion_residue" DROP CONSTRAINT "deletion_residue_user_fk";
  END IF;
END
$$;`;

const DRIZZLE_DIRECTORY = `${import.meta.dirname}/../../drizzle`;

const BRANCH_MIGRATION_TAGS = [
  "0093_sticky_jimmy_woo",
  "0094_stale_arachne",
  "0095_smooth_the_spike",
  "0096_flaky_whirlwind",
];

describe("the replay guard covers bare DROP statements", () => {
  it("reports every bare drop a replay would fail on, naming its kind", () => {
    const offenders = findNonIdempotentStatements(BARE_DROPS);

    expect(offenders).toHaveLength(4);
    expect(offenders[0]).toContain("DROP COLUMN");
    expect(offenders[1]).toContain("DROP INDEX");
    expect(offenders[2]).toContain("DROP TABLE");
    expect(offenders[3]).toContain("DROP CONSTRAINT");
    for (const offender of offenders) {
      expect(offender).toContain("IF EXISTS");
    }
  });

  it("accepts the IF EXISTS form of each of those drops", () => {
    expect(findNonIdempotentStatements(GUARDED_DROPS)).toEqual([]);
  });

  it("still honours the DO $$ escape hatch for a guarded DROP CONSTRAINT", () => {
    expect(findNonIdempotentStatements(GUARDED_DROP_CONSTRAINT_DO_BLOCK)).toEqual([]);
  });

  it("leaves the migrations this branch added clean", async () => {
    const offenders: string[] = [];
    for (const tag of BRANCH_MIGRATION_TAGS) {
      const sql = await Bun.file(`${DRIZZLE_DIRECTORY}/${tag}.sql`).text();
      offenders.push(...findNonIdempotentStatements(sql).map((offender) => `${tag}: ${offender}`));
    }

    expect(offenders).toEqual([]);
  });
});
