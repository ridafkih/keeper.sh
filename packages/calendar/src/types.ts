export type EventTimeSlot = {
  startTime: Date;
  endTime: Date;
};

export type StoredEventTimeSlot = EventTimeSlot & {
  id: string;
};

export type EventDiff = {
  toAdd: EventTimeSlot[];
  toRemove: StoredEventTimeSlot[];
};

/** JSON-serialized IcsCalendar where Date objects become ISO strings */
export type SerializedIcsCalendar = {
  version: string;
  events?: Array<{
    start: { date: string };
    end?: { date: string };
    duration?: {
      weeks?: number;
      days?: number;
      hours?: number;
      minutes?: number;
      seconds?: number;
    };
  }>;
};
