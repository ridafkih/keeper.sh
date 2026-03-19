import type { EventEnvelope } from "./event-envelope";
import { TransitionPolicy } from "./transition-policy";

interface MachineSnapshot<TState, TContext> {
  state: TState;
  context: TContext;
}

interface MachineTransitionResult<TState, TContext, TCommand, TOutput>
  extends MachineSnapshot<TState, TContext> {
  commands: TCommand[];
  outputs: TOutput[];
}

interface TransitionNotification<TState, TContext, TEvent, TCommand, TOutput> {
  envelope: EventEnvelope<TEvent>;
  fromState: TState;
  toState: TState;
  result: MachineTransitionResult<TState, TContext, TCommand, TOutput>;
}

type TransitionListener<TState, TContext, TEvent, TCommand, TOutput> = (
  notification: TransitionNotification<TState, TContext, TEvent, TCommand, TOutput>,
) => void;

abstract class StateMachine<TState, TContext, TEvent, TCommand, TOutput> {
  protected state: TState;
  protected context: TContext;
  private readonly listeners = new Set<
    TransitionListener<TState, TContext, TEvent, TCommand, TOutput>
  >();
  private readonly transitionPolicy: TransitionPolicy;

  protected constructor(
    initialState: TState,
    initialContext: TContext,
    options: { transitionPolicy: TransitionPolicy },
  ) {
    this.state = initialState;
    this.context = initialContext;
    this.transitionPolicy = options.transitionPolicy;
  }

  getSnapshot(): MachineSnapshot<TState, TContext> {
    return {
      context: this.context,
      state: this.state,
    };
  }

  subscribe(listener: TransitionListener<TState, TContext, TEvent, TCommand, TOutput>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispatch(envelope: EventEnvelope<TEvent>): MachineTransitionResult<TState, TContext, TCommand, TOutput> {
    if (!this.isTransitionAllowed(envelope.event)) {
      if (this.transitionPolicy === TransitionPolicy.REJECT) {
        throw new Error("Transition rejected by policy");
      }

      return this.result([], []);
    }

    const fromState = this.state;
    const result = this.transition(envelope.event);
    const toState = this.state;
    this.assertInvariants();

    for (const listener of this.listeners) {
      listener({
        envelope,
        fromState,
        toState,
        result,
      });
    }

    return result;
  }

  protected result(
    commands: TCommand[] = [],
    outputs: TOutput[] = [],
  ): MachineTransitionResult<TState, TContext, TCommand, TOutput> {
    return {
      commands,
      context: this.context,
      outputs,
      state: this.state,
    };
  }

  protected abstract transition(
    event: TEvent,
  ): MachineTransitionResult<TState, TContext, TCommand, TOutput>;

  protected abstract isTransitionAllowed(event: TEvent): boolean;

  protected abstract getInvariants(): ((snapshot: MachineSnapshot<TState, TContext>) => void)[];

  private assertInvariants(): void {
    const snapshot = this.getSnapshot();
    for (const invariant of this.getInvariants()) {
      invariant(snapshot);
    }
  }
}

export { StateMachine };
export type {
  MachineSnapshot,
  MachineTransitionResult,
  TransitionNotification,
  TransitionListener,
};
