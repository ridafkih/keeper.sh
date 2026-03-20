import { describe, expect, it } from "bun:test";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import { mapSourceIngestionLifecycleDomainEvent } from "./source-ingestion-lifecycle-event-mapper";

describe("mapSourceIngestionLifecycleDomainEvent", () => {
  it("maps simple pass-through lifecycle events", () => {
    const event = mapSourceIngestionLifecycleDomainEvent({
      actorId: "worker-1",
      type: SourceIngestionLifecycleEventType.SOURCE_SELECTED,
    });

    expect(event).toEqual({
      type: SourceIngestionLifecycleEventType.SOURCE_SELECTED,
    });
  });

  it("maps ingest succeeded payload", () => {
    const event = mapSourceIngestionLifecycleDomainEvent({
      actorId: "worker-1",
      eventsAdded: 3,
      eventsRemoved: 1,
      nextSyncToken: "token-1",
      type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
    });

    expect(event).toEqual({
      eventsAdded: 3,
      eventsRemoved: 1,
      nextSyncToken: "token-1",
      type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
    });
  });

  it("maps failure lifecycle events with code", () => {
    const event = mapSourceIngestionLifecycleDomainEvent({
      actorId: "worker-1",
      code: "timeout",
      type: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
    });

    expect(event).toEqual({
      code: "timeout",
      type: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
    });
  });
});
