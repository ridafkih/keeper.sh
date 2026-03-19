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

interface EventEnvelopeOptions {
  causationId?: string;
  correlationId?: string;
  id?: string;
  occurredAt?: string;
}

const createEventEnvelope = <TEvent>(
  event: TEvent,
  actor: EventActor,
  options?: EventEnvelopeOptions,
): EventEnvelope<TEvent> => ({
  id: options?.id ?? crypto.randomUUID(),
  event,
  actor,
  occurredAt: options?.occurredAt ?? new Date().toISOString(),
  ...(options?.causationId && { causationId: options.causationId }),
  ...(options?.correlationId && { correlationId: options.correlationId }),
});

export { createEventEnvelope };
export type { EventActor, EventEnvelope, EventEnvelopeOptions };
