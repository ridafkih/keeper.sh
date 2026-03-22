import type { EventEnvelope, PushJobArbitrationEvent } from "@keeper.sh/state-machines";

interface CreatePushArbitrationEnvelopeFactoryInput {
  actorId: string;
  now: () => string;
}

const createPushArbitrationEnvelopeFactory = (
  input: CreatePushArbitrationEnvelopeFactoryInput,
): ((event: PushJobArbitrationEvent, jobId: string) => EventEnvelope<PushJobArbitrationEvent>) =>
  (event, jobId) => ({
    actor: { id: input.actorId, type: "system" },
    event,
    id: `${event.type}:${jobId}`,
    occurredAt: input.now(),
  });

export { createPushArbitrationEnvelopeFactory };
export type { CreatePushArbitrationEnvelopeFactoryInput };
