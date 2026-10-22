import type { Result, WriteIntent, WriteOutcome } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { WriteLogEntry } from "../options";
import { violated } from "../violation";

const overwritesTheRemoteCopy = (outcome: WriteOutcome): boolean => {
  switch (outcome.kind) {
    case "created":
    case "updated":
    case "deleted": {
      return true;
    }
    case "alreadyExists":
    case "unchanged":
    case "alreadyAbsent":
    case "conflict":
    case "unrepresentable":
    case "notAttempted": {
      return false;
    }
    default: {
      return assertNever(outcome);
    }
  }
};

const assertConflictNotOverwrite = (result: Result<WriteOutcome>): void => {
  if (!result.ok) {
    if (result.failure.kind === "conflict" || result.failure.kind === "unrepresentable") {
      return;
    }
    throw violated(
      "CONF-O15",
      `a conflicting write failed as "${result.failure.kind}" instead of a typed conflict`,
    );
  }
  if (overwritesTheRemoteCopy(result.value)) {
    throw violated(
      "CONF-O15",
      `a conflicting write answered "${result.value.kind}", which overwrote the differing remote copy`,
    );
  }
};

type RemovalIntent = Extract<WriteIntent, { kind: "delete" } | { kind: "retire" }>;

const isRemoval = (intent: WriteIntent): intent is RemovalIntent =>
  intent.kind === "delete" || intent.kind === "retire";

const removedTargetOf = (intent: WriteIntent): string | null => {
  if (!isRemoval(intent)) {
    return null;
  }
  return intent.target.value;
};

const assertNoUnplannedRecreation = (
  writeLog: readonly WriteLogEntry[],
  plannedRemovals: readonly string[],
): void => {
  const seen = { unplannedRemovals: 0 };
  for (const entry of writeLog) {
    const removed = removedTargetOf(entry.intent);
    if (removed !== null && !plannedRemovals.includes(removed)) {
      seen.unplannedRemovals += 1;
      continue;
    }
    if (entry.intent.kind === "create" && seen.unplannedRemovals > 0) {
      throw violated(
        "CONF-O25",
        "the write log carries a delete followed by a create, which is a blind recreation",
      );
    }
  }
};

const assertNoUnconditionalWrite = (writeLog: readonly WriteLogEntry[]): void => {
  for (const entry of writeLog) {
    if (entry.intent.kind === "create" && entry.intent.idempotencyKey.value.length === 0) {
      throw violated("CONF-O36", "a create was issued without an idempotency key");
    }
    if (entry.intent.kind === "create") {
      continue;
    }
    if (entry.intent.precondition.kind === "matchesVersion") {
      if (entry.intent.precondition.version.value.length === 0) {
        throw violated("CONF-O36", "a conditional write carried an empty version precondition");
      }
      continue;
    }
    if (entry.intent.precondition.fingerprint.value.length === 0) {
      throw violated("CONF-O36", "a conditional write carried an empty fingerprint precondition");
    }
  }
};

export {
  assertConflictNotOverwrite,
  assertNoUnconditionalWrite,
  assertNoUnplannedRecreation,
  overwritesTheRemoteCopy,
};
