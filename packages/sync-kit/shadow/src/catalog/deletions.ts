import type { DeleteReason, RetireReason, WriteIntent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type {
  Plan,
  PlannedWrite,
  SourceIdentity,
  Tombstone,
  TombstoneCause,
} from "@keeper.sh/sync-reconcile";
import { calendarKeyString, sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import type { TranslationUnit } from "../translate/unit";
import type { DeletionEntry, DeletionOrigin, ForgottenRowEntry } from "./entries";
import { indexesOf, removedTimeOf, resolvedMirrorOf } from "./resolution";
import type { UnitIndexes } from "./resolution";
import { signatureOf } from "./order";
import { recurrenceIdentityOf } from "./recurrence";

interface DeletionsRequest {
  readonly unit: TranslationUnit;
  readonly plan: Plan;
}

interface DeletionDraft {
  readonly origin: DeletionOrigin;
  readonly cause: TombstoneCause;
  readonly identity: SourceIdentity;
}

const causeOfDeleteReason = (reason: DeleteReason): TombstoneCause => {
  switch (reason) {
    case "sourceDeleted": {
      return "explicitRemoval";
    }
    case "sourceUnmapped": {
      return "absentFromSnapshot";
    }
    default: {
      return assertNever(reason);
    }
  }
};

const causeOfRetireReason = (reason: RetireReason): TombstoneCause => {
  switch (reason) {
    case "outsideWindow": {
      return "outsideMirrorWindow";
    }
    case "destinationDisconnected": {
      return "destinationDisconnected";
    }
    default: {
      return assertNever(reason);
    }
  }
};

const draftOfIntent = (
  intent: WriteIntent,
  identity: SourceIdentity,
  origin: DeletionOrigin,
): readonly DeletionDraft[] => {
  switch (intent.kind) {
    case "create":
    case "update": {
      return [];
    }
    case "delete": {
      return [{ origin, cause: causeOfDeleteReason(intent.reason), identity }];
    }
    case "retire": {
      return [{ origin, cause: causeOfRetireReason(intent.reason), identity }];
    }
    default: {
      return assertNever(intent);
    }
  }
};

const draftsOfWrite = (write: PlannedWrite): readonly DeletionDraft[] => {
  switch (write.kind) {
    case "single": {
      return draftOfIntent(write.intent, write.identity, "tombstone");
    }
    case "replace": {
      return draftOfIntent(write.retire, write.identity, "replaceRetire");
    }
    default: {
      return assertNever(write);
    }
  }
};

const draftsOfTombstone = (tombstone: Tombstone): readonly DeletionDraft[] => {
  switch (tombstone.kind) {
    case "retireMirror": {
      return [{ origin: "tombstone", cause: tombstone.cause, identity: tombstone.identity }];
    }
    case "forgetKnownRow": {
      return [];
    }
    default: {
      return assertNever(tombstone);
    }
  }
};

const entryOfDraft = (
  draft: DeletionDraft,
  unit: TranslationUnit,
  indexes: UnitIndexes,
  licensedBy: Plan["coverage"]["kind"],
): DeletionEntry => {
  const mirror = resolvedMirrorOf(draft.identity, indexes);
  const identityKey = sourceIdentityKey(draft.identity);
  return {
    origin: draft.origin,
    cause: draft.cause,
    identityKey,
    uid: draft.identity.uid,
    recurrence: recurrenceIdentityOf(draft.identity),
    remoteEventId: mirror.remoteEventId,
    deleteHandle: mirror.deleteHandle,
    handleSource: mirror.handleSource,
    time: removedTimeOf(draft.identity, indexes),
    sourceCalendar: unit.sourceCalendar,
    destinationCalendar: unit.policy.destination.key,
    preconditionKind: mirror.precondition.kind,
    licensedBy,
    signature: signatureOf([
      calendarKeyString(unit.sourceCalendar),
      identityKey,
      draft.origin,
      draft.cause,
      mirror.remoteEventId.value,
      mirror.deleteHandle.value,
    ]),
  };
};

const deletionsOf = (request: DeletionsRequest): readonly DeletionEntry[] => {
  const indexes = indexesOf(request.unit);
  const drafts = [
    ...request.plan.tombstones.flatMap((tombstone) => draftsOfTombstone(tombstone)),
    ...request.plan.writes.flatMap((write) => draftsOfWrite(write)),
  ];
  return drafts.map((draft) =>
    entryOfDraft(draft, request.unit, indexes, request.plan.coverage.kind),
  );
};

const forgottenRowsOf = (request: DeletionsRequest): readonly ForgottenRowEntry[] =>
  request.plan.tombstones.flatMap((tombstone): readonly ForgottenRowEntry[] => {
    if (tombstone.kind !== "forgetKnownRow") {
      return [];
    }
    return [
      {
        identityKey: sourceIdentityKey(tombstone.identity),
        uid: tombstone.identity.uid,
        cause: tombstone.cause,
        sourceCalendar: request.unit.sourceCalendar,
      },
    ];
  });

export { deletionsOf, forgottenRowsOf };
export type { DeletionsRequest };
