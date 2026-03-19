import { describe, expect, it } from "bun:test";
import { StateMachine } from "./state-machine";
import { createEventEnvelope } from "./event-envelope";
import type { EventActor } from "./event-envelope";
import { TransitionPolicy } from "./transition-policy";

type DemoState = "idle" | "active";
interface DemoContext {
  count: number;
}
type DemoEvent = { type: "INC" } | { type: "RESET" };
interface DemoCommand {
  type: "NOOP";
}
interface DemoOutput {
  type: "COUNT_CHANGED";
  count: number;
}

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-core-${envelopeSequence}`,
    occurredAt: `2026-03-19T10:50:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

class DemoMachine extends StateMachine<
  DemoState,
  DemoContext,
  DemoEvent,
  DemoCommand,
  DemoOutput
> {
  private readonly invariants: ((snapshot: { context: DemoContext }) => void)[] = [];

  constructor(transitionPolicy: TransitionPolicy) {
    super("idle", { count: 0 }, { transitionPolicy });
  }

  protected isTransitionAllowed(event: DemoEvent): boolean {
    if (event.type === "RESET" && this.state === "idle") {
      return false;
    }
    return true;
  }

  protected getInvariants() {
    return this.invariants;
  }

  protected transition(event: DemoEvent) {
    switch (event.type) {
      case "INC": {
        const nextCount = this.context.count + 1;
        this.state = "active";
        this.context = { count: nextCount };
        return this.result([], [{ count: nextCount, type: "COUNT_CHANGED" }]);
      }
      case "RESET": {
        this.state = "idle";
        this.context = { count: 0 };
        return this.result([{ type: "NOOP" }], [{ count: 0, type: "COUNT_CHANGED" }]);
      }
      default: {
        return this.result();
      }
    }
  }
}

class InvariantMachine extends StateMachine<
  DemoState,
  DemoContext,
  DemoEvent,
  DemoCommand,
  DemoOutput
> {
  private readonly invariants = [
    ({ context }: { context: DemoContext }) => {
      if (context.count < 0) {
        throw new Error("Invariant violated: count must be non-negative");
      }
    },
  ];

  constructor() {
    super("idle", { count: 0 }, { transitionPolicy: TransitionPolicy.IGNORE });
  }

  protected getInvariants() {
    return this.invariants;
  }

  protected isTransitionAllowed(event: DemoEvent): boolean {
    if (event.type === "INC") {
      return this.state === "idle" || this.state === "active";
    }
    return this.state === "idle" || this.state === "active";
  }

  protected transition(event: DemoEvent) {
    if (event.type === "INC") {
      this.context = { count: -1 };
    }
    return this.result();
  }
}

describe("StateMachine base class", () => {
  it("exposes current snapshot", () => {
    const machine = new DemoMachine(TransitionPolicy.IGNORE);
    expect(machine.getSnapshot()).toEqual({
      context: { count: 0 },
      state: "idle",
    });
  });

  it("returns structured transition result with commands and outputs", () => {
    const machine = new DemoMachine(TransitionPolicy.IGNORE);
    const result = machine.dispatch(
      envelope(
        { type: "INC" },
        { type: "system", id: "test" },
      ),
    );

    expect(result.state).toBe("active");
    expect(result.context.count).toBe(1);
    expect(result.outputs).toContainEqual({ count: 1, type: "COUNT_CHANGED" });
    expect(result.commands).toEqual([]);
  });

  it("rejects disallowed transition in strict mode", () => {
    const machine = new DemoMachine(TransitionPolicy.REJECT);

    expect(() =>
      machine.dispatch(
        envelope(
          { type: "RESET" },
          { type: "system", id: "test" },
        ),
      ),
    ).toThrow("Transition rejected");
  });

  it("ignores disallowed transition in ignore mode", () => {
    const machine = new DemoMachine(TransitionPolicy.IGNORE);
    const result = machine.dispatch(
      envelope(
        { type: "RESET" },
        { type: "system", id: "test" },
      ),
    );

    expect(result.state).toBe("idle");
    expect(result.commands).toEqual([]);
    expect(result.outputs).toEqual([]);
  });

  it("throws when invariant is violated", () => {
    const machine = new InvariantMachine();

    expect(() =>
      machine.dispatch(
        envelope(
          { type: "INC" },
          { type: "system", id: "test" },
        ),
      ),
    ).toThrow("Invariant violated: count must be non-negative");
  });

  it("stops notifying listener after unsubscribe", () => {
    const machine = new DemoMachine(TransitionPolicy.IGNORE);
    let calls = 0;
    const unsubscribe = machine.subscribe(() => {
      calls += 1;
    });

    machine.dispatch(envelope({ type: "INC" }, { type: "system", id: "test" }));
    unsubscribe();
    machine.dispatch(envelope({ type: "RESET" }, { type: "system", id: "test" }));

    expect(calls).toBe(1);
  });
});
