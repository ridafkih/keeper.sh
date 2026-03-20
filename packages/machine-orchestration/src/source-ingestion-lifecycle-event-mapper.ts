import type { SourceIngestionLifecycleEvent } from "@keeper.sh/state-machines";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import type { SourceIngestionLifecycleDomainEvent } from "./source-ingestion-lifecycle-orchestrator";

const mapSourceIngestionLifecycleDomainEvent = (
  domainEvent: SourceIngestionLifecycleDomainEvent,
): SourceIngestionLifecycleEvent => {
  switch (domainEvent.type) {
    case SourceIngestionLifecycleEventType.INGEST_SUCCEEDED: {
      return {
        type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
        eventsAdded: domainEvent.eventsAdded,
        eventsRemoved: domainEvent.eventsRemoved,
        nextSyncToken: domainEvent.nextSyncToken,
      };
    }
    case SourceIngestionLifecycleEventType.AUTH_FAILURE:
    case SourceIngestionLifecycleEventType.NOT_FOUND:
    case SourceIngestionLifecycleEventType.TRANSIENT_FAILURE: {
      return {
        type: domainEvent.type,
        code: domainEvent.code,
      };
    }
    case SourceIngestionLifecycleEventType.SOURCE_SELECTED:
    case SourceIngestionLifecycleEventType.FETCHER_RESOLVED:
    case SourceIngestionLifecycleEventType.FETCH_SUCCEEDED: {
      return { type: domainEvent.type };
    }
    default: {
      throw new Error("Unhandled source ingestion lifecycle domain event");
    }
  }
};

export { mapSourceIngestionLifecycleDomainEvent };
