import type { Capabilities, ProviderId } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { ConformanceCaseId } from "../case-id";
import { conformanceCaseIds } from "../case-id";
import type { CaseGate } from "./case";

type GateFactory = (supports: Capabilities) => CaseGate;

const branchOn = (capability: keyof Capabilities, branch: string): CaseGate => ({
  kind: "branch",
  capability,
  branch,
});

const deltaGate = (supports: Capabilities, boundBranch: string, freeBranch: string): CaseGate => {
  if (supports.delta.kind === "none") {
    return branchOn("delta", "noDelta");
  }
  if (supports.delta.windowBoundToCursor) {
    return branchOn("delta", boundBranch);
  }
  return branchOn("delta", freeBranch);
};

const ambiguityGate = (supports: Capabilities): CaseGate => {
  if (supports.removalsAreAmbiguous) {
    return branchOn("removalsAreAmbiguous", "ambiguous");
  }
  return branchOn("removalsAreAmbiguous", "unambiguous");
};

const echoGate = (supports: Capabilities): CaseGate => {
  if (supports.echoesWrites) {
    return branchOn("echoesWrites", "echoes");
  }
  return branchOn("echoesWrites", "blind");
};

const gateFactories = {
  "CONF-O3": (supports) => branchOn("deletionAuthority", supports.deletionAuthority),
  "CONF-O11": (supports) => deltaGate(supports, "windowBoundToCursor", "windowFreeCursor"),
  "CONF-O13": ambiguityGate,
  "CONF-O14": (supports) => branchOn("precondition", supports.precondition),
  "CONF-O16": (supports) => branchOn("provenanceChannel", supports.provenanceChannel),
  "CONF-O18": echoGate,
  "CONF-O26": (supports) => branchOn("deletionAuthority", supports.deletionAuthority),
  "CONF-O28": (supports) => branchOn("representableRange", supports.representableRange.zeroDuration),
  "CONF-O35": (supports) => branchOn("recurrenceWrite", supports.recurrenceWrite),
  "CONF-O38": (supports) => deltaGate(supports, "tokenizedDelta", "tokenizedDelta"),
  "CONF-O45": (supports) => branchOn("allDay", supports.allDay),
} as const satisfies Partial<Record<ConformanceCaseId, GateFactory>>;

const gatedCaseIds: readonly ConformanceCaseId[] = Object.keys(gateFactories).flatMap((key) => {
  const found = conformanceCaseIds.find((id) => id === key);
  if (!found) {
    return [];
  }
  return [found];
});

const factoryFor = (id: ConformanceCaseId): GateFactory | null => {
  const entry = Object.entries(gateFactories).find(([key]) => key === id);
  if (!entry) {
    return null;
  }
  return entry[1];
};

const gateFor = <Provider extends ProviderId>(
  id: ConformanceCaseId,
  supports: Capabilities<Provider>,
): CaseGate => {
  const factory = factoryFor(id);
  if (factory === null) {
    return { kind: "ungated" };
  }
  return factory(supports);
};

const branchNameOf = (gate: CaseGate): string | null => {
  switch (gate.kind) {
    case "branch": {
      return gate.branch;
    }
    case "ungated": {
      return null;
    }
    default: {
      return assertNever(gate);
    }
  }
};

const ungatedCaseIdsOf = (): readonly ConformanceCaseId[] =>
  conformanceCaseIds.filter((id) => !gatedCaseIds.includes(id));

export { branchNameOf, gateFor, gatedCaseIds, ungatedCaseIdsOf };
