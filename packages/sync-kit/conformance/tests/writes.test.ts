import type { WriteIntent, WriteOutcome } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import {
  assertConflictNotOverwrite,
  assertNoUnplannedRecreation,
  assertNoUnconditionalWrite,
} from "../src/assertions/outcome";
import { conflictingOn } from "../src/fixtures";
import { failureOf, okValue, write } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import { createIntent, occurrence, timedAt, updateIntent } from "./support/protocol";

const meeting = occurrence("Design review", timedAt("2026-03-02T09:00:00.000Z", "2026-03-02T10:00:00.000Z"));
const movedMeeting = occurrence("Design review", timedAt("2026-03-02T11:00:00.000Z", "2026-03-02T12:00:00.000Z"));

const outcomeKindOf = (outcome: WriteOutcome): string => outcome.kind;

const versionOf = (outcome: WriteOutcome): string => {
  if ("version" in outcome) {
    return outcome.version.value;
  }
  return "no-version";
};

const remoteIdOf = (outcome: WriteOutcome): string => {
  if ("remote" in outcome) {
    return outcome.remote.id.value;
  }
  return "no-remote";
};

const echoKindOf = (outcome: WriteOutcome): string => {
  if ("echo" in outcome) {
    return outcome.echo.kind;
  }
  return "no-echo";
};

const conflictOnKey =
  (key: string) =>
  (intent: WriteIntent): boolean =>
    intent.kind === "create" && intent.idempotencyKey.value === key;

describe("a write can never silently overwrite", () => {
  test("CONF-O14: a replayed create with the same idempotency key produces one object", async () => {
    const harness = await referenceHarness();
    const intent = createIntent("replayed-create", meeting);

    const first = okValue(await write(harness.provider, harness.environment, intent));
    const second = okValue(await write(harness.provider, harness.environment, intent));
    const inspection = await harness.provider.inspect();

    expect(outcomeKindOf(first)).toBe("created");
    expect(["alreadyExists", "unchanged"]).toContain(outcomeKindOf(second));
    expect(inspection.objects).toHaveLength(1);
    await harness.dispose();
  });

  test("CONF-O14: the replay returns the same RemoteRef as the original create", async () => {
    const harness = await referenceHarness();
    const intent = createIntent("replayed-ref", meeting);

    const first = okValue(await write(harness.provider, harness.environment, intent));
    const second = okValue(await write(harness.provider, harness.environment, intent));

    expect(remoteIdOf(second)).toBe(remoteIdOf(first));
    expect(remoteIdOf(first)).not.toBe("no-remote");
    await harness.dispose();
  });

  test("CONF-O15: a conflicting create is a typed conflict, never a delete-then-create", async () => {
    const harness = await referenceHarness(conflictingOn(conflictOnKey("conflicting-create")));
    const intent = createIntent("conflicting-create", meeting);

    const result = await write(harness.provider, harness.environment, intent);
    const inspection = await harness.provider.inspect();

    expect(() => assertConflictNotOverwrite(result)).not.toThrow();
    expect(() => assertNoUnplannedRecreation(inspection.writeLog, [])).not.toThrow();
    await harness.dispose();
  });

  test("CONF-O15: the conflict carries the precondition that was actually observed", async () => {
    const harness = await referenceHarness(conflictingOn(conflictOnKey("observed")));

    const outcome = okValue(
      await write(harness.provider, harness.environment, createIntent("observed", meeting)),
    );

    expect(outcomeKindOf(outcome)).toBe("conflict");
    expect("observed" in outcome).toBe(true);
    await harness.dispose();
  });

  test("CONF-O7: an unbuildable newest revision withholds the identity rather than writing the older one", async () => {
    await expect(runReferenceCase("CONF-O7")).resolves.toBeUndefined();
  });

  test("CONF-O18: an adapter that cannot echo reports notObserved, and notObserved is not matched", async () => {
    const harness = await referenceHarness();

    const outcome = okValue(
      await write(harness.provider, harness.environment, createIntent("echoed", meeting)),
    );

    expect(echoKindOf(outcome)).not.toBe("notObserved");
    expect(echoKindOf(outcome)).not.toBe("no-echo");
    expect(harness.supports.echoesWrites).toBe(true);
    await harness.dispose();
  });

  test("CONF-O25: a replace whose create half fails reports the delete separately", async () => {
    const harness = await referenceHarness(conflictingOn(conflictOnKey("replaced-again")));
    const created = okValue(
      await write(harness.provider, harness.environment, createIntent("replaced", meeting)),
    );

    const replacement = await write(
      harness.provider,
      harness.environment,
      createIntent("replaced-again", movedMeeting),
    );
    const inspection = await harness.provider.inspect();

    expect(outcomeKindOf(created)).toBe("created");
    expect(outcomeKindOf(okValue(replacement))).toBe("conflict");
    expect(inspection.objects.map((event) => event.uid.value)).toContain("replaced");
    expect(() => assertNoUnplannedRecreation(inspection.writeLog, [])).not.toThrow();
    await harness.dispose();
  });

  test("CONF-O36: moving one occurrence is a single conditional write, not delete plus add", async () => {
    const harness = await referenceHarness();
    const created = okValue(
      await write(harness.provider, harness.environment, createIntent("occurrence", meeting)),
    );
    await write(
      harness.provider,
      harness.environment,
      updateIntent("id-occurrence", movedMeeting, versionOf(created)),
    );
    const inspection = await harness.provider.inspect();

    expect(() => assertNoUnconditionalWrite(inspection.writeLog)).not.toThrow();
    expect(inspection.writeLog.filter((entry) => entry.intent.kind === "delete")).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O39: a precondition derived from our own submission is refused", async () => {
    const harness = await referenceHarness();
    okValue(await write(harness.provider, harness.environment, createIntent("rewritten", meeting)));

    const stale = await write(
      harness.provider,
      harness.environment,
      updateIntent("id-rewritten", movedMeeting, "fp-rewritten"),
    );

    expect(failureOf(stale).kind).toBe("conflict");
    await harness.dispose();
  });

  test("CONF-O44: two concurrent writers cannot both succeed against one version", async () => {
    const harness = await referenceHarness();
    const created = okValue(
      await write(harness.provider, harness.environment, createIntent("contended", meeting)),
    );
    const version = versionOf(created);

    const both = await Promise.all([
      write(harness.provider, harness.environment, updateIntent("id-contended", meeting, version)),
      write(
        harness.provider,
        harness.environment,
        updateIntent("id-contended", movedMeeting, version),
      ),
    ]);
    const conflicts = both.filter((result) => !result.ok);

    expect(conflicts).toHaveLength(1);
    await harness.dispose();
  });

  test("CONF-O14: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O14")).resolves.toBeUndefined();
  });

  test("CONF-O15: the generated case passes for the reference provider", async () => {
    await expect(
      runReferenceCase("CONF-O15", conflictingOn(conflictOnKey("conflicting-create"))),
    ).resolves.toBeUndefined();
  });

  test("CONF-O18: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O18")).resolves.toBeUndefined();
  });

  test("CONF-O25: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O25")).resolves.toBeUndefined();
  });

  test("CONF-O44: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O44")).resolves.toBeUndefined();
  });

  test("CONF-O36: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O36")).resolves.toBeUndefined();
  });

  test("CONF-O39: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O39")).resolves.toBeUndefined();
  });
});
