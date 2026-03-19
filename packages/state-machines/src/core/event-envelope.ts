interface EventActor {
  type: "user" | "system" | "worker";
  id: string;
}

interface EventEnvelope<TEvent> {
  id: string;
  event: TEvent;
  actor: EventActor;
  occurredAt: string;
  causationId?: string;
  correlationId?: string;
}

interface EventEnvelopeMetadata {
  id: string;
  occurredAt: string;
  causationId?: string;
  correlationId?: string;
}

const createEventEnvelope = <TEvent>(
  event: TEvent,
  actor: EventActor,
  metadata: EventEnvelopeMetadata,
): EventEnvelope<TEvent> => ({
  id: metadata.id,
  event,
  actor,
  occurredAt: metadata.occurredAt,
  ...(metadata.causationId && { causationId: metadata.causationId }),
  ...(metadata.correlationId && { correlationId: metadata.correlationId }),
});

export { createEventEnvelope };
export type { EventActor, EventEnvelope, EventEnvelopeMetadata };
