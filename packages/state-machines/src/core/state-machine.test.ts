import { describe, expect, it } from "bun:test";
import { StateMachine } from "./state-machine";
import { createEventEnvelope } from "./event-envelope";
import { TransitionPolicy } from "./transition-policy";

type DemoState = "idle" | "active";
interface DemoContext {
  count: number;
}
type DemoEvent = { type: "INC" } | { type: "RESET" };
type DemoCommand = { type: "NOOP" };
type DemoOutput = { type: "COUNT_CHANGED"; count: number };

class DemoMachine extends StateMachine<
  DemoState,
  DemoContext,
  DemoEvent,
  DemoCommand,
  DemoOutput
> {
  constructor(transitionPolicy = TransitionPolicy.IGNORE) {
    super("idle", { count: 0 }, { transitionPolicy });
  }

  protected isTransitionAllowed(event: DemoEvent): boolean {
    if (event.type === "RESET" && this.state === "idle") {
      return false;
    }
    return true;
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
  constructor() {
    super("idle", { count: 0 });
  }

  protected getInvariants() {
    return [
      ({ context }: { context: DemoContext }) => {
        if (context.count < 0) {
          throw new Error("Invariant violated: count must be non-negative");
        }
      },
    ];
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
    const machine = new DemoMachine();
    expect(machine.getSnapshot()).toEqual({
      context: { count: 0 },
      state: "idle",
    });
  });

  it("returns structured transition result with commands and outputs", () => {
    const machine = new DemoMachine();
    const result = machine.dispatch(
      createEventEnvelope(
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
        createEventEnvelope(
          { type: "RESET" },
          { type: "system", id: "test" },
        ),
      ),
    ).toThrow("Transition rejected");
  });

  it("ignores disallowed transition in ignore mode", () => {
    const machine = new DemoMachine(TransitionPolicy.IGNORE);
    const result = machine.dispatch(
      createEventEnvelope(
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
        createEventEnvelope(
          { type: "INC" },
          { type: "system", id: "test" },
        ),
      ),
    ).toThrow("Invariant violated: count must be non-negative");
  });

  it("stops notifying listener after unsubscribe", () => {
    const machine = new DemoMachine();
    let calls = 0;
    const unsubscribe = machine.subscribe(() => {
      calls += 1;
    });

    machine.dispatch(createEventEnvelope({ type: "INC" }, { type: "system", id: "test" }));
    unsubscribe();
    machine.dispatch(createEventEnvelope({ type: "RESET" }, { type: "system", id: "test" }));

    expect(calls).toBe(1);
  });
});
