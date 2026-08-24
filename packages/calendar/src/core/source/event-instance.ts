interface SourceEventInstanceInput {
  endTime: Date;
  recurrenceId?: Date | null;
  startTime: Date;
  uid: string;
}

const buildSourceEventInstanceKey = (
  event: SourceEventInstanceInput,
): string => {
  if (event.recurrenceId) {
    return `recurrence|${event.uid}|${event.recurrenceId.toISOString()}`;
  }

  return [
    "slot",
    event.uid,
    event.startTime.toISOString(),
    event.endTime.toISOString(),
  ].join("|");
};

export { buildSourceEventInstanceKey };
export type { SourceEventInstanceInput };
