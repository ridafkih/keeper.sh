import type { Instant, OperationName, ProviderFailure } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { TransportBehaviour, TransportStub } from "./options";

class TransportRejection extends Error {
  readonly failure: ProviderFailure;

  constructor(failure: ProviderFailure) {
    super(`the injected transport answered with "${failure.kind}"`);
    this.name = "TransportRejection";
    this.failure = failure;
  }
}

class TransportStatus extends Error {
  readonly status: number;
  readonly retryAfter: Instant | null;

  constructor(status: number, retryAfter: Instant | null) {
    super(`the injected transport answered HTTP ${status}`);
    this.name = "TransportStatus";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

class TransportThrew extends Error {
  constructor(operation: OperationName) {
    super(`the injected transport threw out of "${operation}"`);
    this.name = "TransportThrew";
  }
}

const remainingBehaviour = (behaviour: TransportBehaviour): TransportBehaviour => {
  if (behaviour.kind === "reject" && behaviour.times > 1) {
    return { ...behaviour, times: behaviour.times - 1 };
  }
  if (behaviour.kind === "throw" && behaviour.times > 1) {
    return { ...behaviour, times: behaviour.times - 1 };
  }
  if (behaviour.kind === "status" && behaviour.times > 1) {
    return { ...behaviour, times: behaviour.times - 1 };
  }
  if (behaviour.kind === "stall") {
    return behaviour;
  }
  return { kind: "pass" };
};

interface TransportStubState {
  behaviour: TransportBehaviour;
  calls: number;
  inFlight: number;
  peak: number;
}

const createTransportStub = (): TransportStub => {
  const state: TransportStubState = {
    behaviour: { kind: "pass" },
    calls: 0,
    inFlight: 0,
    peak: 0,
  };

  const track = async <Value>(execute: () => Promise<Value>): Promise<Value> => {
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    try {
      return await execute();
    } finally {
      state.inFlight -= 1;
    }
  };

  const run = <Value>(operation: OperationName, execute: () => Promise<Value>): Promise<Value> => {
    state.calls += 1;
    const current = state.behaviour;
    state.behaviour = remainingBehaviour(current);
    switch (current.kind) {
      case "pass": {
        return track(execute);
      }
      case "stall": {
        return Promise.withResolvers<Value>().promise;
      }
      case "reject": {
        return Promise.reject(new TransportRejection(current.failure));
      }
      case "status": {
        return Promise.reject(new TransportStatus(current.status, current.retryAfter));
      }
      case "throw": {
        throw new TransportThrew(operation);
      }
      default: {
        return assertNever(current);
      }
    }
  };

  return {
    run,
    callCount: () => state.calls,
    inFlightPeak: () => state.peak,
    stall: () => {
      state.behaviour = { kind: "stall" };
    },
    resume: () => {
      state.behaviour = { kind: "pass" };
    },
    answerWith: (next: TransportBehaviour) => {
      state.behaviour = next;
    },
  };
};

const failureOfTransportError = (error: unknown): ProviderFailure => {
  if (error instanceof TransportRejection) {
    return error.failure;
  }
  return { kind: "transport", status: null, disposition: "permanent" };
};

export {
  createTransportStub,
  failureOfTransportError,
  TransportRejection,
  TransportStatus,
  TransportThrew,
};
