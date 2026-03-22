import {
  SourceProvisioningStateMachine,
} from "@keeper.sh/state-machines";
import type {
  SourceProvisioningEvent,
  SourceProvisioningMode,
  SourceProvisioningProvider,
  SourceProvisioningSnapshot,
  SourceProvisioningTransitionResult,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import { createSequencedRuntimeEnvelopeFactory } from "./sequenced-runtime-envelope-factory";

interface CreateSourceProvisioningDispatcherInput {
  actorId: string;
  mode: SourceProvisioningMode;
  provider: SourceProvisioningProvider;
  requestId: string;
  transitionPolicy: TransitionPolicy;
  userId: string;
}

interface SourceProvisioningDispatcher {
  dispatch: (event: SourceProvisioningEvent) => SourceProvisioningTransitionResult;
  getSnapshot: () => SourceProvisioningSnapshot;
}

const createSourceProvisioningDispatcher = (
  input: CreateSourceProvisioningDispatcherInput,
): SourceProvisioningDispatcher => {
  const machine = new SourceProvisioningStateMachine(
    {
      mode: input.mode,
      provider: input.provider,
      requestId: input.requestId,
      userId: input.userId,
    },
    { transitionPolicy: input.transitionPolicy },
  );
  const createEnvelope = createSequencedRuntimeEnvelopeFactory({
    actor: { id: input.actorId, type: "system" },
    aggregateId: input.requestId,
    now: () => new Date().toISOString(),
  });

  return {
    dispatch: (event) => machine.dispatch(createEnvelope(event)),
    getSnapshot: () => machine.getSnapshot(),
  };
};

export { createSourceProvisioningDispatcher };
export type {
  CreateSourceProvisioningDispatcherInput,
  SourceProvisioningDispatcher,
};
