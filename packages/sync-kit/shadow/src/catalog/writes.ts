import type { WriteIntent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { Plan, PlannedWrite, SourceIdentity } from "@keeper.sh/sync-reconcile";
import { calendarKeyString, sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import type { TranslationUnit } from "../translate/unit";
import type { CreationEntry, ReplacementEntry, UpdateEntry } from "./entries";
import { signatureOf } from "./order";
import { recurrenceIdentityOf, timeOfContent } from "./recurrence";

interface WritesRequest {
  readonly unit: TranslationUnit;
  readonly plan: Plan;
}

const creationOf = (
  intent: Extract<WriteIntent, { kind: "create" }>,
  identity: SourceIdentity,
  unit: TranslationUnit,
): CreationEntry => {
  const identityKey = sourceIdentityKey(identity);
  return {
    identityKey,
    uid: identity.uid,
    recurrence: recurrenceIdentityOf(identity),
    idempotencyKey: intent.idempotencyKey,
    time: timeOfContent(intent.content.content),
    sourceCalendar: unit.sourceCalendar,
    signature: signatureOf([
      calendarKeyString(unit.sourceCalendar),
      identityKey,
      "create",
      intent.idempotencyKey.value,
    ]),
  };
};

const updateOf = (
  intent: Extract<WriteIntent, { kind: "update" }>,
  identity: SourceIdentity,
  unit: TranslationUnit,
): UpdateEntry => {
  const identityKey = sourceIdentityKey(identity);
  return {
    identityKey,
    uid: identity.uid,
    recurrence: recurrenceIdentityOf(identity),
    target: intent.target,
    preconditionKind: intent.precondition.kind,
    time: timeOfContent(intent.content.content),
    sourceCalendar: unit.sourceCalendar,
    signature: signatureOf([
      calendarKeyString(unit.sourceCalendar),
      identityKey,
      "update",
      intent.target.value,
    ]),
  };
};

const replacementOf = (
  write: Extract<PlannedWrite, { kind: "replace" }>,
  unit: TranslationUnit,
): ReplacementEntry => {
  const identityKey = sourceIdentityKey(write.identity);
  return {
    identityKey,
    uid: write.identity.uid,
    recurrence: recurrenceIdentityOf(write.identity),
    retireHandle: write.retire.target,
    recreateIdempotencyKey: write.recreate.idempotencyKey,
    sourceCalendar: unit.sourceCalendar,
    signature: signatureOf([
      calendarKeyString(unit.sourceCalendar),
      identityKey,
      "replace",
      write.retire.target.value,
    ]),
  };
};

const creationsOf = (request: WritesRequest): readonly CreationEntry[] =>
  request.plan.writes.flatMap((write): readonly CreationEntry[] => {
    if (write.kind !== "single" || write.intent.kind !== "create") {
      return [];
    }
    return [creationOf(write.intent, write.identity, request.unit)];
  });

const updatesOf = (request: WritesRequest): readonly UpdateEntry[] =>
  request.plan.writes.flatMap((write): readonly UpdateEntry[] => {
    if (write.kind !== "single" || write.intent.kind !== "update") {
      return [];
    }
    return [updateOf(write.intent, write.identity, request.unit)];
  });

const replacementsOf = (request: WritesRequest): readonly ReplacementEntry[] =>
  request.plan.writes.flatMap((write): readonly ReplacementEntry[] => {
    switch (write.kind) {
      case "single": {
        return [];
      }
      case "replace": {
        return [replacementOf(write, request.unit)];
      }
      default: {
        return assertNever(write);
      }
    }
  });

export { creationsOf, replacementsOf, updatesOf };
export type { WritesRequest };
