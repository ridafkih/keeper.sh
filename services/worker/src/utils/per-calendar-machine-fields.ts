import { createMachineRuntimeWidelogSink } from "./machine-runtime-widelog";

type MachineName = "destination_execution" | "credential_health";
type MachineFieldValue = string | number;

interface RuntimeProcessEventLike {
  aggregateId: string;
  duplicate: boolean;
  envelope: { id: string; event: { type: string } };
  snapshot: { state: string };
  transition?: { commands: { type: string }[]; outputs: { type: string }[] };
  version: number;
}

interface PerCalendarMachineFieldCollector {
  pushEvent: (
    machine: MachineName,
    calendarId: string,
    event: RuntimeProcessEventLike,
  ) => void;
  consumeCalendarFields: (calendarId: string) => Map<string, MachineFieldValue>;
}

const getSinkKey = (machine: MachineName, calendarId: string): string =>
  `${machine}:${calendarId}`;

const createPerCalendarMachineFieldCollector = (): PerCalendarMachineFieldCollector => {
  const machineFieldsByCalendar = new Map<string, Map<string, MachineFieldValue>>();
  const sinks = new Map<string, (event: RuntimeProcessEventLike) => void>();

  const getOrCreateSink = (
    machine: MachineName,
    calendarId: string,
  ): ((event: RuntimeProcessEventLike) => void) => {
    const sinkKey = getSinkKey(machine, calendarId);
    const existing = sinks.get(sinkKey);
    if (existing) {
      return existing;
    }

    const created = createMachineRuntimeWidelogSink(machine, (field, value) => {
      const fields = machineFieldsByCalendar.get(calendarId) ?? new Map<string, MachineFieldValue>();
      fields.set(field, value);
      machineFieldsByCalendar.set(calendarId, fields);
    });
    sinks.set(sinkKey, created);
    return created;
  };

  const pushEvent = (
    machine: MachineName,
    calendarId: string,
    event: RuntimeProcessEventLike,
  ): void => {
    const sink = getOrCreateSink(machine, calendarId);
    sink(event);
  };

  const consumeCalendarFields = (calendarId: string): Map<string, MachineFieldValue> => {
    const fields = machineFieldsByCalendar.get(calendarId) ?? new Map<string, MachineFieldValue>();
    machineFieldsByCalendar.delete(calendarId);
    sinks.delete(getSinkKey("destination_execution", calendarId));
    sinks.delete(getSinkKey("credential_health", calendarId));
    return fields;
  };

  return {
    consumeCalendarFields,
    pushEvent,
  };
};

export { createPerCalendarMachineFieldCollector };
export type { MachineName, PerCalendarMachineFieldCollector, RuntimeProcessEventLike };
