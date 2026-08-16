import { describe, expect, it } from "vitest";
import { WRITE_BACK_WITNESS_RESET } from "@keeper.sh/calendar";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { resolveWriteBackPolicies } from "../src/sync-user";

const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SOURCE_CALENDAR_ID = "source-calendar-id";

type RecordedUpdate = Record<string, unknown>;

const createSelectChain = (
  rows: Record<string, unknown>[],
): Record<string, unknown> => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain;
};

/*
 * The live client resolves a where clause into a promise that also exposes returning, so
 * a fake that only models one of the two shapes cannot observe both statements a
 * downgrade issues.
 */
const createResolvedWrite = (rows: Record<string, unknown>[]) =>
  Object.assign(Promise.resolve(rows), { returning: () => Promise.resolve(rows) });

const createDatabase = (
  rows: Record<string, unknown>[],
  updates: RecordedUpdate[],
): BunSQLDatabase => ({
  select: () => createSelectChain(rows),
  update: () => ({
    set: (values: RecordedUpdate) => {
      updates.push(values);
      return { where: () => createResolvedWrite(rows) };
    },
  }),
}) as unknown as BunSQLDatabase;

const activeMappingRow = {
  calendarType: "google",
  capabilities: ["pull", "push"],
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  ingestLastSucceededAt: new Date(),
  sourceCalendarId: SOURCE_CALENDAR_ID,
  writeBackMode: "edits",
  writeBackState: "ok",
};

describe("write-back is refused at consumption when the plan does not carry it", () => {
  it("returns no policy and quarantines the pair for a downgraded account", async () => {
    const updates: RecordedUpdate[] = [];

    const policies = await resolveWriteBackPolicies(
      createDatabase([activeMappingRow], updates),
      DESTINATION_CALENDAR_ID,
      "free",
    );

    expect(policies.size).toBe(0);
    expect(updates[0]).toEqual({
      deleteConfirmationApprovedAt: null,
      writeBackState: "quarantined",
      writeBackStateReason: "plan_downgraded",
    });
  });

  /*
   * A recorded observation belongs to the policy it was taken under. Leaving it behind on
   * a downgrade means a pair that is later restored to Pro compares what it finds against
   * an observation from before the pause.
   */
  it("drops the observation recorded under the policy it just revoked", async () => {
    const updates: RecordedUpdate[] = [];

    await resolveWriteBackPolicies(
      createDatabase([activeMappingRow], updates),
      DESTINATION_CALENDAR_ID,
      "free",
    );

    expect(updates[1]).toMatchObject(WRITE_BACK_WITNESS_RESET);
  });

  it("reads the stored policy and quarantines nothing for a Pro account", async () => {
    const updates: RecordedUpdate[] = [];

    const policies = await resolveWriteBackPolicies(
      createDatabase([activeMappingRow], updates),
      DESTINATION_CALENDAR_ID,
      "pro",
    );

    expect(policies.get(SOURCE_CALENDAR_ID)).toMatchObject({
      paused: false,
      writeBackMode: "edits",
    });
    expect(updates).toEqual([]);
  });

  it("leaves a downgraded account with nothing the applier would act on", async () => {
    const policies = await resolveWriteBackPolicies(
      createDatabase([activeMappingRow], []),
      DESTINATION_CALENDAR_ID,
      "free",
    );

    expect([...policies.values()].filter((policy) => policy.writeBackMode !== "off")).toEqual([]);
  });
});
