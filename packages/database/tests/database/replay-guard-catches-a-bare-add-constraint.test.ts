import { describe, expect, it } from "vitest";

import { findNonIdempotentStatements } from "../support/non-idempotent-ddl";

const BARE_ADD_CONSTRAINT = `ALTER TABLE "deletion_residue" ADD CONSTRAINT "probe_check" CHECK (length("kind") >= 0);`;

const GUARDED_ADD_CONSTRAINT = `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'probe_check'
      AND conrelid = 'deletion_residue'::regclass
  ) THEN
    ALTER TABLE "deletion_residue"
      ADD CONSTRAINT "probe_check"
      CHECK (length("kind") >= 0) NOT VALID;
  END IF;
END
$$;`;

describe("the replay guard covers ALTER TABLE ... ADD CONSTRAINT", () => {
  it("reports a bare ADD CONSTRAINT as a non-idempotent statement", () => {
    const offenders = findNonIdempotentStatements(BARE_ADD_CONSTRAINT);

    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain("ADD CONSTRAINT");
  });

  it("accepts an ADD CONSTRAINT wrapped in a DO $$ ... IF NOT EXISTS block", () => {
    expect(findNonIdempotentStatements(GUARDED_ADD_CONSTRAINT)).toEqual([]);
  });
});
