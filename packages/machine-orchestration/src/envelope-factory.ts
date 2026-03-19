import type { EventActor, EventEnvelope } from "@keeper.sh/state-machines";

interface EnvelopeFactory {
  createEnvelope: <TEvent>(event: TEvent, actor: EventActor) => EventEnvelope<TEvent>;
}

export type { EnvelopeFactory };
