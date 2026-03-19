import {
  createEventEnvelope,
  SourceDiffReconciliationCommandType,
  SourceDiffReconciliationEventType,
  SourceDiffReconciliationStateMachine,
} from "@keeper.sh/state-machines";
import type {
  EventActor,
  EventEnvelopeMetadata,
  SourceDiffReconciliationEvent,
  SourceDiffReconciliationSnapshot,
  SourceDiffReconciliationTransitionResult,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type { SourceEvent } from "../types";
import {
  buildSourceEventStateIdsToRemove,
  buildSourceEventsToAdd,
  type ExistingSourceEventState,
} from "./event-diff";
import { splitSourceEventsByStorageIdentity } from "./sync-diagnostics";

interface SourceDiffReconciliationFetchResult {
  events: SourceEvent[];
  isDeltaSync: boolean;
  cancelledEventUids: string[];
}

interface SourceDiffReconciliationPlan {
  eventsToInsert: SourceEvent[];
  eventsToUpdate: SourceEvent[];
  eventStateIdsToRemove: string[];
  addedCount: number;
  updatedCount: number;
  removedCount: number;
}

interface SourceDiffReconciliationRuntimeEnvelope extends EventEnvelopeMetadata {
  actor: EventActor;
}

interface SourceDiffReconciliationRuntimeInput {
  sourceId: string;
  transitionPolicy: TransitionPolicy;
  readExistingEvents: () => Promise<ExistingSourceEventState[]>;
  fetchEvents: () => Promise<SourceDiffReconciliationFetchResult>;
  applyDiff: (plan: SourceDiffReconciliationPlan) => Promise<void>;
  isRetryableError: (error: unknown) => boolean;
  resolveErrorCode: (error: unknown) => string;
}

interface SourceDiffReconciliationRuntime {
  reconcile: (
    envelope: SourceDiffReconciliationRuntimeEnvelope,
  ) => Promise<SourceDiffReconciliationTransitionResult>;
  dispatchEvent: (
    event: SourceDiffReconciliationEvent,
    envelope: SourceDiffReconciliationRuntimeEnvelope,
  ) => SourceDiffReconciliationTransitionResult;
  getSnapshot: () => SourceDiffReconciliationSnapshot;
}

const noopTransitionFromSnapshot = (
  snapshot: SourceDiffReconciliationSnapshot,
): SourceDiffReconciliationTransitionResult => ({
  commands: [],
  context: snapshot.context,
  outputs: [],
  state: snapshot.state,
});

const hasCommand = (
  transition: SourceDiffReconciliationTransitionResult,
  commandType: (typeof SourceDiffReconciliationCommandType)[keyof typeof SourceDiffReconciliationCommandType],
): boolean => transition.commands.some((command) => command.type === commandType);

const createPlan = (
  existingEvents: ExistingSourceEventState[],
  fetchResult: SourceDiffReconciliationFetchResult,
): SourceDiffReconciliationPlan => {
  const eventsToAdd = buildSourceEventsToAdd(existingEvents, fetchResult.events, {
    isDeltaSync: fetchResult.isDeltaSync,
  });
  const { eventsToInsert, eventsToUpdate } = splitSourceEventsByStorageIdentity(
    existingEvents,
    eventsToAdd,
  );
  const eventStateIdsToRemove = buildSourceEventStateIdsToRemove(existingEvents, fetchResult.events, {
    cancelledEventUids: fetchResult.cancelledEventUids,
    isDeltaSync: fetchResult.isDeltaSync,
  });

  return {
    addedCount: eventsToInsert.length,
    eventsToInsert,
    eventStateIdsToRemove,
    eventsToUpdate,
    removedCount: eventStateIdsToRemove.length,
    updatedCount: eventsToUpdate.length,
  };
};

const createChildEnvelope = (
  parent: SourceDiffReconciliationRuntimeEnvelope,
  suffix: string,
  actor: EventActor,
): SourceDiffReconciliationRuntimeEnvelope => ({
  id: `${parent.id}:${suffix}`,
  occurredAt: parent.occurredAt,
  actor,
  ...(parent.causationId && { causationId: parent.causationId }),
  ...(parent.correlationId && { correlationId: parent.correlationId }),
});

const createSourceDiffReconciliationRuntime = (
  input: SourceDiffReconciliationRuntimeInput,
): SourceDiffReconciliationRuntime => {
  const machine = new SourceDiffReconciliationStateMachine(
    { sourceId: input.sourceId },
    { transitionPolicy: input.transitionPolicy },
  );
  const processedEnvelopeIds = new Set<string>();

  const dispatchEvent = (
    event: SourceDiffReconciliationEvent,
    envelope: SourceDiffReconciliationRuntimeEnvelope,
  ): SourceDiffReconciliationTransitionResult =>
    machine.dispatch(
      createEventEnvelope(event, envelope.actor, {
        id: envelope.id,
        occurredAt: envelope.occurredAt,
        ...(envelope.causationId && { causationId: envelope.causationId }),
        ...(envelope.correlationId && { correlationId: envelope.correlationId }),
      }),
    );

  const reconcile = async (
    envelope: SourceDiffReconciliationRuntimeEnvelope,
  ): Promise<SourceDiffReconciliationTransitionResult> => {
    if (processedEnvelopeIds.has(envelope.id)) {
      return noopTransitionFromSnapshot(machine.getSnapshot());
    }

    processedEnvelopeIds.add(envelope.id);

    const requested = dispatchEvent(
      { type: SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED },
      envelope,
    );

    if (!hasCommand(requested, SourceDiffReconciliationCommandType.COMPUTE_DIFF)) {
      throw new Error("Invariant violated: reconciliation request must emit COMPUTE_DIFF");
    }

    const [existingEvents, fetchResult] = await Promise.all([
      input.readExistingEvents(),
      input.fetchEvents(),
    ]);

    const plan = createPlan(existingEvents, fetchResult);

    const diffTransition = dispatchEvent(
      {
        type: SourceDiffReconciliationEventType.DIFF_COMPUTED,
        addedCount: plan.addedCount,
        removedCount: plan.removedCount,
        updatedCount: plan.updatedCount,
      },
      createChildEnvelope(envelope, "diff-computed", envelope.actor),
    );

    if (diffTransition.state === "completed") {
      return diffTransition;
    }

    if (!hasCommand(diffTransition, SourceDiffReconciliationCommandType.APPLY_DIFF)) {
      throw new Error("Invariant violated: non-terminal diff must emit APPLY_DIFF");
    }

    dispatchEvent(
      { type: SourceDiffReconciliationEventType.APPLY_STARTED },
      createChildEnvelope(envelope, "apply-started", envelope.actor),
    );

    try {
      await input.applyDiff(plan);
    } catch (error) {
      const errorCode = input.resolveErrorCode(error);
      if (input.isRetryableError(error)) {
        dispatchEvent(
          { type: SourceDiffReconciliationEventType.APPLY_RETRYABLE_FAILED, code: errorCode },
          createChildEnvelope(envelope, "apply-retryable-failed", envelope.actor),
        );
        throw error;
      }

      dispatchEvent(
        { type: SourceDiffReconciliationEventType.APPLY_FATAL_FAILED, code: errorCode },
        createChildEnvelope(envelope, "apply-fatal-failed", envelope.actor),
      );
      throw error;
    }

    return dispatchEvent(
      { type: SourceDiffReconciliationEventType.APPLY_SUCCEEDED },
      createChildEnvelope(envelope, "apply-succeeded", envelope.actor),
    );
  };

  return {
    dispatchEvent,
    getSnapshot: () => machine.getSnapshot(),
    reconcile,
  };
};

export { createSourceDiffReconciliationRuntime };
export type {
  SourceDiffReconciliationFetchResult,
  SourceDiffReconciliationPlan,
  SourceDiffReconciliationRuntime,
  SourceDiffReconciliationRuntimeEnvelope,
  SourceDiffReconciliationRuntimeInput,
};
