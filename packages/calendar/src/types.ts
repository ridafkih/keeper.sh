interface EventTimeSlot {
  uid: string;
  startTime: Date;
  endTime: Date;
}

type StoredEventTimeSlot = EventTimeSlot & {
  id: string;
};

interface EventDiff {
  toAdd: EventTimeSlot[];
  toRemove: StoredEventTimeSlot[];
}

interface SerializedIcsCalendar {
  version: string;
  events?: {
    uid?: string;
    start: { date: string };
    end?: { date: string };
    duration?: {
      weeks?: number;
      days?: number;
      hours?: number;
      minutes?: number;
      seconds?: number;
    };
  }[];
}

export type { EventTimeSlot, StoredEventTimeSlot, EventDiff, SerializedIcsCalendar };
