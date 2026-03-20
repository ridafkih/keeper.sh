interface RuntimeEnvelopeLike {
  id: string;
  event: { type: string };
}

interface RuntimeTransitionLike {
  commands: { type: string }[];
  outputs: { type: string }[];
}

interface RuntimeProcessEventLike {
  aggregateId: string;
  outcome: "APPLIED" | "DUPLICATE_IGNORED" | "CONFLICT_DETECTED";
  envelope: RuntimeEnvelopeLike;
  snapshot: { state: string };
  transition?: RuntimeTransitionLike;
  version: number;
}

type MachineRuntimeWidelogSetField = (field: string, value: string | number) => void;

const createMachineRuntimeWidelogSink = (
  machine: string,
  setField: MachineRuntimeWidelogSetField,
) => {
  let processedTotal = 0;
  let duplicateTotal = 0;
  let conflictTotal = 0;
  let commandsTotal = 0;
  let outputsTotal = 0;

  return (event: RuntimeProcessEventLike): void => {
    processedTotal += 1;
    if (event.outcome === "DUPLICATE_IGNORED") {
      duplicateTotal += 1;
    }
    if (event.outcome === "CONFLICT_DETECTED") {
      conflictTotal += 1;
    }
    commandsTotal += event.transition?.commands.length ?? 0;
    outputsTotal += event.transition?.outputs.length ?? 0;

    setField(`machine.${machine}.processed_total`, processedTotal);
    setField(`machine.${machine}.duplicate_total`, duplicateTotal);
    setField(`machine.${machine}.conflict_total`, conflictTotal);
    setField(`machine.${machine}.commands_total`, commandsTotal);
    setField(`machine.${machine}.outputs_total`, outputsTotal);
    setField(`machine.${machine}.last_envelope_id`, event.envelope.id);
    setField(`machine.${machine}.last_event_type`, event.envelope.event.type);
    setField(`machine.${machine}.last_state`, event.snapshot.state);
    setField(`machine.${machine}.last_version`, event.version);
    setField(`machine.${machine}.aggregate_id`, event.aggregateId);
  };
};

export { createMachineRuntimeWidelogSink };
export type { MachineRuntimeWidelogSetField };
