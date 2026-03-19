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
}

interface MachineProcessResult<TState, TContext, TCommand, TOutput> {
  duplicate: boolean;
  version: number;
  transition?: MachineTransitionResult<TState, TContext, TCommand, TOutput>;
}

class MachineConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MachineConcurrencyError";
  }
}

class MachineRuntimeDriver<TState, TContext, TEvent, TCommand, TOutput> {
  private readonly aggregateId: string;
  private readonly machine: RuntimeMachine<TState, TContext, TEvent, TCommand, TOutput>;
  private readonly snapshotStore: SnapshotStore<TState, TContext>;
  private readonly envelopeStore: EnvelopeStore;
  private readonly commandBus: CommandBus<TCommand>;

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
  }

  async process(envelope: EventEnvelope<TEvent>): Promise<MachineProcessResult<TState, TContext, TCommand, TOutput>> {
    if (await this.envelopeStore.hasProcessed(this.aggregateId, envelope.id)) {
      const record = await this.requireSnapshotRecord();
      return {
        duplicate: true,
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
      throw new MachineConcurrencyError(
        `Snapshot compare-and-set conflict for aggregate ${this.aggregateId}`,
      );
    }

    await this.envelopeStore.markProcessed(this.aggregateId, envelope.id);
    return {
      duplicate: false,
      transition,
      version: nextRecord.version,
    };
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

export { InMemoryEnvelopeStore, InMemorySnapshotStore, MachineConcurrencyError, MachineRuntimeDriver };
export type {
  CommandBus,
  EnvelopeStore,
  MachineProcessResult,
  MachineRuntimeDriverDependencies,
  RuntimeMachine,
  SnapshotRecord,
  SnapshotStore,
};
