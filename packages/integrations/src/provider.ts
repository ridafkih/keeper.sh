import type {
  SyncableEvent,
  PushResult,
  DeleteResult,
  ProviderConfig,
} from "./types";
import { generateEventUid, isKeeperEvent } from "./event-identity";

export abstract class CalendarProvider {
  abstract readonly name: string;
  abstract readonly id: string;

  constructor(private readonly config: ProviderConfig) {}

  abstract pushEvents(events: SyncableEvent[]): Promise<PushResult[]>;
  abstract deleteEvents(eventIds: string[]): Promise<DeleteResult[]>;

  protected generateUid(event: SyncableEvent): string {
    return generateEventUid(this.config.userId, event);
  }

  protected isKeeperEvent(uid: string): boolean {
    return isKeeperEvent(uid);
  }
}
