import type { EventActor, EventEnvelope } from "@keeper.sh/state-machines";

interface SequencedRuntimeEnvelopeEvent {
  type: string;
}

interface CreateSequencedRuntimeEnvelopeFactoryInput {
  actor: EventActor;
  aggregateId: string;
  now: () => string;
}

const createSequencedRuntimeEnvelopeFactory = <
  TEvent extends SequencedRuntimeEnvelopeEvent,
>(
  input: CreateSequencedRuntimeEnvelopeFactoryInput,
): ((event: TEvent) => EventEnvelope<TEvent>) => {
  let sequence = 0;

  return (event) => {
    sequence += 1;
    return {
      actor: input.actor,
      event,
      id: `${input.aggregateId}:${sequence}:${event.type}`,
      occurredAt: input.now(),
    };
  };
};

export { createSequencedRuntimeEnvelopeFactory };
export type {
  CreateSequencedRuntimeEnvelopeFactoryInput,
  SequencedRuntimeEnvelopeEvent,
};
