import type { StateMachine } from "./state-machine";
import type { TransitionListener } from "./state-machine";

const withMachineSubscription = <
  TState,
  TContext,
  TEvent,
  TCommand,
  TOutput,
  TResult,
>(
  machine: StateMachine<TState, TContext, TEvent, TCommand, TOutput>,
  listener: TransitionListener<TState, TContext, TEvent, TCommand, TOutput>,
  callback: () => TResult,
): TResult => {
  const unsubscribe = machine.subscribe(listener);
  try {
    return callback();
  } finally {
    unsubscribe();
  }
};

export { withMachineSubscription };
