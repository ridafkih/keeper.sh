import type {
  EventEnvelope,
  MachineSnapshot,
  MachineTransitionResult,
} from "@keeper.sh/state-machines";

interface SnapshotRecord<TState, TContext> {
  version: number;
  snapshot: MachineSnapshot<TState, TContext>;
}

interface SnapshotStore<TState, TContext> {
  read: (aggregateId: string) => Promise<SnapshotRecord<TState, TContext> | null>;
  compareAndSet: (
    aggregateId: string,
    expectedVersion: number,
    snapshot: MachineSnapshot<TState, TContext>,
  ) => Promise<SnapshotRecord<TState, TContext> | null>;
}

interface EnvelopeStore {
  hasProcessed: (aggregateId: string, envelopeId: string) => Promise<boolean>;
  markProcessed: (aggregateId: string, envelopeId: string) => Promise<void>;
}

interface CommandBus<TCommand> {
  execute: (command: TCommand) => Promise<void>;
}

interface RuntimeProcessEvent<TState, TContext, TEvent, TCommand, TOutput> {
  aggregateId: string;
  outcome: MachineProcessOutcome;
  envelope: EventEnvelope<TEvent>;
  snapshot: MachineSnapshot<TState, TContext>;
  transition?: MachineTransitionResult<TState, TContext, TCommand, TOutput>;
  version: number;
}

interface RuntimeEventSink<TState, TContext, TEvent, TCommand, TOutput> {
  onProcessed: (
    event: RuntimeProcessEvent<TState, TContext, TEvent, TCommand, TOutput>,
  ) => Promise<void> | void;
}

interface RuntimeMachine<TState, TContext, TEvent, TCommand, TOutput> {
  restore: (snapshot: MachineSnapshot<TState, TContext>) => void;
  dispatch: (
    envelope: EventEnvelope<TEvent>,
  ) => MachineTransitionResult<TState, TContext, TCommand, TOutput>;
}

interface MachineRuntimeDriverDependencies<
  TState,
  TContext,
  TEvent,
  TCommand,
  TOutput,
> {
  aggregateId: string;
  machine: RuntimeMachine<TState, TContext, TEvent, TCommand, TOutput>;
  snapshotStore: SnapshotStore<TState, TContext>;
  envelopeStore: EnvelopeStore;
  commandBus: CommandBus<TCommand>;
  eventSink: RuntimeEventSink<TState, TContext, TEvent, TCommand, TOutput>;
}

interface MachineProcessResult<TState, TContext, TCommand, TOutput> {
  outcome: MachineProcessOutcome;
  snapshot: MachineSnapshot<TState, TContext>;
  version: number;
  transition?: MachineTransitionResult<TState, TContext, TCommand, TOutput>;
}

type MachineProcessOutcome = "APPLIED" | "DUPLICATE_IGNORED" | "CONFLICT_DETECTED";

class MachineConflictDetectedError extends Error {
  readonly aggregateId: string;
  readonly envelopeId: string;

  constructor(aggregateId: string, envelopeId: string) {
    super(`Machine conflict detected for aggregate ${aggregateId} (envelope ${envelopeId})`);
    this.name = "MachineConflictDetectedError";
    this.aggregateId = aggregateId;
    this.envelopeId = envelopeId;
  }
}

const isMachineConflictDetectedError = (
  error: unknown,
): error is MachineConflictDetectedError => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name !== "MachineConflictDetectedError") {
    return false;
  }
  if (!("aggregateId" in error) || !("envelopeId" in error)) {
    return false;
  }
  return true;
};

class MachineRuntimeDriver<TState, TContext, TEvent, TCommand, TOutput> {
  private static readonly aggregateLocks = new Map<string, Promise<void>>();
  private readonly aggregateId: string;
  private readonly machine: RuntimeMachine<TState, TContext, TEvent, TCommand, TOutput>;
  private readonly snapshotStore: SnapshotStore<TState, TContext>;
  private readonly envelopeStore: EnvelopeStore;
  private readonly commandBus: CommandBus<TCommand>;
  private readonly eventSink: RuntimeEventSink<TState, TContext, TEvent, TCommand, TOutput>;

  constructor(
    dependencies: MachineRuntimeDriverDependencies<
      TState,
      TContext,
      TEvent,
      TCommand,
      TOutput
    >,
  ) {
    this.aggregateId = dependencies.aggregateId;
    this.machine = dependencies.machine;
    this.snapshotStore = dependencies.snapshotStore;
    this.envelopeStore = dependencies.envelopeStore;
    this.commandBus = dependencies.commandBus;
    this.eventSink = dependencies.eventSink;
  }

  process(envelope: EventEnvelope<TEvent>): Promise<MachineProcessResult<TState, TContext, TCommand, TOutput>> {
    return this.runWithAggregateLock(() => this.processUnlocked(envelope));
  }

  private async processUnlocked(
    envelope: EventEnvelope<TEvent>,
  ): Promise<MachineProcessResult<TState, TContext, TCommand, TOutput>> {
    if (await this.envelopeStore.hasProcessed(this.aggregateId, envelope.id)) {
      const record = await this.requireSnapshotRecord();
      await this.eventSink.onProcessed({
        aggregateId: this.aggregateId,
        outcome: "DUPLICATE_IGNORED",
        envelope,
        snapshot: record.snapshot,
        version: record.version,
      });
      return {
        outcome: "DUPLICATE_IGNORED",
        snapshot: record.snapshot,
        version: record.version,
      };
    }

    const currentRecord = await this.requireSnapshotRecord();
    this.machine.restore(currentRecord.snapshot);
    const transition = this.machine.dispatch(envelope);

    for (const command of transition.commands) {
      await this.commandBus.execute(command);
    }

    const nextRecord = await this.snapshotStore.compareAndSet(
      this.aggregateId,
      currentRecord.version,
      {
        context: transition.context,
        state: transition.state,
      },
    );

    if (!nextRecord) {
      const record = await this.requireSnapshotRecord();
      await this.eventSink.onProcessed({
        aggregateId: this.aggregateId,
        outcome: "CONFLICT_DETECTED",
        envelope,
        snapshot: record.snapshot,
        version: record.version,
      });
      return {
        outcome: "CONFLICT_DETECTED",
        snapshot: record.snapshot,
        version: record.version,
      };
    }

    await this.envelopeStore.markProcessed(this.aggregateId, envelope.id);
    await this.eventSink.onProcessed({
      aggregateId: this.aggregateId,
      outcome: "APPLIED",
      envelope,
      snapshot: {
        context: transition.context,
        state: transition.state,
      },
      transition,
      version: nextRecord.version,
    });
    return {
      outcome: "APPLIED",
      snapshot: {
        context: transition.context,
        state: transition.state,
      },
      transition,
      version: nextRecord.version,
    };
  }

  private async runWithAggregateLock<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const prior = MachineRuntimeDriver.aggregateLocks.get(this.aggregateId) ?? Promise.resolve();
    const current = prior.then(operation, operation);
    const lockTail = current.then(
      () => globalThis.undefined,
      () => globalThis.undefined,
    );
    MachineRuntimeDriver.aggregateLocks.set(this.aggregateId, lockTail);

    try {
      return await current;
    } finally {
      if (MachineRuntimeDriver.aggregateLocks.get(this.aggregateId) === lockTail) {
        MachineRuntimeDriver.aggregateLocks.delete(this.aggregateId);
      }
    }
  }

  private async requireSnapshotRecord(): Promise<SnapshotRecord<TState, TContext>> {
    const record = await this.snapshotStore.read(this.aggregateId);
    if (!record) {
      throw new Error(`Snapshot not initialized for aggregate ${this.aggregateId}`);
    }
    return record;
  }
}

class InMemorySnapshotStore<TState, TContext> implements SnapshotStore<TState, TContext> {
  private readonly records = new Map<string, SnapshotRecord<TState, TContext>>();

  initialize(
    aggregateId: string,
    snapshot: MachineSnapshot<TState, TContext>,
  ): Promise<void> {
    this.records.set(aggregateId, {
      snapshot,
      version: 0,
    });
    return Promise.resolve();
  }

  initializeIfMissing(
    aggregateId: string,
    snapshot: MachineSnapshot<TState, TContext>,
  ): Promise<SnapshotRecord<TState, TContext>> {
    const existing = this.records.get(aggregateId);
    if (existing) {
      return Promise.resolve(existing);
    }

    const created = {
      snapshot,
      version: 0,
    };
    this.records.set(aggregateId, created);
    return Promise.resolve(created);
  }

  read(aggregateId: string): Promise<SnapshotRecord<TState, TContext> | null> {
    return Promise.resolve(this.records.get(aggregateId) ?? null);
  }

  compareAndSet(
    aggregateId: string,
    expectedVersion: number,
    snapshot: MachineSnapshot<TState, TContext>,
  ): Promise<SnapshotRecord<TState, TContext> | null> {
    const current = this.records.get(aggregateId);
    if (!current || current.version !== expectedVersion) {
      return Promise.resolve(null);
    }

    const next = {
      snapshot,
      version: expectedVersion + 1,
    };
    this.records.set(aggregateId, next);
    return Promise.resolve(next);
  }

  forceBumpVersion(aggregateId: string): Promise<void> {
    const current = this.records.get(aggregateId);
    if (!current) {
      return Promise.resolve();
    }
    this.records.set(aggregateId, {
      snapshot: current.snapshot,
      version: current.version + 1,
    });
    return Promise.resolve();
  }
}

class InMemoryEnvelopeStore implements EnvelopeStore {
  private readonly processedByAggregate = new Map<string, Set<string>>();

  hasProcessed(aggregateId: string, envelopeId: string): Promise<boolean> {
    const processed = this.processedByAggregate.get(aggregateId);
    return Promise.resolve(processed?.has(envelopeId) ?? false);
  }

  markProcessed(aggregateId: string, envelopeId: string): Promise<void> {
    const processed = this.processedByAggregate.get(aggregateId);
    if (processed) {
      processed.add(envelopeId);
      return Promise.resolve();
    }

    this.processedByAggregate.set(aggregateId, new Set([envelopeId]));
    return Promise.resolve();
  }
}

export {
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineConflictDetectedError,
  isMachineConflictDetectedError,
  MachineRuntimeDriver,
};
export type {
  CommandBus,
  EnvelopeStore,
  RuntimeEventSink,
  RuntimeProcessEvent,
  MachineProcessResult,
  MachineRuntimeDriverDependencies,
  RuntimeMachine,
  SnapshotRecord,
  SnapshotStore,
  MachineProcessOutcome,
};
